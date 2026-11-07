"""OpenAI-совместимый chat.completions: OpenAI, Gemini (OpenAI-compat), Ollama, vLLM и т.п. через LLM_BASE_URL."""
from __future__ import annotations

import httpx

from .base import LLMClient, LLMError


class OpenAICompatClient(LLMClient):
    provider = "openai"

    def __init__(self, model: str, api_key: str = "", base_url: str = "", max_tokens: int = 16000, timeout: float = 300):
        super().__init__(model)
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.json_mode = True  # выключается сам, если сервер не поддерживает response_format

    def _post(self, body: dict) -> httpx.Response:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        try:
            return httpx.post(f"{self.base_url}/chat/completions", json=body, headers=headers, timeout=self.timeout)
        except httpx.HTTPError as e:
            raise LLMError(f"Модель недоступна ({self.base_url}): {type(e).__name__}") from None

    def complete(self, system: str, user: str) -> tuple[str, dict]:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "temperature": 0,
            "max_tokens": self.max_tokens,
        }
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        r = self._post(body)
        if r.status_code == 400 and self.json_mode and "response_format" in r.text:
            self.json_mode = False
            body.pop("response_format", None)
            r = self._post(body)
        if r.status_code in (401, 403):
            raise LLMError("Модель: неверный или недостаточный API-ключ")
        if r.status_code == 429:
            raise LLMError("Модель: превышен лимит запросов, повторите позже")
        if r.status_code >= 400:
            raise LLMError(f"Модель: HTTP {r.status_code}")
        data = r.json()
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise LLMError("Модель вернула ответ неожиданного формата") from None
        u = data.get("usage") or {}
        return text, {"input_tokens": u.get("prompt_tokens", 0) or 0, "output_tokens": u.get("completion_tokens", 0) or 0}
