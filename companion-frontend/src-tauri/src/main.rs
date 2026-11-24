#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod model_conversion;
mod microphone;
mod diagnostics;

use std::process::Command;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent, MouseButton, MouseButtonState},
    Emitter, Manager, RunEvent,
};
struct BackendProcesses(Mutex<Vec<std::process::Child>>);
struct HiddenWindows(Mutex<Vec<String>>);

// All helper shells stay invisible. GUI applications opened by them still show.
fn background_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "windows")]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command
}

fn project_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let executable = std::env::current_exe().unwrap_or_default();
    let mut current = executable.parent().map(Path::to_path_buf).unwrap_or_default();
    for _ in 0..8 {
        if current.join("agent-backend").is_dir() && current.join("companion-frontend").is_dir() {
            let parent = current.parent().unwrap_or_else(|| current.as_path());
            let name = current.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("DeskAura");
            return parent.join(format!("{name}-Data"));
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => break,
        }
    }
    app.path().app_local_data_dir().unwrap_or_default()
}

fn backend_exe_path(app: &tauri::AppHandle) -> PathBuf {
    let exe_name = "deskaura-backend-x86_64-pc-windows-msvc.exe";
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("deskaura-backend").join(exe_name);
        if candidate.exists() { return candidate; }
    }
    if let Ok(current) = std::env::current_exe() {
        if let Some(dir) = current.parent() {
            let candidate = dir.join("deskaura-backend").join(exe_name);
            if candidate.exists() { return candidate; }
        }
    }
    app.path().resource_dir().map(|dir| dir.join("deskaura-backend").join(exe_name)).unwrap_or_default()
}

