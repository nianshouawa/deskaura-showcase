use std::{path::{Path, PathBuf}, process::{Command, Stdio}, time::{Duration, Instant}};
use tauri::Manager;

#[tauri::command]
pub async fn convert_model(app: tauri::AppHandle, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || convert(&app, &path)).await.map_err(|e| e.to_string())?
}
fn convert(app: &tauri::AppHandle, path: &str) -> Result<String, String> {
    let source = Path::new(path).canonicalize().map_err(|e| e.to_string())?;
    let extension = source.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
    let blend = extension == "blend";
    if !source.is_file() || !["blend", "ma", "mb"].contains(&extension.as_str()) { return Err("只转换 .blend / .ma / .mb".into()); }
    let executable = if blend { "blender.exe" } else { "mayapy.exe" };
    let mut candidates = Vec::<PathBuf>::new();
    if let Some(configured) = std::env::var_os(if blend { "DESKAURA_BLENDER_PATH" } else { "DESKAURA_MAYAPY_PATH" }) { candidates.push(PathBuf::from(configured)); }
    if blend { candidates.push(PathBuf::from(r"E:\Blender Foundation\Blender 4.4\blender.exe")); }
    if let Some(programs) = std::env::var_os("ProgramFiles") {
        if let Ok(entries) = std::fs::read_dir(PathBuf::from(programs).join(if blend { "Blender Foundation" } else { "Autodesk" })) {
            for entry in entries.flatten() { candidates.push(if blend { entry.path().join(executable) } else { entry.path().join("bin").join(executable) }); }
        }
    }
    if let Some(paths) = std::env::var_os("PATH") { for dir in std::env::split_paths(&paths) { candidates.push(dir.join(executable)); } }
    let program = candidates.into_iter().find(|p| p.is_file()).ok_or(if blend {
        "未找到 Blender，请安装或设置 DESKAURA_BLENDER_PATH；也可手动导出 GLB。"
    } else { "未找到 Maya/mayapy，请安装有许可的 Maya 或设置 DESKAURA_MAYAPY_PATH；也可手动导出 FBX。" })?;
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    let data_root = std::env::current_exe().ok()
        .and_then(|executable| executable.parent().map(Path::to_path_buf))
        .and_then(|mut current| {
            for _ in 0..8 {
                if current.join("agent-backend").is_dir() && current.join("companion-frontend").is_dir() {
                    return current.parent().map(|parent| parent.join(format!("{}-Data",
                        current.file_name().and_then(|name| name.to_str()).unwrap_or("DeskAura"))));
                }
                current = current.parent()?.to_path_buf();
            }
            None
        })
        .or_else(|| app.path().app_local_data_dir().ok())
        .ok_or("无法确定模型转换数据目录")?;
    let dir = data_root.join("model-conversions").join(nonce.to_string());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let script = dir.join("export.py");
    let output = dir.join(if blend { "model.glb" } else { "model.fbx" });
    std::fs::write(&script, include_str!("model_export.py")).map_err(|e| e.to_string())?;
    let mut command = Command::new(program);
    if blend {
        command.args(["--background", "--factory-startup", "--disable-autoexec", "--python-exit-code", "1", "--python"]).arg(&script).arg("--");
    } else {
        command.arg(&script).env("MAYA_APP_DIR", dir.join("preferences")).env("MAYA_SKIP_USERSETUP_PY", "1").env("MAYA_SKIP_USERSETUP_MEL", "1");
    }
    command.arg(&source).arg(&output).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            if !status.success() || !output.is_file() {
                let _ = std::fs::remove_dir_all(&dir);
                return Err("模型转换失败，请检查建模软件、Maya 许可、FBX 插件及资源，或手动导出。".into());
            }
            return Ok(output.to_string_lossy().into_owned());
        }
        if started.elapsed() > Duration::from_secs(180) {
            let _ = child.kill(); let _ = child.wait(); let _ = std::fs::remove_dir_all(&dir);
            return Err("转换超过 180 秒已停止，请手动导出。".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}
