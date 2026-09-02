<#
  viewer Agent · exclusiones de antivirus
  ---------------------------------------
  Evita que Windows Defender y Kaspersky pongan en cuarentena o borren el agente.

  Ejecutar en PowerShell COMO ADMINISTRADOR en el equipo:
      powershell -ExecutionPolicy Bypass -File av-exclusions.ps1

  Para quitar las exclusiones de Defender:
      powershell -ExecutionPolicy Bypass -File av-exclusions.ps1 -Remove
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'SilentlyContinue'
$InstallDir = Join-Path $env:ProgramData 'ViewerAgent'
$Exe        = Join-Path $InstallDir 'viewer-agent.exe'
$ProcNames  = @('viewer-agent.exe', 'viewer-setup*.exe')

# Rutas de la extracción temporal de PyInstaller (onefile) para todos los usuarios
$TempMei = @(
  (Join-Path $env:TEMP '_MEI*'),
  'C:\Windows\Temp\_MEI*',
  'C:\Users\*\AppData\Local\Temp\_MEI*'
)

function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error 'Ejecuta este script como Administrador.'
    exit 1
  }
}
Assert-Admin

# ============================ WINDOWS DEFENDER =============================== #
if (Get-Command Add-MpPreference -ErrorAction SilentlyContinue) {
  if ($Remove) {
    Write-Host 'Quitando exclusiones de Windows Defender...'
    Remove-MpPreference -ExclusionPath $InstallDir
    foreach ($p in $TempMei) { Remove-MpPreference -ExclusionPath $p }
    foreach ($n in $ProcNames) { Remove-MpPreference -ExclusionProcess $n }
    Remove-MpPreference -ExclusionProcess $Exe
  } else {
    Write-Host 'Añadiendo exclusiones de Windows Defender...'
    Add-MpPreference -ExclusionPath $InstallDir
    foreach ($p in $TempMei) { Add-MpPreference -ExclusionPath $p }
    foreach ($n in $ProcNames) { Add-MpPreference -ExclusionProcess $n }
    Add-MpPreference -ExclusionProcess $Exe
    Write-Host '  OK - Defender: carpeta, procesos y _MEI* excluidos.' -ForegroundColor Green
  }
} else {
  Write-Host 'Windows Defender no está disponible (otro AV lo ha sustituido).' -ForegroundColor Yellow
}

if ($Remove) { return }

# ================================ KASPERSKY ================================= #
# Kaspersky (KES / KAV / KSC) NO permite añadir exclusiones de zona de confianza
# por línea de comandos. Hay dos vías correctas:
#
#  A) FLOTA con Kaspersky Security Center (lo habitual en empresa):
#     Consola KSC -> Directivas -> [directiva de KES del grupo] ->
#       Configuración general -> Exclusiones y aplicaciones de confianza ->
#       Configuración -> Zona de confianza -> Añadir:
#         · Archivo o carpeta:  C:\ProgramData\ViewerAgent
#         · Archivo o carpeta:  %Temp%\_MEI*   (marca "incluir subcarpetas")
#         · Proceso:            C:\ProgramData\ViewerAgent\viewer-agent.exe
#         · Proceso:            viewer-setup*.exe
#       Marca "No analizar tráfico de red" y "No analizar actividad de la aplicación".
#     Aplica la directiva y fuerza la sincronización de los equipos.
#
#  B) EQUIPO SUELTO (Kaspersky local, sin KSC):
#     Abre Kaspersky -> Configuración (rueda dentada) -> Seguridad ->
#       Exclusiones y acciones con objetos detectados / Zona de confianza ->
#       Administrar exclusiones / Especificar aplicaciones de confianza -> Añadir
#     los mismos elementos de la lista de arriba.
#
# Este script detecta Kaspersky, deja los datos listos para copiar y abre la
# ventana de ajustes si puede.

$kasp = Get-CimInstance Win32_Product -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like '*Kaspersky*' } | Select-Object -First 1
$avpUi = Get-ChildItem 'C:\Program Files (x86)\Kaspersky Lab','C:\Program Files\Kaspersky Lab' -Recurse -Filter 'avpui.exe' -ErrorAction SilentlyContinue | Select-Object -First 1

if ($kasp -or $avpUi) {
  Write-Host ''
  Write-Host '=== KASPERSKY detectado ===' -ForegroundColor Cyan
  if ($kasp) { Write-Host ("  Producto: {0} {1}" -f $kasp.Name, $kasp.Version) }
  Write-Host '  Kaspersky no admite exclusiones por comando. Añade estos elementos'
  Write-Host '  a la Zona de confianza (por directiva de KSC o en el equipo):' -ForegroundColor Yellow
  Write-Host ''
  Write-Host "    Carpeta:  $InstallDir"
  Write-Host "    Carpeta:  %Temp%\_MEI*   (incluir subcarpetas)"
  Write-Host "    Proceso:  $Exe"
  Write-Host "    Proceso:  viewer-setup*.exe"
  Write-Host ''
  # Deja un .txt en el escritorio público para copiar/pegar
  $txt = Join-Path $env:PUBLIC 'Desktop\viewer-agent-exclusiones-kaspersky.txt'
  @(
    'Zona de confianza de Kaspersky - viewer Agent',
    '---------------------------------------------',
    "Carpeta: $InstallDir",
    'Carpeta: %Temp%\_MEI*   (incluir subcarpetas)',
    "Proceso: $Exe",
    'Proceso: viewer-setup*.exe',
    '',
    'Marcar: no analizar trafico de red / no analizar actividad de la aplicacion.'
  ) | Set-Content -Encoding UTF8 $txt
  Write-Host "  Guardado para copiar: $txt" -ForegroundColor Green
  if ($avpUi) {
    Write-Host '  Abriendo la ventana de Kaspersky...'
    Start-Process $avpUi.FullName
  }
} else {
  Write-Host 'Kaspersky no detectado en este equipo.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Hecho.' -ForegroundColor Green
Write-Host 'Nota: la solución definitiva a los falsos positivos es firmar el .exe'
Write-Host 'con un certificado de firma de código (Authenticode). Sin firma, algunos'
Write-Host 'motores heurísticos pueden marcarlo aunque haya exclusiones.'