fn copy_directory_contents(source: &Path, target: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(target)?;
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let destination = target.join(entry.file_name());
        if entry.path().is_dir() {
            copy_directory_contents(&entry.path(), &destination)?;
        } else {
            std::fs::copy(entry.path(), destination)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn open_ssh_tunnel_tool(window: tauri::WebviewWindow) -> Result<String, String> {
    if !["home", "settings"].contains(&window.label()) { return Err("请从设置打开 SSH 隧道工具。".into()); }
    #[cfg(target_os = "windows")]
    {
        // Fixed executable, no user/model supplied shell. Show an existing tool
        // first to avoid creating duplicate tunnel controllers.
        let script = "$p=Get-Process AutoDL -ErrorAction SilentlyContinue | Select-Object -First 1; if($p -and $p.MainWindowHandle -ne 0){Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class DATunnelWindow{[DllImport(\"user32.dll\")]public static extern bool ShowWindowAsync(IntPtr h,int s);[DllImport(\"user32.dll\")]public static extern bool SetForegroundWindow(IntPtr h);}';[DATunnelWindow]::ShowWindowAsync($p.MainWindowHandle,9)|Out-Null;[DATunnelWindow]::SetForegroundWindow($p.MainWindowHandle)|Out-Null;exit 0};$candidate='D:\\AutoDL\\AutoDL-SSH-Tools\\AutoDL.exe';if(Test-Path -LiteralPath $candidate){Start-Process -FilePath $candidate;exit 0};exit 2";
        let status = background_command("powershell.exe").args(["-NoProfile", "-NonInteractive", "-Command", script]).status().map_err(|_| "无法打开 SSH 隧道工具")?;
        if status.success() { return Ok("已打开 SSH 隧道工具；请在工具中开启代理。".into()); }
        return Err("未找到 AutoDL SSH 隧道工具，请安装后再试。".into());
    }
    #[cfg(not(target_os = "windows"))]
    Err("当前仅支持 Windows AutoDL SSH 隧道工具。".into())
}

#[cfg(target_os = "windows")]
mod win_frame {
    use std::os::raw::c_int;

    type HWND = *mut std::ffi::c_void;
    const GWL_STYLE: c_int = -16;
    const GWLP_HWNDPARENT: c_int = -8;
    const WS_CAPTION: isize = 0x00C00000;
    const WS_THICKFRAME: isize = 0x00040000;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SW_HIDE: c_int = 0;
    const SW_RESTORE: c_int = 9;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: HWND, nindex: c_int) -> isize;
        fn SetWindowLongPtrW(hwnd: HWND, nindex: c_int, newlong: isize) -> isize;
        fn SetWindowPos(
            hwnd: HWND,
            insert_after: HWND,
            x: c_int,
            y: c_int,
            cx: c_int,
            cy: c_int,
            flags: u32,
        ) -> c_int;
        fn ShowWindow(hwnd: HWND, command: c_int) -> c_int;
        fn BringWindowToTop(hwnd: HWND) -> c_int;
        fn SetForegroundWindow(hwnd: HWND) -> c_int;
        fn IsWindowVisible(hwnd: HWND) -> c_int;
    }

    /// 直接移除窗口的标题栏 + 可调边框样式位，彻底去掉边框（绕过 tao 首次创建的竞态）。
    pub fn strip(hwnd: isize, resizable: bool) {
        if hwnd == 0 {
            return;
        }
        let hwnd = hwnd as HWND;
        unsafe {
            let mut style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            style &= !WS_CAPTION;
            if resizable { style |= WS_THICKFRAME; } else { style &= !WS_THICKFRAME; }
            SetWindowLongPtrW(hwnd, GWL_STYLE, style);
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED | SWP_NOACTIVATE,
            );
        }
    }

    /// An owned conversation stays above its full-screen transparent pet owner,
    /// even when Windows reorders topmost windows during click-through changes.
    pub fn own_dialog(dialog: isize, owner: isize, topmost: bool) {
        if dialog == 0 || owner == 0 { return; }
        unsafe {
            SetWindowLongPtrW(dialog as HWND, GWLP_HWNDPARENT, owner);
            SetWindowPos(dialog as HWND, if topmost { -1isize as HWND } else { std::ptr::null_mut() },
                0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
    }

    pub fn raise(hwnd: isize) {
        if hwnd == 0 { return; }
        let target = hwnd as HWND;
        unsafe {
            ShowWindow(target, SW_RESTORE);
            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetWindowPos(
                target,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }

    pub fn hide(hwnd: isize) {
        if hwnd == 0 { return; }
        let target = hwnd as HWND;
        unsafe {
            ShowWindow(target, SW_HIDE);
        }
    }

    pub fn is_visible(hwnd: isize) -> bool {
        if hwnd == 0 { return false; }
        unsafe {
            IsWindowVisible(hwnd as HWND) != 0
        }
    }
}

fn is_window_really_visible(window: Option<&tauri::WebviewWindow>) -> bool {
    let Some(window) = window else { return false; };
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            return win_frame::is_visible(hwnd.0 as isize);
        }
    }
    window.is_visible().unwrap_or(false)
}

fn restore_app(app: &tauri::AppHandle) {
    let labels = app.try_state::<HiddenWindows>()
        .and_then(|state| state.0.lock().ok().map(|mut v| std::mem::take(&mut *v)))
        .unwrap_or_default();
    for label in labels {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.unminimize();
            let _ = window.show();
            #[cfg(target_os = "windows")]
            if let Ok(hwnd) = window.hwnd() {
                win_frame::raise(hwnd.0 as isize);
            }
        }
    }
    if let Some(home) = app.get_webview_window("home") {
        let _ = home.unminimize();
        let _ = home.show();
        let _ = home.set_focus();
        #[cfg(target_os = "windows")]
        if let Ok(hwnd) = home.hwnd() {
            win_frame::raise(hwnd.0 as isize);
        }
    }
    let _ = app.emit("deskaura:app-restored", ());
}

fn sync_companion_layers(app: &tauri::AppHandle) -> Result<bool, String> {
    let pet = app.get_webview_window("main").ok_or("角色窗口不存在")?;
    let topmost = pet.is_always_on_top().map_err(|e| e.to_string())?;
    if let Some(dialog) = app.get_webview_window("dialog") {
        dialog.set_always_on_top(topmost).map_err(|e| e.to_string())?;
        #[cfg(target_os = "windows")]
        {
            let owner = pet.hwnd().map_err(|e| e.to_string())?.0 as isize;
            let hwnd = dialog.hwnd().map_err(|e| e.to_string())?.0 as isize;
            win_frame::own_dialog(hwnd, owner, topmost);
        }
    }
    Ok(topmost)
}

