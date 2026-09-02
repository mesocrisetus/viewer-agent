"""Captura de pantalla con mss + compresión JPEG con Pillow."""
from __future__ import annotations

import io

import mss
from PIL import Image


def count_monitors() -> int:
    """Nº de pantallas físicas. Barato y seguro (para el enrolamiento)."""
    try:
        with mss.mss() as s:
            return max(1, len(s.monitors) - 1)
    except Exception:
        return 1


class ScreenCapturer:
    def __init__(self) -> None:
        self._sct = mss.mss()

    def monitors(self) -> int:
        # índice 0 en mss es "todos"; los reales empiezan en 1
        return max(1, len(self._sct.monitors) - 1)

    def grab_jpeg(self, monitor: int, max_edge: int, quality: int) -> bytes:
        mons = self._sct.monitors
        idx = monitor + 1 if monitor + 1 < len(mons) else 1
        raw = self._sct.grab(mons[idx])
        img = Image.frombytes("RGB", raw.size, raw.rgb)
        w, h = img.size
        scale = min(1.0, max_edge / max(w, h)) if max_edge else 1.0
        if scale < 1.0:
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.BILINEAR)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=int(quality), optimize=False)
        return buf.getvalue()

    def close(self) -> None:
        try:
            self._sct.close()
        except Exception:
            pass
