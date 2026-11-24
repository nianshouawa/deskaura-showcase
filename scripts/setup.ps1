$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
if (-not (Test-Path -LiteralPath $py)) { winget install --id Python.Python.3.12 --exact --silent --accept-package-agreements --accept-source-agreements --disable-interactivity }
if (-not (Test-Path -LiteralPath (Join-Path $root '.venv\Scripts\python.exe'))) { & $py -m venv (Join-Path $root '.venv') }
$python = Join-Path $root '.venv\Scripts\python.exe'
& $python -m pip install -r (Join-Path $root 'memory-service\requirements.txt') -r (Join-Path $root 'motion-service\requirements.txt') -r (Join-Path $root 'agent-backend\requirements.txt') pyinstaller
Set-Location (Join-Path $root 'companion-frontend')
npm.cmd install
Write-Host 'DeskAura 开发环境安装完成。运行 scripts\start.ps1 启动。'
