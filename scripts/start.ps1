$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) { throw '未找到 .venv。请先运行 scripts\setup.ps1。' }
$data = Join-Path (Split-Path -Parent $root) 'DeskAura-Data'
New-Item -ItemType Directory -Force -Path $data | Out-Null
foreach ($service in @('memory-service', 'motion-service', 'agent-backend')) {
    Start-Process -FilePath $python -ArgumentList @('"' + (Join-Path $root 'scripts\run_service.py') + '"', $service, '--data-dir', '"' + $data + '"') -WorkingDirectory $root -WindowStyle Hidden
}
Start-Sleep -Seconds 2
Set-Location (Join-Path $root 'companion-frontend')
npm.cmd run dev
