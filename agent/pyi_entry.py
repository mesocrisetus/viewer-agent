"""Punto de entrada para PyInstaller.

Se ejecuta como script de nivel superior (``__main__``) e importa el paquete
``vigia_agent`` de forma ABSOLUTA, para que los import relativos internos del
paquete funcionen dentro del ejecutable congelado.

No usar para desarrollo: ahí se usa ``python -m vigia_agent``.
"""
import sys

from vigia_agent.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
