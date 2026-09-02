"""Escucha de teclado y ratón con pynput.

Por defecto solo cuenta actividad (pulsaciones, teclas especiales, clics y
movimiento). La captura de texto se activa únicamente si el servidor manda
``textCapture: true``; en ese caso se acumulan trozos de texto de teclas
imprimibles y se vacían periódicamente.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field

from pynput import keyboard, mouse

_SPECIAL = {
    "space", "enter", "tab", "backspace", "delete", "esc",
    "up", "down", "left", "right", "home", "end", "page_up", "page_down",
    "ctrl", "ctrl_l", "ctrl_r", "alt", "alt_l", "alt_r", "alt_gr",
    "shift", "shift_l", "shift_r", "cmd", "cmd_l", "cmd_r", "caps_lock",
    "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
}


@dataclass
class Window:
    keys: int = 0
    mouse_clicks: int = 0
    mouse_moves: int = 0
    special: set = field(default_factory=set)
    text_parts: list = field(default_factory=list)


class InputMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._w = Window()
        self._last_input = time.time()
        self._text_capture = False
        self._kb: keyboard.Listener | None = None
        self._ms: mouse.Listener | None = None
        self._move_accum = 0

    # ---- control ----
    def set_text_capture(self, enabled: bool) -> None:
        with self._lock:
            if not enabled:
                self._w.text_parts.clear()
            self._text_capture = enabled

    def start(self) -> None:
        self._kb = keyboard.Listener(on_press=self._on_key, on_release=None)
        self._ms = mouse.Listener(on_click=self._on_click, on_move=self._on_move, on_scroll=self._on_scroll)
        self._kb.start()
        self._ms.start()

    def stop(self) -> None:
        for lst in (self._kb, self._ms):
            try:
                if lst:
                    lst.stop()
            except Exception:
                pass

    # ---- callbacks ----
    def _touch(self) -> None:
        self._last_input = time.time()

    def _on_key(self, key) -> None:
        self._touch()
        with self._lock:
            self._w.keys += 1
            name = getattr(key, "name", None)
            ch = getattr(key, "char", None)
            if name and name.lower() in _SPECIAL:
                self._w.special.add(name.lower())
            if self._text_capture:
                if ch is not None:
                    self._w.text_parts.append(ch)
                elif name == "space":
                    self._w.text_parts.append(" ")
                elif name == "enter":
                    self._w.text_parts.append("\n")
                elif name == "backspace" and self._w.text_parts:
                    self._w.text_parts.pop()

    def _on_click(self, x, y, button, pressed) -> None:
        if pressed:
            self._touch()
            with self._lock:
                self._w.mouse_clicks += 1

    def _on_scroll(self, x, y, dx, dy) -> None:
        self._touch()

    def _on_move(self, x, y) -> None:
        # muestrea 1 de cada 8 movimientos para no inflar contadores
        self._move_accum += 1
        if self._move_accum % 8 == 0:
            self._touch()
            with self._lock:
                self._w.mouse_moves += 1

    # ---- lectura ----
    def idle_seconds(self) -> float:
        return time.time() - self._last_input

    def drain(self) -> dict:
        """Devuelve los contadores acumulados y reinicia la ventana."""
        with self._lock:
            w = self._w
            self._w = Window()
            text = "".join(w.text_parts).strip() if self._text_capture else ""
            return {
                "keys": w.keys,
                "mouse": w.mouse_clicks + w.mouse_moves,
                "mouse_clicks": w.mouse_clicks,
                "special": sorted(w.special),
                "text": text,
            }
