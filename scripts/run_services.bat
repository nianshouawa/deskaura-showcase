@echo off
cd /d "%~dp0.."
start "DeskAura Memory" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" memory-service --data-dir "%~dp0..\..\DeskAura-Data"
timeout /t 1 /nobreak >nul
start "DeskAura Motion" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" motion-service --data-dir "%~dp0..\..\DeskAura-Data"
timeout /t 1 /nobreak >nul
start "DeskAura Agent" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" agent-backend --data-dir "%~dp0..\..\DeskAura-Data"
