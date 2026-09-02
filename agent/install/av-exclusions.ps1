<#
=============================================================================
  viewer Agent · exclusiones de antivirus  (Windows Defender + Kaspersky)
=============================================================================
  Evita que Windows Defender y Kaspersky pongan en cuarentena, bloqueen o
  borren el agente.

  EJECUTAR COMO ADMINISTRADOR:
    powershell -ExecutionPolicy Bypass -File av-exclusions.ps1

  Quitar las exclusiones de Defender:
    powershell -ExecutionPolicy Bypass -File av-exclusions.ps1 -Remove

  El instalador del agente ya añade las de Defender automáticamente; este
  script sirve para volver a aplicarlas, revisarlas o hacerlo en equipos
  gestionados. Kaspersky NO admite exclusiones por comando: el script deja la
  lista lista para copiar y abre la ventana de ajustes.
=============================================================================
#>
[CmdletBinding()]
param([switch]$Remove)

$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$InstallDir = Join-Path $env:ProgramData 'ViewerAgent'
$Exe        = Join-Path $InstallDir 'viewer-agent.exe'

# Rutas a excluir (carpeta de instalación + extracción temporal de PyInstaller).
$Paths = @(
    $InstallDir
    'C:\Windows\Temp\_MEI*'
    'C:\Users\*\AppData\Local\Temp\_MEI*'
    (Join-Path $env:TEMP '_MEI*')
)
# Procesos a excluir (por ruta completa y por nombre).
$Procs = @(
    $Exe
    'viewer-agent.exe'
    'viewer-setup*.exe'
)

# --------------------------------------------------------------------------- #
function Assert-Admin {
    $p = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Este script debe ejecutarse COMO ADMINISTRADOR." -ForegroundColor Red
        Write-Host "  Clic derecho en PowerShell -> 'Ejecutar como administrador' y vuelve a lanzarlo."
        exit 1
    }
}
function Line { Write-Host ('-' * 68) -ForegroundColor DarkGray }

Assert-Admin
Write-Host ""
Write-Host "  viewer Agent · exclusiones de antivirus" -ForegroundColor Cyan
Line
Write-Host "  Carpeta:  $InstallDir"
Write-Host "  Proceso:  viewer-agent.exe   (+ viewer-setup*.exe durante la instalación)"
Write-Host "  Temp:     %Temp%\_MEI*        (extracción de PyInstaller)"
Line

# ============================ WINDOWS DEFENDER ============================== #
Write-Host ""
Write-Host "[1/2] Windows Defender" -ForegroundColor Yellow

if (Get-Command Get-MpComputerStatus -ErrorAction SilentlyContinue) {

    # ¿Protección contra manipulaciones activa? Bloquea Add-MpPreference.
    $tamper = (Get-MpComputerStatus).IsTamperProtected
    if ($tamper) {
        Write-Host "  ! La 'Protección contra manipulaciones' está ACTIVADA." -ForegroundColor Red
        Write-Host "    Windows no deja añadir exclusiones por comando mientras esté activa."
        Write-Host "    Desactívala un momento en:  Seguridad de Windows -> Protección"
        Write-Host "    antivirus y contra amenazas -> Administrar la configuración ->"
        Write-Host "    'Protección contra manipulaciones' = Desactivado."
        Write-Host "    Vuelve a ejecutar este script y luego puedes reactivarla."
    }

    if ($Remove) {
        Write-Host "  Quitando exclusiones..."
        foreach ($p in $Paths) { Remove-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue }
        foreach ($x in $Procs) { Remove-MpPreference -ExclusionProcess $x -ErrorAction SilentlyContinue }
        Write-Host "  Exclusiones de Defender eliminadas." -ForegroundColor Green
    }
    else {
        foreach ($p in $Paths) { Add-MpPreference -ExclusionPath $p -ErrorAction SilentlyContinue }
        foreach ($x in $Procs) { Add-MpPreference -ExclusionProcess $x -ErrorAction SilentlyContinue }

        # Verificación
        $now = Get-MpPreference
        $okPath = ($now.ExclusionPath  | Where-Object { $_ -like "*ViewerAgent*" }).Count -gt 0
        $okProc = ($now.ExclusionProcess | Where-Object { $_ -like "*viewer-agent*" }).Count -gt 0
        if ($okPath -and $okProc) {
            Write-Host "  OK · exclusiones aplicadas y verificadas." -ForegroundColor Green
            Write-Host "  Rutas excluidas ahora:"
            $now.ExclusionPath   | Where-Object { $_ -match 'ViewerAgent|_MEI' } | ForEach-Object { Write-Host "    $_" }
            $now.ExclusionProcess| Where-Object { $_ -match 'viewer' }           | ForEach-Object { Write-Host "    (proc) $_" }
        }
        else {
            Write-Host "  ! No se pudieron verificar las exclusiones." -ForegroundColor Red
            if ($tamper) { Write-Host "    Causa probable: Protección contra manipulaciones (arriba)." }
            else { Write-Host "    Aplícalas a mano (ver guía EXCLUSIONES.md)." }
        }
    }
}
else {
    Write-Host "  Windows Defender no está activo (otro antivirus lo ha sustituido)." -ForegroundColor DarkGray
}

