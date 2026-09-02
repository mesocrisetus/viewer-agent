# Excluir viewer Agent del antivirus

Objetivo: que **Windows Defender** y **Kaspersky** no borren, pongan en
cuarentena ni bloqueen el agente.

## Qué hay que excluir (siempre lo mismo)

| Tipo | Elemento |
|------|----------|
| Carpeta | `C:\ProgramData\ViewerAgent` (con subcarpetas) |
| Carpeta | `%Temp%\_MEI*` (con subcarpetas) — el agente se autoextrae ahí al arrancar |
| Proceso | `C:\ProgramData\ViewerAgent\viewer-agent.exe` |
| Proceso | `viewer-setup*.exe` — solo mientras se instala |

---

## Opción rápida: script automático

En el equipo, **PowerShell como administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ruta\a\av-exclusions.ps1"
```

- **Windows Defender**: lo hace todo solo (y verifica que quedó aplicado).
- **Kaspersky**: no se puede por comando. El script deja la lista en un `.txt`
  en el Escritorio y abre la ventana de Kaspersky para que la pegues.

> El **instalador del agente ya añade las exclusiones de Defender** al instalar.
> El script sirve para revisarlas, re-aplicarlas o hacerlo en equipos gestionados.

Para quitarlas: `... -File av-exclusions.ps1 -Remove`.

---

## Windows Defender — paso a paso (manual)

1. **Seguridad de Windows** (busca "Seguridad de Windows" en el menú Inicio).
2. **Protección antivirus y contra amenazas**.
3. En **Configuración de antivirus y protección contra amenazas** →
   **Administrar la configuración**.
4. Si **"Protección contra manipulaciones"** está activada, **desactívala**
   temporalmente (si no, no deja añadir exclusiones). La reactivas al final.
5. Baja hasta **Exclusiones** → **Agregar o quitar exclusiones** → *Sí* en el
   aviso de control de cuentas.
6. **Agregar una exclusión** → **Carpeta** → elige `C:\ProgramData\ViewerAgent`.
   - Si no ves `ProgramData`: en la barra de ruta del diálogo escribe
     `C:\ProgramData` y pulsa Enter; es una carpeta oculta.
7. **Agregar una exclusión** → **Carpeta** otra vez → escribe en la barra de
   ruta `%Temp%` , entra, y **crea/elige** una carpeta… — como `_MEI*` cambia
   cada vez, lo más simple aquí es **Archivo/Proceso**: pulsa **Agregar una
   exclusión → Proceso** y escribe:
   - `viewer-agent.exe`
   - (opcional durante despliegue) `viewer-setup*.exe`
8. **Agregar una exclusión** → **Archivo** →
   `C:\ProgramData\ViewerAgent\viewer-agent.exe`.
9. Vuelve a **activar "Protección contra manipulaciones"**.

### Defender por GPO (varios equipos de dominio)

`Configuración del equipo → Directivas → Plantillas administrativas →
Componentes de Windows → Antivirus de Microsoft Defender → Exclusiones`:

- **Exclusiones de ruta de acceso**: `C:\ProgramData\ViewerAgent` = `0`,
  `%TEMP%\_MEI*` = `0`.
- **Exclusiones de procesos**: `viewer-agent.exe` = `0`.

---

## Kaspersky — paso a paso (manual)

Kaspersky **no** tiene comando para añadir exclusiones; hay que hacerlo en su
interfaz o por directiva de Kaspersky Security Center.

### A) Equipo suelto (Kaspersky instalado localmente)

1. Abre **Kaspersky** → icono de **engranaje** (Configuración), abajo a la izq.
2. **Seguridad** → **Exclusiones y acciones con objetos detectados**
   *(en algunas versiones: "Amenazas y exclusiones")*.
3. **Administrar exclusiones** → **Añadir**:
   - **Archivo o carpeta** → `C:\ProgramData\ViewerAgent` → marca
     **"Incluir subcarpetas"**.
   - Componentes de protección: **todos**. Estado: **Activo**. **Guardar**.
4. **Añadir** otra vez → `%Temp%\_MEI*` (marca "Incluir subcarpetas"). Guardar.
5. Vuelve a **Configuración → Seguridad** → **Especificar aplicaciones de
   confianza** *(o "Aplicaciones de confianza")* → **Añadir** →
   `C:\ProgramData\ViewerAgent\viewer-agent.exe`. Marca:
   - **No analizar archivos abiertos**
   - **No supervisar la actividad de la aplicación**
   - **No analizar el tráfico de red**
   - **No bloquear la interacción con la interfaz** *(si aparece)*
   **Guardar**.
6. Repite el paso 5 con `viewer-setup*.exe` si vas a instalar en más equipos.
7. **Aceptar / Guardar** y cierra Kaspersky.

### B) Empresa con Kaspersky Security Center (KES gestionado) — RECOMENDADO

Si Kaspersky se gestiona desde una consola central, **las exclusiones locales
se sobrescriben con la directiva**. Hazlo en la directiva:

1. **Consola de KSC** → **Dispositivos administrados** → selecciona el grupo →
   pestaña **Directivas**.
2. Abre la **directiva de Kaspersky Endpoint Security** del grupo.
3. **Configuración general** → **Exclusiones y tipos de objetos detectados**
   *(o "Exclusiones de análisis y aplicaciones de confianza")*.
4. **Exclusiones de análisis** → **Configuración** → **Añadir**:
   - `C:\ProgramData\ViewerAgent\*` (todos los componentes, activo)
   - `%Temp%\_MEI*`
5. **Aplicaciones de confianza** → **Añadir** →
   `C:\ProgramData\ViewerAgent\viewer-agent.exe` con:
   - No analizar archivos abiertos
   - No supervisar la actividad de la aplicación
   - No analizar el tráfico de red
   - No analizar todo el tráfico
6. (Opcional) añade también `viewer-setup*.exe`.
7. Comprueba que el **candado** de esos ajustes está **cerrado** (forzado por la
   directiva) si no quieres que los equipos lo cambien.
8. **Guardar** la directiva → **Forzar sincronización** de los equipos
   (o esperar al siguiente ciclo).

### C) Kaspersky Endpoint Security por línea de comandos (limitado)

`avp.com` permite `START`, `STOP`, `SCAN`, `UPDATE`, `IMPORT <archivo.cfg>`…
pero **no añadir exclusiones sueltas**. La única vía "por script" real es
exportar la configuración desde un equipo ya configurado
(`avp.com EXPORT all C:\kes.cfg`) e **importarla** en los demás
(`avp.com IMPORT C:\kes.cfg`), o usar la directiva de KSC (opción B).

---

## Nota importante

Sin **firma de código** (certificado Authenticode de pago), algunos motores
heurísticos pueden volver a marcar el `.exe` aunque haya exclusiones,
especialmente tras una actualización de firmas. Si os pasa de forma recurrente,
la solución estable es firmar `viewer-agent-windows.exe` en cada compilación.
