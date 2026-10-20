$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Lingua Atelier'
& (Join-Path $root 'asr-venv\Scripts\python.exe') (Join-Path $root 'start_service.py') --share
if ($LASTEXITCODE -ne 0) { Read-Host 'Service stopped. Press Enter to close' }
