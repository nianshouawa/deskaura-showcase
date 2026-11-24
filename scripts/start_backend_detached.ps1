$ErrorActionPreference = 'Stop'
$root = 'D:\Agent code\Project\DeskAura'
$logDir = Join-Path $root 'build\svc-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$bat = Join-Path $root 'scripts\run_services.bat'

@"
@echo off
cd /d "%~dp0.."
start "DeskAura Memory" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" memory-service --data-dir "%~dp0..\..\DeskAura-Data"
timeout /t 1 /nobreak >nul
start "DeskAura Motion" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" motion-service --data-dir "%~dp0..\..\DeskAura-Data"
timeout /t 1 /nobreak >nul
start "DeskAura Agent" /MIN "%~dp0..\companion-frontend\src-tauri\target\release\deskaura-backend\deskaura-backend-x86_64-pc-windows-msvc.exe" agent-backend --data-dir "%~dp0..\..\DeskAura-Data"
"@ | Set-Content -Path $bat -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $bat
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(-1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Seconds 30) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName 'DeskAuraServices' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'DeskAuraServices' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'DeskAuraServices'
Write-Output 'task started'