#[cfg(target_os = "windows")]
fn strip_window_frame(app: &tauri::AppHandle) {
    let handle = app.clone();
    // Resolve the live window on its owner thread after each delay. A captured
    // raw HWND can be stale (or reused) if startup is immediately closed.
    std::thread::spawn(move || {
        for delay in [300, 500] {
            std::thread::sleep(std::time::Duration::from_millis(delay));
            let app = handle.clone();
            let _ = handle.run_on_main_thread(move || {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(hwnd) = window.hwnd() {
                        win_frame::strip(hwnd.0 as isize, false);
                    }
                }
            });
        }
    });
}

/// 命令：去掉窗口阴影与边框（透明无边框窗口的边缘会露出一圈灰线）。
#[tauri::command]
fn polish_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.set_shadow(false);
    let _ = window.set_decorations(false);
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map(|h| h.0 as isize).unwrap_or(0);
        win_frame::strip(hwnd, window.label() != "main");
    }
    if window.label() == "dialog" { sync_companion_layers(window.app_handle())?; }
    Ok(())
}

/// 命令：切换窗口置顶，返回切换后的状态。
#[tauri::command]
fn set_always_on_top(window: tauri::WebviewWindow, value: Option<bool>) -> Result<bool, String> {
    let app = window.app_handle();
    let pet = app.get_webview_window("main").ok_or("角色窗口不存在")?;
    let target = value.unwrap_or_else(|| !pet.is_always_on_top().unwrap_or(false));
    pet.set_always_on_top(target).map_err(|e| e.to_string())?;
    sync_companion_layers(app)?;
    let _ = app.emit("deskaura:top-state", target);
    Ok(target)
}

/// 命令：让窗口跟随鼠标拖动（无边框模式下浏览器无法直接拖动窗口）。
#[tauri::command]
fn start_drag(window: tauri::WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

/// 命令：切换点击穿透（穿透时鼠标可点到宠物背后的桌面）。
#[tauri::command]
fn set_ignore_cursor_events(window: tauri::WebviewWindow, value: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(value)
        .map_err(|e| e.to_string())
}

/// 命令：隐藏窗口到托盘（宠物从桌面消失，但进程继续在后台）。
#[tauri::command]
fn hide_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let mut labels = Vec::new();
    for (label, surface) in app.webview_windows() {
        if surface.is_visible().unwrap_or(false) { labels.push(label); surface.hide().map_err(|e| e.to_string())?; }
    }
    if let Some(state) = app.try_state::<HiddenWindows>() {
        if let Ok(mut hidden) = state.0.lock() {
            for label in labels { if !hidden.contains(&label) { hidden.push(label); } }
        }
    }
    let _ = app.emit("deskaura:app-hidden", ());
    Ok(())
}

/// 命令：显示窗口（从托盘恢复）。
#[tauri::command]
fn show_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn raise_owned_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if !["home", "settings", "tutorial", "dialog"].contains(&label.as_str()) {
        return Err("不允许前置此窗口".into());
    }
    let window = app.get_webview_window(&label).ok_or("窗口不存在")?;
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        // Use the UI thread without joining another app's input queue or
        // synthesizing Alt (the platform dispatcher's focus fallback).
        app.run_on_main_thread(move || win_frame::raise(hwnd)).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// 命令：读取全局光标屏幕坐标（穿透状态下前端仍需知道鼠标位置）。
