#![cfg(windows)]

// Exercise the actual vendored HWND code, not a second implementation.
#[allow(dead_code)]
#[path = "../vendor/tauri-runtime-wry/src/undecorated_resizing.rs"]
mod undecorated_resizing;

mod util {
    use windows::Win32::{Foundation::HWND, UI::WindowsAndMessaging::{GetSystemMetrics, SYSTEM_METRICS_INDEX}};
    pub unsafe fn hwnd_dpi(_: HWND) -> u32 { 96 }
    pub unsafe fn get_system_metrics_for_dpi(index: SYSTEM_METRICS_INDEX, _: u32) -> i32 {
        GetSystemMetrics(index)
    }
}

use windows::{core::w, Win32::{Foundation::*, UI::WindowsAndMessaging::*}};
use undecorated_resizing::*;

#[test]
fn native_resize_attach_detach_recreate_and_parent_destroy_are_safe() {
    unsafe {
        for cycle in 0..160 {
            let parent = CreateWindowExW(
                WINDOW_EX_STYLE::default(), w!("STATIC"), w!("DeskAura resize lifecycle test"),
                WS_OVERLAPPEDWINDOW, 0, 0, 520, 400, None, None, None, None,
            ).unwrap();
            for shadows in [false, true, false] {
                attach_resize_handler(parent.0 as isize, shadows);
                attach_resize_handler(parent.0 as isize, shadows);
                let child = FindWindowExW(Some(parent), None,
                    w!("TAURI_DRAG_RESIZE_BORDERS"), w!("TAURI_DRAG_RESIZE_WINDOW")).unwrap();
                assert_ne!(GetWindowLongPtrW(child, GWLP_USERDATA), 0);
                for new_shadows in [true, false] {
                    update_drag_hwnd_rgn_for_undecorated(parent.0 as isize, new_shadows);
                    assert_eq!(GetWindowLongPtrW(child, GWLP_USERDATA) & 2 != 0, new_shadows);
                    SendMessageW(parent, WM_SIZE, Some(WPARAM(0)), Some(LPARAM(0)));
                }
                if cycle % 2 == 0 {
                    // A child can disappear independently; the next attach must
                    // release, not overwrite, its old parent subclass refdata.
                    DestroyWindow(child).unwrap();
                }
                detach_resize_handler(parent.0 as isize);
                detach_resize_handler(parent.0 as isize);
                assert!(FindWindowExW(Some(parent), None,
                    w!("TAURI_DRAG_RESIZE_BORDERS"), w!("TAURI_DRAG_RESIZE_WINDOW")).is_err());
            }
            attach_resize_handler(parent.0 as isize, true);
            DestroyWindow(parent).unwrap();
        }
    }
}
