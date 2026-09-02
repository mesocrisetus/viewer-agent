"""Instalación y desinstalación del agente en Windows, sin dependencias externas.

Modelo: se copia el ejecutable a %ProgramData%\\ViewerAgent, se guarda el
config.json y se registra una TAREA PROGRAMADA que arranca el agente al iniciar
sesión cualquier usuario, con reinicio automático si falla. Corre en la sesión
del usuario (necesario para capturar la pantalla) y mantiene visible el icono de
bandeja.

No oculta nada: la tarea se llama "ViewerAgent", el proceso es "viewer-agent.exe"
y aparece en Programas y características.
"""
from __future__ import annotations

import ctypes
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

from .config import (
    APP_ID,
    PRODUCT_NAME,
    LocalConfig,
    config_from_exe_name,
    exe_path,
    find_local_config,
    install_dir,
    is_frozen,
)

APP_NAME = PRODUCT_NAME  # texto visible
TASK_NAME = APP_ID
INSTALLED_EXE = "viewer-agent.exe"
UNINSTALL_KEY = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\ViewerAgent"


def _msg(text: str, title: str = PRODUCT_NAME, error: bool = False) -> None:
    """Aviso al usuario. En build --windowed no hay consola, así que MessageBox."""
    print(text)
    try:
        MB_OK = 0x0
        icon = 0x10 if error else 0x40  # ICONERROR / ICONINFORMATION
        ctypes.windll.user32.MessageBoxW(None, text, title, MB_OK | icon | 0x40000)
    except Exception:
        pass


def _is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _relaunch_as_admin(extra_args: list[str]) -> int:
    """Vuelve a lanzar este mismo ejecutable pidiendo elevación (UAC)."""
    params = " ".join(f'"{a}"' for a in extra_args)
    rc = ctypes.windll.shell32.ShellExecuteW(
        None, "runas", sys.executable, params, None, 1
    )
    if rc > 32:
        return 0
    _msg(
        "Se necesita permiso de administrador para instalar el agente.\n"
        "Vuelve a abrir el instalador y acepta el aviso de Windows.",
        error=True,
    )
    return 1


def _task_xml(exe: Path, workdir: Path) -> str:
    # Tarea: al iniciar sesión (cualquier usuario), reinicio cada 1 min hasta 999
    # veces, sin límite de duración, se ejecuta aunque esté a batería.
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.3" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Agente de supervision {APP_NAME} (monitorizacion declarada)</Description>
    <URI>\\{TASK_NAME}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled></LogonTrigger>
    <BootTrigger><Enabled>true</Enabled></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <GroupId>S-1-5-32-545</GroupId>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{exe}</Command>
      <WorkingDirectory>{workdir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def _write_uninstall_entry(target_dir: Path) -> None:
    try:
        import winreg

        with winreg.CreateKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL_KEY) as k:
            winreg.SetValueEx(k, "DisplayName", 0, winreg.REG_SZ, f"{APP_NAME} Agent")
            winreg.SetValueEx(k, "Publisher", 0, winreg.REG_SZ, APP_NAME)
            winreg.SetValueEx(k, "DisplayVersion", 0, winreg.REG_SZ, _version())
            winreg.SetValueEx(k, "InstallLocation", 0, winreg.REG_SZ, str(target_dir))
            winreg.SetValueEx(
                k, "UninstallString", 0, winreg.REG_SZ,
                f'"{target_dir / INSTALLED_EXE}" --uninstall',
            )
            winreg.SetValueEx(k, "NoModify", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(k, "NoRepair", 0, winreg.REG_DWORD, 1)
    except Exception as e:  # no es crítico
        print(f"  (aviso: no se pudo escribir la entrada de desinstalación: {e})")


def _version() -> str:
    try:
        from . import AGENT_VERSION

        return AGENT_VERSION
    except Exception:
        return "0.0.0"


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True)


