"""Разбор меток времени транскрипта ТОЛЬКО для вычислений. Хранятся и отдаются метки как пришли.

Чаты: "MM:SS" (или "HH:MM:SS") от начала. Звонки: ISO 8601, бывает 7 знаков долей секунды
("2026-11-03T15:49:13.1900670+00:00") — Python понимает максимум 6, лишние обрезаем.
"""
from __future__ import annotations

import re
from datetime import datetime

_CLOCK = re.compile(r"^\d{1,2}(:\d{1,2}){1,2}$")


def parse_seconds(ts) -> float | None:
    """Секунды (относительные для чатов, epoch для ISO). None — не удалось разобрать."""
    s = str(ts or "").strip()
    if not s:
        return None
    if _CLOCK.match(s):
        total = 0
        for p in s.split(":"):
            total = total * 60 + int(p)
        return float(total)
    iso = re.sub(r"(\.\d{6})\d+", r"\1", s).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(iso).timestamp()
    except ValueError:
        return None


def first_operator_reaction(transcript: list[dict]) -> tuple[float | None, int | None, int | None]:
    """(секунды, индекс точки отсчёта, индекс первой реплики оператора).

    Отсчёт — от последней реплики system перед первым ответом оператора (эскалация/подключение),
    иначе от последней реплики клиента перед ним."""
    op = next((i for i, r in enumerate(transcript) if r.get("speaker") == "operator"), None)
    if op is None:
        return None, None, None
    before = transcript[:op]
    start = next((i for i in range(len(before) - 1, -1, -1) if before[i].get("speaker") == "system"), None)
    if start is None:
        start = next((i for i in range(len(before) - 1, -1, -1) if before[i].get("speaker") == "client"), None)
    if start is None:
        return None, None, op
    a, b = parse_seconds(transcript[start].get("timestamp")), parse_seconds(transcript[op].get("timestamp"))
    if a is None or b is None:
        return None, start, op
    return max(0.0, b - a), start, op
