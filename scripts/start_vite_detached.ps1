$ErrorActionPreference = 'Stop'
$root = 'D:\Agent code\Project\DeskAura'
$fe = Join-Path $root 'companion-frontend'
$logDir = Join-Path $root 'build\svc-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$bat = Join-Path $root 'scripts\run_vite.bat'

@"
@echo off
cd /d "$fe"
npm run dev > "$logDir\vite.log" 2>&1
"@ | Set-Content -Path $bat -Encoding ASCII

$action = New-ScheduledTaskAction -Execute $bat
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(-1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName 'DeskAuraVite' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'DeskAuraVite' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'DeskAuraVite'
Write-Output 'vite task started'