if ($Remove) { Write-Host ""; Write-Host "Hecho." -ForegroundColor Green; return }

# ================================ KASPERSKY ================================ #
Write-Host ""
Write-Host "[2/2] Kaspersky" -ForegroundColor Yellow

$kaspReg = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
           Where-Object { $_.DisplayName -like '*Kaspersky*' } | Select-Object -First 1
$avpUi = Get-ChildItem 'C:\Program Files (x86)\Kaspersky Lab','C:\Program Files\Kaspersky Lab' `
            -Recurse -Filter 'avpui.exe' -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not ($kaspReg -or $avpUi)) {
    Write-Host "  Kaspersky no detectado en este equipo." -ForegroundColor DarkGray
}
else {
    if ($kaspReg) { Write-Host ("  Detectado: {0} {1}" -f $kaspReg.DisplayName, $kaspReg.DisplayVersion) }
    Write-Host ""
    Write-Host "  Kaspersky NO permite añadir exclusiones por línea de comandos." -ForegroundColor Yellow
    Write-Host "  Añade estos elementos a la ZONA DE CONFIANZA:"
    Write-Host ""
    Write-Host "    [Carpeta]  $InstallDir            (incluir subcarpetas)"
    Write-Host "    [Carpeta]  %Temp%\_MEI*            (incluir subcarpetas)"
    Write-Host "    [Proceso]  $Exe"
    Write-Host "    [Proceso]  viewer-setup*.exe"
    Write-Host ""
    Write-Host "  En cada uno marca:  'No analizar el tráfico de red' y"
    Write-Host "                      'No supervisar la actividad de la aplicación'."
    Write-Host ""

    # Deja la lista en un .txt para copiar
    $txt = Join-Path ([Environment]::GetFolderPath('Desktop')) 'viewer-agent-exclusiones-kaspersky.txt'
    @(
        'Zona de confianza de Kaspersky - viewer Agent'
        '============================================='
        ''
        "Carpeta : $InstallDir   (incluir subcarpetas)"
        'Carpeta : %Temp%\_MEI*   (incluir subcarpetas)'
        "Proceso : $Exe"
        'Proceso : viewer-setup*.exe'
        ''
        "En cada elemento: 'No analizar trafico de red' + 'No supervisar actividad de la aplicacion'."
        ''
        'GESTIONADO POR KASPERSKY SECURITY CENTER (empresa):'
        '  KSC -> Directivas -> [directiva de KES del grupo] -> Configuracion general ->'
        '  Exclusiones y aplicaciones de confianza -> Zona de confianza -> Anadir los'
        '  elementos de arriba. Aplica la directiva y sincroniza los equipos.'
        '  (Las exclusiones locales se pierden si la directiva no permite ajustes locales.)'
        ''
        'EQUIPO SUELTO (Kaspersky local):'
        '  Kaspersky -> Configuracion (rueda dentada) -> Seguridad -> Exclusiones y'
        '  acciones con objetos detectados -> Administrar exclusiones -> Anadir.'
        '  Y en Configuracion -> Seguridad -> Especificar aplicaciones de confianza -> Anadir.'
    ) | Set-Content -Encoding UTF8 $txt
    Write-Host "  Lista guardada para copiar:  $txt" -ForegroundColor Green

    if ($avpUi) {
        Write-Host "  Abriendo la ventana de Kaspersky..."
        Start-Process $avpUi.FullName
    }
}

Line
Write-Host ""
Write-Host "Recuerda:" -ForegroundColor Cyan
Write-Host " · En dominio, lo ideal es empujar las exclusiones por directiva (GPO para"
Write-Host "   Defender, KSC para Kaspersky) en vez de equipo por equipo."
Write-Host " · La solucion definitiva a los falsos positivos es FIRMAR el .exe con un"
Write-Host "   certificado de firma de codigo (Authenticode). Sin firma, algun motor"
Write-Host "   heuristico puede marcarlo aun con exclusiones."
Write-Host ""