def _add_defender_exclusions(target: Path, exe: Path) -> None:
    """Añade exclusiones en Windows Defender para que no borre el agente ni el
    ejecutable temporal que PyInstaller extrae en %TEMP%. Requiere elevación
    (ya la tenemos aquí). Silencioso si Defender no está o falla."""
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"Add-MpPreference -ExclusionPath '{target}';"
        f"Add-MpPreference -ExclusionProcess '{exe}';"
        f"Add-MpPreference -ExclusionProcess '{INSTALLED_EXE}';"
        "Add-MpPreference -ExclusionProcess 'viewer-setup*.exe';"
        # PyInstaller onefile se auto-extrae aquí:
        "Add-MpPreference -ExclusionPath ($env:TEMP + '\\_MEI*');"
        "Add-MpPreference -ExclusionPath ($env:LOCALAPPDATA + '\\Temp\\_MEI*');"
    )
    try:
        _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps])
        print("  Exclusiones de Windows Defender añadidas.")
    except Exception as e:
        print(f"  (aviso: no se pudieron añadir exclusiones de Defender: {e})")


def _remove_defender_exclusions(target: Path, exe: Path) -> None:
    ps = (
        "$ErrorActionPreference='SilentlyContinue';"
        f"Remove-MpPreference -ExclusionPath '{target}';"
        f"Remove-MpPreference -ExclusionProcess '{exe}';"
        f"Remove-MpPreference -ExclusionProcess '{INSTALLED_EXE}';"
        "Remove-MpPreference -ExclusionProcess 'viewer-setup*.exe';"
        "Remove-MpPreference -ExclusionPath ($env:TEMP + '\\_MEI*');"
        "Remove-MpPreference -ExclusionPath ($env:LOCALAPPDATA + '\\Temp\\_MEI*');"
    )
    try:
        _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps])
    except Exception:
        pass


def _check_token(cfg) -> str | None:
    """Consulta /agent/token-status con stdlib. Devuelve el motivo de rechazo
    ('ya_usado' | 'caducado' | 'no_existe') o None si el token es válido O si el
    servidor no responde (en ese caso no bloqueamos la instalación)."""
    import json
    import ssl
    import urllib.parse
    import urllib.request

    url = (
        cfg.base_url
        + "/agent/token-status?token="
        + urllib.parse.quote(cfg.enroll_token, safe="")
    )
    ctx = None
    if url.startswith("https") and not cfg.verify_tls:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(url, timeout=15, context=ctx) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data.get("ok"):
            return None
        return str(data.get("reason") or "no_existe")
    except Exception as e:
        print(f"No se pudo verificar el token con el servidor: {e}")
        return None


