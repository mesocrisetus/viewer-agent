"""Cola local persistente (SQLite) para tolerar cortes de red."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


class Buffer:
    """Cola FIFO simple de 'items' pendientes de enviar al servidor.

    Cada item: kind ('activity' | 'keyboard' | 'screenshot') + payload.
    Para 'screenshot' el payload guarda la ruta del fichero temporal.
    """

    def __init__(self, path: Path, max_items: int = 20000):
        self._path = path
        self._max = max_items
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS queue (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   kind TEXT NOT NULL,
                   payload TEXT NOT NULL,
                   created REAL NOT NULL
               )"""
        )
        self._db.commit()

    def put(self, kind: str, payload: dict) -> None:
        with self._lock:
            self._db.execute(
                "INSERT INTO queue (kind, payload, created) VALUES (?, ?, ?)",
                (kind, json.dumps(payload), time.time()),
            )
            # recorta si crece demasiado (descarta lo más antiguo)
            self._db.execute(
                "DELETE FROM queue WHERE id IN ("
                "  SELECT id FROM queue ORDER BY id ASC "
                "  LIMIT MAX(0, (SELECT COUNT(*) FROM queue) - ?))",
                (self._max,),
            )
            self._db.commit()

    def peek_batch(self, kind: str, limit: int) -> list[tuple[int, dict]]:
        with self._lock:
            rows = self._db.execute(
                "SELECT id, payload FROM queue WHERE kind = ? ORDER BY id ASC LIMIT ?",
                (kind, limit),
            ).fetchall()
        return [(r[0], json.loads(r[1])) for r in rows]

    def delete(self, ids: list[int]) -> None:
        if not ids:
            return
        with self._lock:
            self._db.executemany("DELETE FROM queue WHERE id = ?", [(i,) for i in ids])
            self._db.commit()

    def count(self) -> int:
        with self._lock:
            return self._db.execute("SELECT COUNT(*) FROM queue").fetchone()[0]

    def kinds(self) -> list[str]:
        with self._lock:
            rows = self._db.execute("SELECT DISTINCT kind FROM queue").fetchall()
        return [r[0] for r in rows]
