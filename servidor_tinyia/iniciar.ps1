$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonServidor = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $pythonServidor) {
    & $pythonServidor (Join-Path $PSScriptRoot 'servidor.py') @args
} else {
    python (Join-Path $PSScriptRoot 'servidor.py') @args
}

