$ErrorActionPreference = 'Stop'
$root = 'D:\Agent code\Project\DeskAura'
$exe = Join-Path $root 'companion-frontend\src-tauri\target\release\deskaura.exe'

$action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory (Split-Path $exe)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddYears(-1)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Unregister-ScheduledTask -TaskName 'DeskAuraApp' -Confirm:$false -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName 'DeskAuraApp' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName 'DeskAuraApp'
Write-Output 'app task started'