/// 返回 (x, y) 物理像素坐标。
#[tauri::command]
fn get_cursor_pos() -> Result<(i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetCursorPos(lpPoint: *mut POINT) -> i32;
        }
        #[repr(C)]
        struct POINT {
            x: i32,
            y: i32,
        }
        let mut p = POINT { x: 0, y: 0 };
        unsafe {
            if GetCursorPos(&mut p) == 0 {
                return Err("GetCursorPos failed".into());
            }
        }
        Ok((p.x, p.y))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("仅在 Windows 上可用".into())
    }
}

#[tauri::command]
fn start_voice_typing() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        #[link(name = "user32")]
        extern "system" { fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize); }
        // The frontend focuses the editable field first. Trigger the Windows
        // dictation UI; no microphone permission or cloud key is faked here.
        unsafe {
            keybd_event(0x5B, 0, 0, 0);
            keybd_event(0x48, 0, 0, 0);
            keybd_event(0x48, 0, 2, 0);
            keybd_event(0x5B, 0, 2, 0);
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    { Err("请使用系统听写快捷键".into()) }
}

/// 白名单：允许打开的应用名 -> Windows 启动命令。
fn app_launcher(app_name: &str) -> Option<&'static str> {
    match app_name {
        "notepad" => Some("notepad.exe"),
        "calc" => Some("calc.exe"),
        "browser" => Some(
            "https://www.google.com", // 由 shell 打开默认浏览器
        ),
        "explorer" | "open_folder" => Some("explorer.exe"),
        "taskmgr" => Some("taskmgr.exe"),
        "control" => Some("control.exe"),
        _ => None,
    }
}

/// 命令：执行白名单系统操作（安全受限，不开放任意 shell）。
#[tauri::command]
fn run_system_action(action_type: String, param: Option<String>) -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (action_type, param);
        return Err("系统操作仅在 Windows 上可用".into());
    }

    #[cfg(target_os = "windows")]
    {
        match action_type.as_str() {
            "open_app" => {
                let app = param.unwrap_or_default();
                let launcher = app_launcher(app.as_str())
                    .ok_or_else(|| format!("不支持的应用: {app}"))?;
                background_command("cmd")
                    .args(["/C", "start", "", launcher])
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok(format!("已打开 {app}"))
            }
            "open_url" => {
                use windows::core::{w, PCWSTR};
                use windows::Win32::UI::Shell::ShellExecuteW;
                use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
                let url = param.unwrap_or_default();
                if !(url.starts_with("http://") || url.starts_with("https://")) ||
                    url.chars().any(|ch| ch.is_control()) {
                    return Err("只允许打开 http/https 链接".into());
                }
                // Pass the URL directly to Windows. A URL must never become
                // part of a cmd.exe command line, even after approval.
                let wide: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
                let result = unsafe {
                    ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL)
                };
                if result.0 as isize <= 32 {
                    return Err("无法打开链接，请检查默认浏览器设置".into());
                }
                Ok("已打开链接".into())
            }
            "volume" => {
                let arg = match param.as_deref() {
                    Some("up") => "+10",
                    Some("down") => "-10",
                    Some("mute") => "mute",
                    _ => return Err("音量命令需为 up/down/mute".into()),
                };
                // 用 PowerShell SendKeys 模拟音量键（上下 = 音量键，静音 = 静音键）。
                let keycode = match arg {
                    "+10" => "175",  // VK_VOLUME_UP
                    "-10" => "174",  // VK_VOLUME_DOWN
                    _ => "173",      // VK_VOLUME_MUTE
                };
                let steps = if arg == "mute" { 1 } else { 10 };
                let script = format!(
                    "$w=New-Object -ComObject WScript.Shell; 1..{} | %{{ $w.SendKeys([char]{}) }}",
                    steps, keycode
                );
                background_command("powershell")
                    .args(["-NoProfile", "-Command", &script])
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok(format!("音量已调整（{arg}）"))
            }
            "lock_screen" => {
                background_command("rundll32.exe")
                    .args(["user32.dll,LockWorkStation"])
                    .spawn()
                    .map_err(|e| e.to_string())?;
                Ok("已锁定屏幕".into())
            }
            "open_folder" => {
                background_command("explorer.exe").spawn().map_err(|e| e.to_string())?;
                Ok("已打开文件资源管理器".into())
            }
            _ => Err(format!("不支持的操作: {action_type}")),
        }
    }
}


