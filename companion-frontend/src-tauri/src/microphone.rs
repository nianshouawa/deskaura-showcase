//! Explicit, remembered device consent for trusted DeskAura WebViews.
//! Does not change Windows privacy settings or grant remote-site access.

#[cfg(target_os = "windows")]
mod platform {
    use std::{collections::HashMap, sync::{Arc, Mutex, mpsc}, time::{Duration, Instant}};
    use tauri::{Manager, WebviewWindow};
    use windows::{core::{Interface, PCWSTR, PWSTR, w}, Win32::{Foundation::{HWND, E_FAIL},
        System::Com::CoTaskMemFree, UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONQUESTION, MB_YESNO}}};
    use webview2_com::{PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2_13, ICoreWebView2Profile4,
        ICoreWebView2PermissionRequestedEventArgs3, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW, COREWEBVIEW2_PERMISSION_STATE_DENY}};

    #[derive(Default)]
    struct Gate { consent: bool, installed: bool, until: Option<Instant> }

    #[derive(Default)]
    pub struct MicrophonePermissions(
        Mutex<HashMap<(isize, bool), Arc<Mutex<Gate>>>>,
        tauri::async_runtime::Mutex<()>,
    );

    fn trusted_origin(url: &tauri::Url) -> bool {
        if !url.username().is_empty() || url.password().is_some() { return false }
        matches!((url.scheme(), url.host_str(), url.port_or_known_default()),
            ("http", Some("tauri.localhost"), Some(80)) |
            ("https", Some("tauri.localhost"), Some(443))) ||
            cfg!(debug_assertions) && matches!((url.scheme(), url.host_str(), url.port()),
                ("http", Some("localhost" | "127.0.0.1"), Some(1420)))
    }

    fn allowed_window(label: &str, camera: bool) -> bool {
        matches!(label, "home" | "dialog") || camera && matches!(label, "main" | "settings")
    }

    pub fn forget_window(window: &tauri::Window) {
        if let (Ok(hwnd), Some(state)) = (window.hwnd(), window.app_handle().try_state::<MicrophonePermissions>()) {
            if let Ok(mut gates) = state.0.lock() { gates.retain(|(key, _), _| *key != hwnd.0 as isize); }
        }
    }

    /// Called only from the normal record-button click, immediately before
    /// getUserMedia. Consent is visible, never inferred from cloud credentials.
    pub async fn prepare_access(window: WebviewWindow, camera: bool) -> Result<(), String> {
        let url = window.url().map_err(|_| "无法检查录音窗口来源")?;
        if !allowed_window(window.label(), camera) || !trusted_origin(&url) ||
            url.path() != "/" || !window.is_visible().unwrap_or(false) {
            return Err(if camera { "请先应用桌面角色，并将追踪目标选为人脸或自动；通话摄像头请在聊天中开启。" }
                else { "此窗口不允许录音，请从主页或聊天窗口点击麦克风。" }.into());
        }
        let hwnd = window.hwnd().map_err(|_| "无法获取录音窗口")?.0 as isize;
        let state = window.state::<MicrophonePermissions>();
        let gate = state.0.lock().map_err(|_| "麦克风权限状态不可用")?
            .entry((hwnd, camera)).or_default().clone();
        let consent_guard = state.1.lock().await;
        let consent_path = window.app_handle().path().app_local_data_dir()
            .map_err(|_| "无法读取设备授权目录")?.join("device-consent.txt");
        let device = if camera { "camera" } else { "microphone" };
        let remembered = std::fs::read_to_string(&consent_path).unwrap_or_default();
        let consent = gate.lock().map_err(|_| "麦克风权限状态不可用")?.consent
            || remembered.lines().any(|line| line == device);
        if !consent {
            let accepted = tauri::async_runtime::spawn_blocking(move || unsafe {
                let text = if camera { w!("允许 DeskAura 使用摄像头并记住此选择吗？\n\n人脸追随在本机计算，不发送图像。通话画面仅本地预览；仅当用户有查看意图且确认本次截图/短时采集后，才会向支持图片的对话服务发送画面，可能收费。普通消息不会自动附带截图。\n可在设置关闭视觉模块或通话摄像头；隐藏程序会停止采集。Windows 隐私设置仍可禁止设备访问。") }
                    else { w!("允许 DeskAura 使用麦克风并记住此选择吗？\n\n点击麦克风后开始录音；通话中会持续分句识别，文字与普通对话一样保存。声音发送到你配置的语音识别服务，可能收费。\n可随时静音、挂断或关闭听觉模块；隐藏程序会停止录音。此授权不包含摄像头。Windows 隐私设置仍可禁止设备访问。") };
                MessageBoxW(Some(HWND(hwnd as *mut _)), text,
                    w!("DeskAura · 设备授权"), MB_YESNO | MB_ICONQUESTION) == IDYES
            }).await.map_err(|_| "无法显示麦克风授权提示")?;
            if !accepted { return Err(if camera { "你尚未允许摄像头，未开始采集。" } else { "你尚未允许麦克风。需要时再次点击录音按钮即可重新授权。" }.into()); }
            if let Some(parent) = consent_path.parent() {
                std::fs::create_dir_all(parent).map_err(|_| "无法保存设备授权")?;
            }
            std::fs::write(&consent_path, format!("{remembered}\n{device}\n"))
                .map_err(|_| "无法保存设备授权")?;
        }
        gate.lock().map_err(|_| "麦克风权限状态不可用")?.consent = true;
        drop(consent_guard);
        // Each explicit button press opens only a short request window. A later
        // unrelated request cannot reuse a blanket permission grant.
        gate.lock().map_err(|_| "麦克风权限状态不可用")?.until = Some(Instant::now() + Duration::from_secs(15));
        let origin = url.origin().ascii_serialization();
        let permission_kind = if camera { COREWEBVIEW2_PERMISSION_KIND_CAMERA } else { COREWEBVIEW2_PERMISSION_KIND_MICROPHONE };
        let (tx, rx) = mpsc::channel();
        let callback_gate = gate.clone();
        window.with_webview(move |view| {
            let result: windows::core::Result<()> = (|| unsafe {
                let core = view.controller().CoreWebView2()?;
                // Never unwind through a WebView2/COM callback if another
                // permission task has poisoned the shared state.
                if !callback_gate.lock().map_err(|_| windows::core::Error::from_hresult(E_FAIL))?.installed {
                    let request_gate = callback_gate.clone();
                    let mut token = 0;
                    core.add_PermissionRequested(&PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        if kind != permission_kind { return Ok(()) }
                        let mut raw = PWSTR::null();
                        args.Uri(&mut raw)?;
                        let source = raw.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(raw.0 as *const _));
                        let trusted = tauri::Url::parse(&source).ok().is_some_and(|u| trusted_origin(&u));
                        let allow = request_gate.lock().map(|mut state| state.consent &&
                            trusted && state.until.take().is_some_and(|until| until > Instant::now())).unwrap_or(false);
                        // Prevent a user decision from silently persisting in the
                        // shared WebView profile across future app launches.
                        let args3 = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()?;
                        args3.SetSavesInProfile(false)?;
                        args.SetState(if allow { COREWEBVIEW2_PERMISSION_STATE_ALLOW } else { COREWEBVIEW2_PERMISSION_STATE_DENY })?;
                        Ok(())
                    })), &mut token)?;
                    callback_gate.lock().map_err(|_| windows::core::Error::from_hresult(E_FAIL))?.installed = true;
                }
                // A previous default WebView2 "deny" can short-circuit the
                // PermissionRequested event. Reset only this trusted origin's
                // microphone decision, after the explicit native consent above.
                let profile = core.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile4>()?;
                let origin: Vec<u16> = origin.encode_utf16().chain(Some(0)).collect();
                let complete = tx.clone();
                profile.SetPermissionState(permission_kind,
                    PCWSTR(origin.as_ptr()), COREWEBVIEW2_PERMISSION_STATE_DEFAULT,
                    &SetPermissionStateCompletedHandler::create(Box::new(move |result| {
                        let _ = complete.send(result.map_err(|_| "无法重置麦克风的旧授权记录。".to_string()));
                        Ok(())
                    })))?;
                Ok(())
            })();
            if result.is_err() { let _ = tx.send(Err("当前 WebView2 无法准备麦克风权限，请更新 Microsoft Edge WebView2 Runtime 后重试。".to_string())); }
        }).map_err(|_| "无法向录音窗口请求麦克风权限")?;
        tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "准备麦克风权限超时，请重试。".to_string())?)
            .await.map_err(|_| "准备麦克风权限失败".to_string())?
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn microphone_is_never_granted_to_remote_or_lookalike_origins() {
            for value in ["https://example.com", "https://tauri.localhost.evil.test/", "http://tauri.localhost:8000/",
                "https://evil@tauri.localhost/", "http://localhost:8000/", "file:///C:/test.html", "tauri://localhost/"] {
                assert!(!trusted_origin(&tauri::Url::parse(value).unwrap()), "{value}");
            }
            for value in ["http://tauri.localhost/", "https://tauri.localhost/?dialog=1"] {
                assert!(trusted_origin(&tauri::Url::parse(value).unwrap()), "{value}");
            }
        }

        #[test]
        fn default_gate_never_implies_consent_or_a_pending_microphone_request() {
            let gate = Gate::default();
            assert!(!gate.consent && !gate.installed && gate.until.is_none());
        }

        #[test]
        fn settings_can_explicitly_test_camera_but_not_record_microphone() {
            assert!(allowed_window("settings", true));
            assert!(!allowed_window("settings", false));
            assert!(!allowed_window("tutorial", true));
            assert!(!allowed_window("unknown", true));
        }
    }
}

#[cfg(target_os = "windows")]
pub use platform::MicrophonePermissions;
#[cfg(target_os = "windows")]
pub use platform::forget_window;

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn prepare_microphone_access(window: tauri::WebviewWindow) -> Result<(), String> {
    platform::prepare_access(window, false).await
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn prepare_camera_access(window: tauri::WebviewWindow) -> Result<(), String> {
    platform::prepare_access(window, true).await
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn prepare_camera_access() -> Result<(), String> { Ok(()) }

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub async fn prepare_microphone_access() -> Result<(), String> { Ok(()) }
