"""Интерфейс клиента модели: complete_json(system, user) -> (dict, usage)."""
from __future__ import annotations

import json
import re
import time
from abc import ABC, abstractmethod


class LLMError(Exception):
    """Ошибка вызова модели (сеть, ключ, отказ). Текст безопасен для показа пользователю."""


class LLMParseError(LLMError):
    """Модель ответила не-JSON. Содержит сырой текст и usage, чтобы учесть токены и сделать повтор."""

    def __init__(self, message: str, raw: str, usage: dict):
        super().__init__(message)
        self.raw = raw
        self.usage = usage


_FENCE = re.compile(r"^\s*```(?:json|JSON)?\s*\n?(.*?)\n?\s*```\s*$", re.S)


def extract_json(text: str):
    """Парсит JSON, срезая ```-ограды и текст вокруг объекта."""
    t = (text or "").strip()
    m = _FENCE.match(t)
    if m:
        t = m.group(1).strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        a, b = t.find("{"), t.rfind("}")
        if a != -1 and b > a:
            return json.loads(t[a:b + 1])
        raise


class LLMClient(ABC):
    provider: str = "base"

    def __init__(self, model: str):
        self.model = model

    @abstractmethod
    def complete(self, system: str, user: str) -> tuple[str, dict]:
        """Один вызов. Возвращает (текст, usage{input_tokens, output_tokens})."""

    def complete_json(self, system: str, user: str) -> tuple[dict, dict]:
        t0 = time.perf_counter()
        text, usage = self.complete(system, user)
        usage = {**usage, "duration_ms": round((time.perf_counter() - t0) * 1000)}
        try:
            data = extract_json(text)
        except (json.JSONDecodeError, ValueError) as e:
            raise LLMParseError(f"Ответ модели не является JSON: {e}", text, usage) from None
        if not isinstance(data, dict):
            raise LLMParseError("Ответ модели не является JSON-объектом", text, usage)
        return data, usage
