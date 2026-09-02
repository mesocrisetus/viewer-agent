# Instalador del agente Vigía para Windows.
# Ejecutar en PowerShell como administrador desde la carpeta del agente.
#
#   powershell -ExecutionPolicy Bypass -File install\install-windows.ps1
#
# Registra el agente para que arranque con la sesión del usuario (tarea
# programada). No oculta el proceso: aparece como "VigiaAgent" y el icono de
# bandeja queda visible.

$ErrorActionPreference = "Stop"
$AgentDir = Split-Path -Parent $PSScriptRoot
Set-Location $AgentDir

if (-not (Test-Path "$AgentDir\config.json")) {
    Write-Error "Falta config.json. Copia config.example.json a config.json y rellena serverUrl y enrollToken."
}

# 1. Entorno virtual + dependencias
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { $py = (Get-Command py -ErrorAction SilentlyContinue).Source }
if (-not $py) { Write-Error "No se encuentra Python. Instala Python 3.10+ y vuelve a ejecutar." }

Write-Host "Creando entorno virtual..."
& $py -m venv "$AgentDir\.venv"
& "$AgentDir\.venv\Scripts\python.exe" -m pip install --upgrade pip
& "$AgentDir\.venv\Scripts\python.exe" -m pip install -r "$AgentDir\requirements.txt"

# 2. Lanzador
$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$AgentDir"
sh.Run """$AgentDir\.venv\Scripts\pythonw.exe"" -m vigia_agent", 0, False
"@
Set-Content -Path "$AgentDir\run-agent.vbs" -Value $vbs -Encoding ASCII

# 3. Tarea programada al iniciar sesión
$taskName = "VigiaAgent"
schtasks /Query /TN $taskName 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { schtasks /Delete /TN $taskName /F | Out-Null }

schtasks /Create /TN $taskName /TR "wscript.exe `"$AgentDir\run-agent.vbs`"" `
    /SC ONLOGON /RL LIMITED /F | Out-Null

Write-Host "Instalado. Arranca ahora con: schtasks /Run /TN $taskName"
Write-Host "Se iniciará automáticamente en el próximo inicio de sesión."
