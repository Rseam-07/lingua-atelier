$ErrorActionPreference = 'Stop'
Write-Host 'Finish any recording and close Obsidian first. Only Lingua Atelier files will be installed.'
$vault = (Read-Host 'Paste the absolute path of your Obsidian vault').Trim('"')
if (-not (Test-Path (Join-Path $vault '.obsidian'))) { throw 'Default .obsidian folder not found. Use manual installation for a custom config folder.' }
$target = Join-Path $vault '.obsidian\plugins\lingua-atelier'
New-Item -ItemType Directory -Path $target -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($name in @('main.js','manifest.json','styles.css')) {
    $existing = Join-Path $target $name
    if (Test-Path $existing) { Copy-Item -LiteralPath $existing -Destination "$existing.backup-$stamp" }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "lingua-atelier\$name") -Destination $existing -Force
}
Write-Host 'Open Obsidian and enable Lingua Atelier in Community plugins.'
Write-Host 'For local speech recognition, run desktop-service\Setup-Windows.ps1 next.'
Read-Host 'Press Enter to close'
