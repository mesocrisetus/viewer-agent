# Cumplimiento y despliegue responsable

Vigía monitoriza a personas. En casi todas las jurisdicciones eso es legal
**solo si se cumplen ciertas condiciones**. Este documento resume las que el
software da por supuestas. No es asesoramiento jurídico: consulta con tu
asesoría laboral y con tu responsable de protección de datos antes de desplegar.

## Principios que asume el software

1. **Transparencia.** El agente muestra un icono permanente en la bandeja del
   sistema y, en el primer arranque, una pantalla de aviso que la persona debe
   aceptar. La fecha de aceptación se guarda en el servidor
   (`Device.consentAcceptedAt`). No modifiques el agente para ocultar el icono
   ni para saltarte esa pantalla.

2. **Información previa y por escrito.** Antes de instalar nada, la empresa debe
   entregar a la plantilla una política de monitorización que explique: qué se
   registra (pantalla, aplicación activa, actividad de teclado/ratón), con qué
   finalidad, cuánto tiempo se conserva, quién puede consultarlo y cómo ejercer
   los derechos de acceso y supresión. Edita `panel` → Ajustes → "Texto de
   consentimiento" para que coincida con esa política.

3. **Proporcionalidad.** Activa solo lo necesario para la finalidad declarada:
   - La **captura de texto completo del teclado** está **desactivada por
     defecto**. Actívala únicamente con una base legal específica (p. ej.
     investigación de una fuga de datos concreta) y durante el tiempo mínimo. Con
     ella desactivada, del teclado solo se guardan métricas de actividad
     (pulsaciones por minuto, teclas especiales), no el contenido.
   - Ajusta el intervalo de captura de pantalla al mínimo que sirva.
   - Considera excluir equipos o franjas horarias (pausas, teletrabajo fuera de
     jornada).

4. **Minimización y retención.** La retención por defecto es de 30 días. Un
   trabajo automático borra capturas y muestras más antiguas. No la subas sin
   una razón documentada.

5. **Seguridad del acceso.** El panel es la superficie más sensible del sistema.
   Limita las cuentas de administrador, usa contraseñas fuertes, sirve todo por
   HTTPS y restringe el acceso por VPN o lista de IP.

6. **Derechos de las personas.** El panel permite exportar y borrar los datos de
   un equipo/persona concretos para poder atender solicitudes de acceso o
   supresión.

## Lo que este software NO hace (a propósito)

- No se oculta del gestor de tareas ni de la lista de programas instalados.
- No intenta evadir antivirus ni EDR.
- No captura webcam ni micrófono.
- No lee el contenido de ficheros ni el portapapeles.
- No registra pulsaciones de teclado como texto salvo que se active
  explícitamente esa opción en Ajustes.

Si necesitas alguna de estas capacidades, este no es el proyecto adecuado y
además probablemente no sea legal en tu caso: revísalo con tu asesoría antes de
plantearlo.

## Checklist antes de desplegar

- [ ] Política de monitorización redactada y entregada a la plantilla.
- [ ] Base legal identificada (normalmente interés legítimo del empleador, con
      evaluación de impacto si aplica).
- [ ] Texto de consentimiento del panel alineado con la política.
- [ ] Retención configurada según la política.
- [ ] Captura de texto de teclado **desactivada** salvo justificación concreta.
- [ ] Panel accesible solo por HTTPS y red restringida.
- [ ] Registro de administradores con acceso y revisión periódica.
