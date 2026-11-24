$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$prefix = $root.TrimEnd('\') + '\'
$installer = Join-Path $root 'release\DeskAura_0.1.0_x64-setup.exe'
if (-not (Test-Path -LiteralPath $installer)) { throw 'Distribution installer is missing' }
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
$targets = @(
    'build\pyinstaller', 'build\pyinstaller-dist', 'build\pyinstaller-cache', 'build\temp',
    'companion-frontend\src-tauri\target\debug',
    'companion-frontend\src-tauri\target\release\.fingerprint',
    'companion-frontend\src-tauri\target\release\build',
    'companion-frontend\src-tauri\target\release\deps',
    'companion-frontend\src-tauri\target\release\incremental',
    'companion-frontend\src-tauri\target\release\examples',
    'companion-frontend\src-tauri\target\release\bundle',
    'companion-frontend\src-tauri\target\release\nsis',
    'companion-frontend\src-tauri\target\release\deskaura.pdb',
    'companion-frontend\src-tauri\target\release\deskaura.d',
    'companion-frontend\dist', 'companion-frontend\.pytest_cache',
    '.pytest_cache', 'agent-backend\.pytest_cache', 'memory-service\.pytest_cache',
    'motion-service\.pytest_cache', 'build\document-qa',
    'build\final-audit\guide.png', 'build\final-audit\home-description.png',
    'build\final-audit\mcp-overflow.png', 'build\final-audit\mcp-single.png',
    'build\final-audit\persona-template.png', 'build\final-audit\zoom-angle.png',
    'build\final-audit\cleanup.json'
)
$targets += @(Get-ChildItem -LiteralPath (Join-Path $root 'build') -Directory -Filter 'packaged-smoke-*' |
    ForEach-Object { 'build\' + $_.Name })
foreach ($source in @('agent-backend', 'memory-service', 'motion-service', 'deskaura_local', 'scripts')) {
    $targets += @(Get-ChildItem -LiteralPath (Join-Path $root $source) -Directory -Recurse -Filter '__pycache__' |
        ForEach-Object { $_.FullName.Substring($prefix.Length) })
}
$removed = @()
foreach ($relative in $targets) {
    try {
    $path = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Outside workspace' }
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $resolved = (Resolve-Path -LiteralPath $path).Path
    if (-not $resolved.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Resolved outside workspace' }
    $entry = Get-Item -LiteralPath $resolved -Force
    if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked target: $resolved" }
    if ($entry.PSIsContainer) {
        $links = Get-ChildItem -LiteralPath $resolved -Directory -Recurse -Force |
            Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }
        if ($links) { throw "Linked child directory: $resolved" }
        $bytes = (Get-ChildItem -LiteralPath $resolved -File -Recurse -Force | Measure-Object Length -Sum).Sum
    } else { $bytes = $entry.Length }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    $removed += [pscustomobject]@{ Path = $relative; Bytes = $bytes }
    } catch {
        Write-Warning ("Skipped {0}: {1}" -f $relative, $_.Exception.Message)
    }
}
if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $hash) { throw 'Installer changed' }
$report = Join-Path $root 'build\final-audit'
New-Item -ItemType Directory -Path $report -Force | Out-Null
$removed | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $report 'workspace-cleanup.json') -Encoding utf8
$removed | Format-Table -AutoSize
Write-Output ('Removed {0} entries; logical size {1:N2} GiB; distribution installer unchanged.' -f
    $removed.Count, (($removed | Measure-Object Bytes -Sum).Sum / 1GB))
