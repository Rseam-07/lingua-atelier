$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Write-Host 'Lingua Atelier: downloads Python, dependencies and the Qwen model (several GB).'
Write-Host 'Does not read notes or upload audio. Windows backend is experimental.'
if ((Read-Host 'Continue? Type y') -ne 'y') { exit }
if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This setup currently targets x64 Windows. Other devices may connect to an existing speech service.' }
$work = Join-Path ([IO.Path]::GetTempPath()) ('lingua-setup-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $archive = Join-Path $work 'uv.zip'
    Invoke-WebRequest -Uri 'https://files.pythonhosted.org/packages/8b/f0/bf4274a0d2121d013a01e4e1c2550a0d307055d9524bead3c51bf424569d/uv-0.13.3-py3-none-win_amd64.whl' -OutFile $archive
    if ((Get-FileHash -Algorithm SHA256 $archive).Hash.ToLower() -ne '62d1d071693d0e2c92ba86266e2c83d885b8d1930e368b6b9704a443e55a190d') { throw 'Download checksum mismatch.' }
    Expand-Archive -LiteralPath $archive -DestinationPath $work
    $uv = Join-Path $work 'uv-0.13.3.data\scripts\uv.exe'
    & $uv run --python 3.12 --no-project --no-config --with huggingface-hub==0.36.0 setup_runtime.py --uv $uv --yes
    if ($LASTEXITCODE -ne 0) { throw 'Speech service setup did not complete.' }
} finally { Remove-Item -LiteralPath $work -Recurse -Force }
Read-Host 'Finished. Press Enter to close'
