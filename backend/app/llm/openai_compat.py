"""OpenAI-совместимый chat.completions: OpenAI, Gemini (OpenAI-compat), Ollama, vLLM и т.п. через LLM_BASE_URL."""
from __future__ import annotations

import httpx

from .base import LLMClient, LLMError, LLMParseError
from .schema import EVALUATION_SCHEMA


class OpenAICompatClient(LLMClient):
    provider = "openai"

    def __init__(self, model: str, api_key: str = "", base_url: str = "", max_tokens: int = 16000, timeout: float = 300):
        super().__init__(model)
        self.base_url = (base_url or "https://api.openai.com/v1").rstrip("/")
        self.api_key = api_key
        self.max_tokens = max_tokens
        self.timeout = timeout

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
            "max_completion_tokens": self.max_tokens,
            "response_format": {"type": "json_schema", "json_schema": {
                "name": "conversation_evaluation", "strict": True, "schema": EVALUATION_SCHEMA,
            }},
        }
        r = self._post(body)
        if r.status_code in (401, 403):
            raise LLMError("Модель: неверный или недостаточный API-ключ")
        if r.status_code == 429:
            raise LLMError("Модель: превышен лимит запросов, повторите позже")
        if r.status_code >= 400:
            raise LLMError(f"Модель: HTTP {r.status_code}")
        try:
            data = r.json()
            choice = data["choices"][0]
            message = choice["message"]
            u = data.get("usage") or {}
            usage = {"input_tokens": u.get("prompt_tokens", 0) or 0,
                     "output_tokens": u.get("completion_tokens", 0) or 0,
                     "request_id": r.headers.get("x-request-id"), "served_by": data.get("model")}
            if message.get("refusal"):
                raise LLMParseError("Модель отказалась оценивать диалог", "", usage)
            text = message.get("content") or ""
            if choice.get("finish_reason") != "stop":
                raise LLMParseError("Модель не завершила JSON-ответ", text, usage)
            if not isinstance(text, str):
                raise TypeError
        except (ValueError, KeyError, IndexError, TypeError):
            raise LLMError("Модель вернула ответ неожиданного формата") from None
        return text, usage
