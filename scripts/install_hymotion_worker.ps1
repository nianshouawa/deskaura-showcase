$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$worker = Join-Path $root 'hymotion-worker'
if (-not (Test-Path -LiteralPath $worker)) {
    git clone --depth 1 https://github.com/Tencent-Hunyuan/HY-Motion-1.0.git $worker
}
Set-Location $worker
git lfs pull
Write-Host 'HY-Motion source downloaded.'
Write-Host 'This project requires a GPU worker with about 24-26 GB VRAM.'
Write-Host 'Install PyTorch for that GPU, then run: pip install -r requirements.txt'
Write-Host 'Download Lite weights: huggingface-cli download tencent/HY-Motion-1.0 --include "HY-Motion-1.0-Lite/*" --local-dir ckpts/tencent'
Write-Host 'Start the worker with scripts\hymotion_worker.py after copying it into this folder.'
