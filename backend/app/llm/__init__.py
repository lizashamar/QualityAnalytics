"""Фабрика клиента модели по настройкам (LLM_PROVIDER)."""
from __future__ import annotations

from ..config import Settings
from .base import LLMClient, LLMError, LLMParseError


def make_client(s: Settings) -> LLMClient:
    p = s.llm_provider
    if p == "mock":
        from .mock import MockClient
        return MockClient(s.llm_model or "mock-heuristic-v1")
    if p in ("openai", "openai-compat", "gemini", "ollama"):
        from .openai_compat import OpenAICompatClient
        return OpenAICompatClient(s.llm_model, s.llm_api_key, s.llm_base_url, max_tokens=s.llm_max_tokens)
    raise LLMError(f"Неизвестный LLM_PROVIDER: {p} (ожидается mock | openai)")


__all__ = ["make_client", "LLMClient", "LLMError", "LLMParseError"]
