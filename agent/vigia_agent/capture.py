"""Captura de pantalla con mss + compresión JPEG con Pillow.

mss cachea la lista de monitores al construirse; si el usuario enchufa o
desenchufa una pantalla en caliente, `sct.monitors` se queda obsoleto. Por eso
recreamos la instancia de mss cada pocos segundos.
"""
from __future__ import annotations

import io
import time

import mss
from PIL import Image

_REFRESH_TTL = 4.0  # segundos: cada cuánto se vuelve a enumerar monitores


def count_monitors() -> int:
    """Nº de pantallas físicas AHORA MISMO (instancia mss nueva -> sin caché)."""
    try:
        with mss.mss() as s:
            return max(1, len(s.monitors) - 1)
    except Exception:
        return 1


class ScreenCapturer:
    def __init__(self) -> None:
        self._sct = mss.mss()
        self._born = time.monotonic()

    def _fresh(self) -> None:
        if time.monotonic() - self._born < _REFRESH_TTL:
            return
        try:
            self._sct.close()
        except Exception:
            pass
        self._sct = mss.mss()
        self._born = time.monotonic()

    def monitors(self) -> int:
        self._fresh()
        return max(1, len(self._sct.monitors) - 1)

    def grab_jpeg(self, monitor: int, max_edge: int, quality: int) -> bytes:
        self._fresh()
        for attempt in range(2):
            try:
                mons = self._sct.monitors
                # Si la pantalla pedida ya no existe, no la captures (evita
                # devolver la principal duplicada).
                if monitor + 1 >= len(mons):
                    raise IndexError(f"monitor {monitor} ya no existe")
                raw = self._sct.grab(mons[monitor + 1])
                img = Image.frombytes("RGB", raw.size, raw.rgb)
                w, h = img.size
                scale = min(1.0, max_edge / max(w, h)) if max_edge else 1.0
                if scale < 1.0:
                    img = img.resize(
                        (max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR
                    )
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=int(quality), optimize=False)
                return buf.getvalue()
            except IndexError:
                raise
            except Exception:
                if attempt == 0:
                    try:
                        self._sct.close()
                    except Exception:
                        pass
                    self._sct = mss.mss()
                    self._born = time.monotonic()
                    continue
                raise
        raise RuntimeError("captura fallida")

    def close(self) -> None:
        try:
            self._sct.close()
        except Exception:
            pass
