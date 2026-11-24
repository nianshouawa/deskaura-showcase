@echo off
set "RELEASE_DIR=%~dp0..\companion-frontend\src-tauri\target\release"
set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9235"
start "" /D "%RELEASE_DIR%" "%RELEASE_DIR%\deskaura.exe"