def install(config_path: str | None = None) -> int:
    if not sys.platform.startswith("win"):
        print("Este instalador es solo para Windows.")
        return 2
    if not is_frozen():
        print("Ejecuta el instalador desde el .exe descargado, no con Python.")
        return 2

    if not _is_admin():
        print("Solicitando permisos de administrador...")
        args = ["--install"]
        if config_path:
            args += ["--config", config_path]
        return _relaunch_as_admin(args)

    # 1. Resolver configuración (fichero suelto o embebida en el nombre del .exe)
    cfg: LocalConfig | None
    cfg, origin = find_local_config(config_path)
    if not cfg:
        cfg = config_from_exe_name()
        origin = "nombre del ejecutable"
    if not cfg:
        _msg(
            "No se encontró la configuración.\n\nDescarga el instalador desde el "
            "panel (trae la URL y el token dentro del propio fichero) y no lo "
            "renombres antes de ejecutarlo.",
            error=True,
        )
        return 3
    print(f"Configuración: servidor {cfg.server_url}  (origen: {origin})")

    # 1b. Comprobar el token contra el servidor ANTES de instalar (stdlib).
    reason = _check_token(cfg)
    if reason == "ya_usado" or reason == "caducado":
        _msg(
            "Este instalador ha caducado (su código de alta ya se usó o expiró).\n\n"
            "Entra en el panel → «Descargar cliente» → «Descargar instalador "
            "(.exe)» y usa el fichero nuevo. Borra los instaladores antiguos de "
            "la carpeta de Descargas para no confundirlos.",
            error=True,
        )
        return 6
    if reason == "no_existe":
        _msg(
            "El código de alta de este instalador no existe en el servidor.\n\n"
            "Descarga un instalador nuevo desde el panel (Descargar cliente).",
            error=True,
        )
        return 6
    # reason None = servidor no accesible ahora: se continúa; el agente
    # reintentará el alta cuando haya conexión.

    # 2. Carpeta de instalación
    target = install_dir()
    target.mkdir(parents=True, exist_ok=True)
    dst_exe = target / INSTALLED_EXE

    # 3. Copiar el ejecutable (si no es ya el instalado)
    src = exe_path()
    if src != dst_exe:
        for attempt in range(5):
            try:
                shutil.copy2(src, dst_exe)
                break
            except PermissionError:
                time.sleep(1)
        else:
            _msg(f"No se pudo copiar el agente a {dst_exe} (¿en uso?).", error=True)
            return 4

    # 4. Guardar config.json y partir de cero: una (re)instalación es un alta
    #    nueva. Si quedara un state.json de una instalación anterior, el agente
    #    intentaría usar credenciales de un equipo que quizá ya no existe.
    (target / "config.json").write_text(cfg.to_json(), encoding="utf-8")
    for stale in ("state.json", "buffer.sqlite3", "viewer-agent.log",
                  "vigia-agent.log", "agent.lock"):
        try:
            (target / stale).unlink()
        except (FileNotFoundError, PermissionError):
            pass

    # 5. Registrar la tarea programada
    xml = _task_xml(dst_exe, target)
    xml_file = target / "_task.xml"
    xml_file.write_text(xml, encoding="utf-16")
    _run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    r = _run(["schtasks", "/Create", "/TN", TASK_NAME, "/XML", str(xml_file), "/F"])
    try:
        xml_file.unlink()
    except Exception:
        pass
    if r.returncode != 0:
        _msg("Error al registrar la tarea programada:\n" + (r.stdout or "") + (r.stderr or ""), error=True)
        return 5

    _write_uninstall_entry(target)

    # 5b. Exclusiones de antivirus (Defender scriptable aquí; Kaspersky no -> ver
    #     install/av-exclusions.ps1).
    _add_defender_exclusions(target, dst_exe)

    # 6. Arrancar ya. SOLO vía la tarea programada (LeastPrivilege -> corre en la
    #    sesión del usuario, de-elevado). Nada de segundos lanzamientos: el token
    #    de alta es de un solo uso y dos instancias compitiendo por él fallan.
    _run(["schtasks", "/Run", "/TN", TASK_NAME])

    _msg(
        f"{APP_NAME} se ha instalado y está en ejecución.\n\n"
        f"Servidor: {cfg.server_url}\n"
        f"Programa: {dst_exe}\n"
        f"Arranca solo al iniciar sesión.\n\n"
        "En unos segundos aparecerá el aviso de supervisión y el icono en la "
        "bandeja del sistema."
    )
    return 0


def uninstall() -> int:
    if not sys.platform.startswith("win"):
        return 2
    if not _is_admin():
        return _relaunch_as_admin(["--uninstall"])

    _run(["schtasks", "/End", "/TN", TASK_NAME])
    _run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"])
    # matar procesos en marcha
    _run(["taskkill", "/F", "/IM", INSTALLED_EXE])

    try:
        import winreg

        winreg.DeleteKey(winreg.HKEY_LOCAL_MACHINE, UNINSTALL_KEY)
    except Exception:
        pass

    target = install_dir()
    _remove_defender_exclusions(target, target / INSTALLED_EXE)
    # No se puede borrar el .exe en uso desde sí mismo: borrado diferido con un
    # .bat en %TEMP% (fuera de la carpeta a borrar). 'ping' como espera fiable
    # sin consola ('timeout' falla si no hay stdin de consola).
    ok = False
    try:
        import tempfile

        bat = Path(tempfile.gettempdir()) / "vieweragent_cleanup.bat"
        bat.write_text(
            "@echo off\r\n"
            "ping -n 4 127.0.0.1 >nul\r\n"
            f'rmdir /s /q "{target}"\r\n'
            'del "%~f0"\r\n',
            encoding="ascii",
        )
        subprocess.Popen(
            ["cmd", "/c", str(bat)],
            creationflags=0x00000008 | 0x08000000,  # DETACHED | NO_WINDOW
            close_fds=True,
        )
        ok = True
    except Exception:
        pass

    _msg(
        f"{APP_NAME} se ha desinstalado (tarea programada y proceso eliminados)."
        + (f"\nLa carpeta {target} se borrará en unos segundos."
           if ok else f"\nPuedes borrar manualmente la carpeta {target}.")
    )
    return 0
