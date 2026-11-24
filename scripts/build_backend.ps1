$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$dist = Join-Path $root 'companion-frontend\src-tauri\binaries'
$temp = Join-Path $root 'build\temp'
New-Item -ItemType Directory -Force -Path $temp | Out-Null
$env:TEMP = $temp
$env:TMP = $temp
$env:PYINSTALLER_CONFIG_DIR = Join-Path $root 'build\pyinstaller-cache'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
& $python (Join-Path $root 'scripts\prepare_local_models.py')
if ($LASTEXITCODE -ne 0) { throw 'Local model preparation failed' }
$mcpPackages = @('--additional-hooks-dir', (Join-Path $root 'scripts\pyinstaller-hooks'), '--hidden-import', 'mcp', '--collect-all', 'sse_starlette', '--collect-all', 'jsonschema', '--collect-all', 'jsonschema_specifications', '--collect-all', 'referencing')
& $python -m PyInstaller --noconfirm --clean --onedir --name deskaura-backend-x86_64-pc-windows-msvc --distpath (Join-Path $root 'build\pyinstaller-dist') --workpath (Join-Path $root 'build\pyinstaller') --specpath (Join-Path $root 'build') --paths $root --paths (Join-Path $root 'agent-backend') --paths (Join-Path $root 'memory-service') --paths (Join-Path $root 'motion-service') --add-data "$(Join-Path $root 'deskaura_local');deskaura_local" --add-data "$(Join-Path $root 'agent-backend\app');agent-backend/app" --add-data "$(Join-Path $root 'memory-service\app');memory-service/app" --add-data "$(Join-Path $root 'motion-service\app');motion-service/app" --add-data "$(Join-Path $root 'motion-service\data\cloud_motions');motion-service/data/cloud_motions" --hidden-import sqlite3 --hidden-import _sqlite3 --hidden-import wave --hidden-import xml.sax.saxutils --collect-all fastapi --collect-all starlette --collect-all pydantic --collect-all httpx --collect-all openai --collect-all langchain_core --collect-all langgraph --collect-all keyring --collect-all memu --copy-metadata memu-cli --collect-all sqlalchemy --collect-all sqlmodel --collect-all numpy --collect-all pypdf --collect-all docx --collect-all onnxruntime --collect-all tokenizers --collect-all sherpa_onnx --collect-all sherpa_onnx_core @mcpPackages (Join-Path $root 'scripts\run_service.py')
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed' }
$builtBackend = Join-Path $root 'build\pyinstaller-dist\deskaura-backend-x86_64-pc-windows-msvc'
if (-not (Test-Path $builtBackend)) { throw 'Backend onedir output not found' }
$releaseBackend = Join-Path $root 'companion-frontend\src-tauri\target\release\deskaura-backend'
$bundleBackend = Join-Path $root 'companion-frontend\src-tauri\binaries\deskaura-backend'
foreach ($target in @($releaseBackend, $bundleBackend)) {
    $absolute = [IO.Path]::GetFullPath($target)
    $expected = [IO.Path]::GetFullPath($root) + [IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($expected, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $absolute) -ne 'deskaura-backend') {
        throw 'Backend replacement target is outside the project'
    }
    if (Test-Path -LiteralPath $absolute) { Remove-Item -LiteralPath $absolute -Recurse -Force }
}
# Keep the packaged sidecar as a normal resource file. Hard-linking the
# PyInstaller output can make Windows/Tauri resource scanning report a
# transient sharing violation while the builder is still closing handles.
Copy-Item -LiteralPath $builtBackend -Destination $bundleBackend -Recurse -Force
New-Item -ItemType Directory -Path $releaseBackend -Force | Out-Null
foreach ($file in @(Get-ChildItem -LiteralPath $bundleBackend -File -Recurse)) {
    $relative = $file.FullName.Substring($bundleBackend.Length + 1)
    $destination = Join-Path $releaseBackend $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}
$releaseModels = Join-Path $root 'companion-frontend\src-tauri\target\release\local-models'
New-Item -ItemType Directory -Force -Path $releaseModels | Out-Null
$modelRoot = Join-Path $root 'local-models'
foreach ($file in @(Get-ChildItem -LiteralPath $modelRoot -File -Recurse)) {
    $destination = Join-Path $releaseModels $file.FullName.Substring($modelRoot.Length + 1)
    New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
    if (Test-Path -LiteralPath $destination) {
        Remove-Item -LiteralPath $destination -Force
    }
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}