/// Use the modern shell dialog: Windows owns DPI, control layout and sizing.
#[cfg(target_os = "windows")]
#[tauri::command]
async fn pick_model_file(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let pet = window.app_handle().get_webview_window("main");
    let was_top = pet.as_ref().map(|w| w.is_always_on_top().unwrap_or(false)).unwrap_or(false);
    if was_top { if let Some(pet) = &pet { let _ = pet.set_always_on_top(false); } }
    let result = tauri::async_runtime::spawn_blocking(move || {
        use windows::core::w;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            Common::COMDLG_FILTERSPEC, FileOpenDialog, IFileOpenDialog,
            FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST,
            SIGDN_FILESYSPATH,
        };
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
            struct ComGuard;
            impl Drop for ComGuard { fn drop(&mut self) { unsafe { CoUninitialize() } } }
            let _guard = ComGuard;
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            dialog.SetTitle(w!("选择模型")).map_err(|e| e.to_string())?;
            dialog.SetOptions(FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR).map_err(|e| e.to_string())?;
            dialog.SetFileTypes(&[
                COMDLG_FILTERSPEC { pszName: w!("支持的模型（VRM / FBX / GLB / GLTF / Blend / Maya）"), pszSpec: w!("*.vrm;*.fbx;*.glb;*.gltf;*.blend;*.ma;*.mb") },
                COMDLG_FILTERSPEC { pszName: w!("所有文件"), pszSpec: w!("*.*") },
            ]).map_err(|e| e.to_string())?;
            match dialog.Show(Some(HWND(owner as *mut std::ffi::c_void))) {
                Ok(()) => {},
                Err(error) if error.code().0 as u32 == 0x800704C7 => return Ok(None),
                Err(error) => return Err(error.to_string()),
            }
            let item = dialog.GetResult().map_err(|e| e.to_string())?;
            let path = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|e| e.to_string())?;
            let result = path.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(path.0 as *const std::ffi::c_void));
            result.map(Some)
        }
    }).await;
    if was_top { if let Some(pet) = &pet { let _ = pet.set_always_on_top(true); } }
    result.map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn pick_folder(window: tauri::WebviewWindow, initial_folder: Option<String>) -> Result<Option<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        use windows::core::w;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
        use windows::core::PCWSTR;
        use windows::Win32::System::Com::IBindCtx;
        use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH};
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
            struct Guard;
            impl Drop for Guard { fn drop(&mut self) { unsafe { CoUninitialize() } } }
            let _guard = Guard;
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            dialog.SetTitle(w!("选择授权文件夹")).map_err(|e| e.to_string())?;
            dialog.SetOptions(FOS_PICKFOLDERS | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM).map_err(|e| e.to_string())?;
            if let Some(initial) = initial_folder {
                let initial_path = Path::new(&initial);
                let folder = if initial_path.is_dir() { initial_path.to_path_buf() } else { initial_path.parent().map(Path::to_path_buf).unwrap_or_default() };
                if folder.is_dir() {
                    let mut value = folder.to_string_lossy().encode_utf16().collect::<Vec<_>>();
                    value.push(0);
                    if let Ok(item) = SHCreateItemFromParsingName::<_, Option<&IBindCtx>, IShellItem>(PCWSTR(value.as_ptr()), None) {
                        dialog.SetFolder(&item).ok();
                    }
                }
            }
            match dialog.Show(Some(HWND(owner as *mut std::ffi::c_void))) {
                Ok(()) => {}
                Err(error) if error.code().0 as u32 == 0x800704C7 => return Ok(None),
                Err(error) => return Err(error.to_string()),
            }
            let item = dialog.GetResult().map_err(|e| e.to_string())?;
            let path = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|e| e.to_string())?;
            let result = path.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(path.0 as *const std::ffi::c_void));
            result.map(Some)
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn pick_file(window: tauri::WebviewWindow, initial_folder: Option<String>) -> Result<Option<String>, String> {
    let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    tauri::async_runtime::spawn_blocking(move || {
        use windows::core::w;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
        use windows::core::PCWSTR;
        use windows::Win32::System::Com::IBindCtx;
        use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FILEMUSTEXIST, FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH};
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|e| e.to_string())?;
            struct Guard;
            impl Drop for Guard { fn drop(&mut self) { unsafe { CoUninitialize() } } }
            let _guard = Guard;
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
            dialog.SetTitle(w!("选择记忆文件")).map_err(|e| e.to_string())?;
            dialog.SetOptions(FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR).map_err(|e| e.to_string())?;
            if let Some(initial) = initial_folder {
                let initial_path = Path::new(&initial);
                let folder = if initial_path.is_dir() { initial_path.to_path_buf() } else { initial_path.parent().map(Path::to_path_buf).unwrap_or_default() };
                if folder.is_dir() {
                    let mut value = folder.to_string_lossy().encode_utf16().collect::<Vec<_>>();
                    value.push(0);
                    if let Ok(item) = SHCreateItemFromParsingName::<_, Option<&IBindCtx>, IShellItem>(PCWSTR(value.as_ptr()), None) {
                        dialog.SetFolder(&item).ok();
                    }
                }
            }
            match dialog.Show(Some(HWND(owner as *mut std::ffi::c_void))) {
                Ok(()) => {}
                Err(error) if error.code().0 as u32 == 0x800704C7 => return Ok(None),
                Err(error) => return Err(error.to_string()),
            }
            let item = dialog.GetResult().map_err(|e| e.to_string())?;
            let path = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|e| e.to_string())?;
            let result = path.to_string().map_err(|e| e.to_string());
            CoTaskMemFree(Some(path.0 as *const std::ffi::c_void));
            result.map(Some)
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn save_role_export(
    window: tauri::WebviewWindow,
    content: String,
    suggested_name: String,
    export_kind: Option<String>,
) -> Result<Option<String>, String> {
    if window.label() != "settings" { return Err("请从角色设置导出。".into()); }
    if content.len() > 4 * 1024 * 1024 { return Err("角色配置过大。".into()); }
    let owner = window.hwnd().map_err(|_| "导出窗口不可用")?.0 as isize;
    let basename = suggested_name.chars().map(|c| {
        if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }
    }).take(160).collect::<String>();
    let kind = export_kind.unwrap_or_else(|| "role".into());
    if !["role", "persona", "mcp"].contains(&kind.as_str()) { return Err("不支持的导出格式。".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        use windows::core::{w, PCWSTR};
        use windows::Win32::Foundation::HWND;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
        };
        use windows::Win32::UI::Shell::{
            Common::COMDLG_FILTERSPEC, FileSaveDialog, IFileSaveDialog,
            FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_OVERWRITEPROMPT, FOS_PATHMUSTEXIST,
            SIGDN_FILESYSPATH,
        };
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|_| "无法初始化保存窗口")?;
            struct Guard;
            impl Drop for Guard { fn drop(&mut self) { unsafe { CoUninitialize() } } }
            let _guard = Guard;
            let dialog: IFileSaveDialog = CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)
                .map_err(|_| "无法打开保存窗口")?;
            let title = if kind == "persona" { w!("导出角色设定") } else if kind == "mcp" { w!("导出 MCP 配置") } else { w!("导出角色配置") };
            dialog.SetTitle(title).map_err(|_| "无法设置保存窗口")?;
            dialog.SetOptions(FOS_PATHMUSTEXIST | FOS_FORCEFILESYSTEM | FOS_NOCHANGEDIR | FOS_OVERWRITEPROMPT)
                .map_err(|_| "无法设置保存选项")?;
            let (label, pattern, extension) = if kind == "persona" {
                (w!("角色设定文档 TXT"), w!("*.txt"), w!("txt"))
            } else {
                (w!("配置 JSON"), w!("*.json"), w!("json"))
            };
            dialog.SetFileTypes(&[COMDLG_FILTERSPEC { pszName: label, pszSpec: pattern }])
                .map_err(|_| "无法设置文件格式")?;
            dialog.SetDefaultExtension(extension).map_err(|_| "无法设置扩展名")?;
            let name = basename.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
            dialog.SetFileName(PCWSTR(name.as_ptr())).map_err(|_| "文件名无效")?;
            match dialog.Show(Some(HWND(owner as *mut std::ffi::c_void))) {
                Ok(()) => {}
                Err(error) if error.code().0 as u32 == 0x800704C7 => return Ok(None),
                Err(_) => return Err("无法显示保存窗口".into()),
            }
            let item = dialog.GetResult().map_err(|_| "未选择导出位置")?;
            let pointer = item.GetDisplayName(SIGDN_FILESYSPATH).map_err(|_| "导出位置无效")?;
            let result = pointer.to_string().map_err(|_| "导出位置无效");
            CoTaskMemFree(Some(pointer.0 as *const std::ffi::c_void));
            let path = result?;
            std::fs::write(&path, content).map_err(|_| "无法写入所选位置，请检查目录权限")?;
            Ok(Some(path))
        }
    }).await.map_err(|_| "导出任务失败")?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pick_model_file(_window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    Err("仅在 Windows 上可用".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pick_folder(_window: tauri::WebviewWindow, _initial_folder: Option<String>) -> Result<Option<String>, String> {
    Err("仅在 Windows 上可用".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn pick_file(_window: tauri::WebviewWindow, _initial_folder: Option<String>) -> Result<Option<String>, String> {
    Err("仅在 Windows 上可用".into())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
fn save_role_export(_window: tauri::WebviewWindow, _content: String, _suggested_name: String, _export_kind: Option<String>) -> Result<Option<String>, String> {
    Err("当前仅支持 Windows 角色配置导出。".into())
}

fn main() {
    // Keep app-owned temporary files beside project data, not the system drive.
    // This runs before the async runtime and WebViews create worker threads.
    if let Ok(executable) = std::env::current_exe() {
        for parent in executable.ancestors().skip(1) {
            if parent.join("agent-backend").is_dir() && parent.join("companion-frontend").is_dir() {
                let temp = parent.join("local-mcp").join("app-temp");
                if std::fs::create_dir_all(&temp).is_ok() {
                    std::env::set_var("TEMP", &temp);
                    std::env::set_var("TMP", &temp);
                }
                let cache = parent.join("local-mcp").join("webview-cache");
                if std::fs::create_dir_all(&cache).is_ok() {
                    let mut arguments = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
                    if !arguments.contains("--disk-cache-dir") {
                        arguments.push_str(&format!(" --disk-cache-dir=\"{}\" --disk-cache-size=134217728", cache.display()));
                        std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", arguments);
                    }
                }
                break;
            }
        }
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| restore_app(app)))
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            set_always_on_top,
            start_drag,
            set_ignore_cursor_events,
            hide_window,
            show_window,
            raise_owned_window,
            get_cursor_pos,
            start_voice_typing,
            run_system_action,
            polish_window,
            pick_model_file,
            pick_folder,
            pick_file,
            save_role_export,
            microphone::prepare_microphone_access,
            microphone::prepare_camera_access,
            open_ssh_tunnel_tool,
            model_conversion::convert_model
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "windows")]
            if matches!(event, tauri::WindowEvent::Destroyed) { microphone::forget_window(window); }
            if window.label() == "home" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let pet_win = window.app_handle().get_webview_window("main");
                    let pet_visible = is_window_really_visible(pet_win.as_ref())
                        || window.app_handle().try_state::<HiddenWindows>()
                            .map(|s| s.0.lock().map(|h| h.contains(&"main".to_string())).unwrap_or(false))
                            .unwrap_or(false);
                    let settings_win = window.app_handle().get_webview_window("settings");
                    let settings_visible = is_window_really_visible(settings_win.as_ref());
                    let tutorial_win = window.app_handle().get_webview_window("tutorial");
                    let tutorial_visible = is_window_really_visible(tutorial_win.as_ref());
                    let dialog_win = window.app_handle().get_webview_window("dialog");
                    let dialog_visible = is_window_really_visible(dialog_win.as_ref());

                    if pet_visible || settings_visible || tutorial_visible || dialog_visible {
                        api.prevent_close();
                        let _ = window.hide();
                        #[cfg(target_os = "windows")]
                        if let Ok(hwnd) = window.hwnd() {
                            win_frame::hide(hwnd.0 as isize);
                        }
                    } else {
                        window.app_handle().exit(0);
                    }
                }
            }
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    #[cfg(target_os = "windows")]
                    if let Ok(hwnd) = window.hwnd() {
                        win_frame::hide(hwnd.0 as isize);
                    }
                }
            }
        })
        .setup(|app| {
            #[cfg(target_os = "windows")]
            app.manage(microphone::MicrophonePermissions::default());
            app.manage(HiddenWindows(Mutex::new(Vec::new())));
            // 强制无边框 + 置顶（Windows 上 config 的 decorations:false 首次创建时可能残留标题栏，
            // 这里用 Windows 原生样式位直接去掉，作为最终兜底）
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_always_on_top(false);
                let _ = window.hide();
                #[cfg(target_os = "windows")]
                {
                    let _ = window.set_shadow(false);
                    strip_window_frame(app.handle());
                }
            }

            let data_dir = project_data_dir(app.handle());
            std::fs::create_dir_all(&data_dir)?;
            if let Ok(legacy_dir) = app.path().app_local_data_dir() {
                let empty = std::fs::read_dir(&data_dir).map(|mut entries| entries.next().is_none()).unwrap_or(true);
                if empty && legacy_dir != data_dir && legacy_dir.is_dir() {
                    if let Err(error) = copy_directory_contents(&legacy_dir, &data_dir) {
                        diagnostics::record(&format!("data migration skipped: {error}"));
                    }
                }
            }
            diagnostics::initialize(&data_dir);
            let data_arg = data_dir.to_string_lossy().to_string();
            let local_models = app.path().resource_dir()?.join("local-models");
            let backend_exe = backend_exe_path(app.handle());
            let mut children = Vec::new();
            for service in ["memory-service", "motion-service", "agent-backend"] {
                let mut command = background_command(&backend_exe);
                command
                    .env("DESKAURA_LOCAL_MODELS_DIR", local_models.to_string_lossy().as_ref())
                    .args([service, "--data-dir", &data_arg])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null());
                let child = command.spawn()?;
                diagnostics::record(&format!("service started: {service} pid={}", child.id()));
                children.push(child);
            }
            app.manage(BackendProcesses(Mutex::new(children)));

            let show = MenuItem::with_id(app, "show", "显示 DeskAura", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "隐藏到托盘（保持运行）", true, None::<&str>)?;
            let top = MenuItem::with_id(app, "top", "切换窗口置顶", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &top, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("missing app icon"))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } | TrayIconEvent::DoubleClick { button: MouseButton::Left, .. }) {
                        restore_app(tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| {
                    if let Some(window) = app.get_webview_window("main") {
                        match event.id.as_ref() {
                            "show" => {
                                restore_app(app);
                            }
                            "hide" => {
                                let _ = hide_window(window.clone());
                            }
                            "top" => {
                                let current = window.is_always_on_top().unwrap_or(false);
                                let _ = window.set_always_on_top(!current);
                                let _ = sync_companion_layers(app);
                                let _ = app.emit("deskaura:top-state", !current);
                            }
                            "quit" => app.exit(0),
                            _ => {}
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DeskAura");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            diagnostics::record("desktop exit requested");
            if let Some(processes) = app_handle.try_state::<BackendProcesses>() {
                if let Ok(mut children) = processes.0.lock() {
                    for mut child in children.drain(..) {
                        #[cfg(target_os = "windows")]
                        {
                            let _ = background_command("taskkill")
                                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                                .output();
                        }
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
