"""Cliente HTTP contra el servidor Vigía."""
from __future__ import annotations

import io
from typing import Any

import requests

from . import AGENT_VERSION


class ApiError(Exception):
    pass


class Api:
    def __init__(self, base_url: str, verify_tls: bool = True, timeout: int = 20):
        self.base_url = base_url.rstrip("/")
        self.verify = verify_tls
        self.timeout = timeout
        self.device_id = ""
        self.device_secret = ""
        self._s = requests.Session()
        self._s.headers.update({"User-Agent": f"vigia-agent/{AGENT_VERSION}"})

    def set_credentials(self, device_id: str, device_secret: str) -> None:
        self.device_id = device_id
        self.device_secret = device_secret

    def _headers(self) -> dict:
        return {"X-Device-Id": self.device_id, "X-Device-Secret": self.device_secret}

    # -- alta / consentimiento --

    def enroll(self, payload: dict) -> dict:
        r = self._s.post(
            f"{self.base_url}/agent/enroll", json=payload, verify=self.verify, timeout=self.timeout
        )
        if r.status_code == 403:
            raise ApiError("El token de alta no es válido o ya se usó.")
        r.raise_for_status()
        return r.json()

    def send_consent(self, accepted_at: str, username: str) -> None:
        r = self._s.post(
            f"{self.base_url}/agent/consent",
            json={"acceptedAt": accepted_at, "username": username},
            headers=self._headers(),
            verify=self.verify,
            timeout=self.timeout,
        )
        r.raise_for_status()

    def get_config(self) -> dict:
        r = self._s.get(
            f"{self.base_url}/agent/config",
            headers=self._headers(),
            verify=self.verify,
            timeout=self.timeout,
        )
        r.raise_for_status()
        return r.json().get("config", {})

    # -- datos por lotes --

    def post_activity(self, samples: list[dict]) -> None:
        self._post_json("/agent/activity", {"samples": samples})

    def post_keyboard(self, events: list[dict]) -> None:
        self._post_json("/agent/keyboard", {"events": events})

    def post_screenshot(self, captured_at: str, monitor: int, jpeg: bytes) -> None:
        files = {"image": ("shot.jpg", io.BytesIO(jpeg), "image/jpeg")}
        data = {"capturedAt": captured_at, "monitor": str(monitor)}
        r = self._s.post(
            f"{self.base_url}/agent/screenshots",
            files=files,
            data=data,
            headers=self._headers(),
            verify=self.verify,
            timeout=max(self.timeout, 40),
        )
        r.raise_for_status()

    def _post_json(self, path: str, body: Any) -> None:
        r = self._s.post(
            f"{self.base_url}{path}",
            json=body,
            headers=self._headers(),
            verify=self.verify,
            timeout=self.timeout,
        )
        r.raise_for_status()
