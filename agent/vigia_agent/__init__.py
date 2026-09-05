"""Agente de monitorización declarada (viewer Agent)."""

# 0.2.0: multi-monitor (reporta y emite todas las pantallas), tema del panel,
#        autocorrección del nº de pantallas, exclusiones de Defender al instalar.
# 0.2.1: refresca la lista de monitores de mss (arregla "2 pantallas / 1 imagen
#        duplicada" al desenchufar un monitor en caliente).
# 0.2.2: desfase inicial aleatorio del bucle de capturas -> muchos agentes
#        desplegados a la vez ya no suben todos en el mismo segundo (evita la
#        ráfaga que saturaba y tumbaba el servidor por falta de memoria).
__version__ = "0.2.2"
AGENT_VERSION = __version__
