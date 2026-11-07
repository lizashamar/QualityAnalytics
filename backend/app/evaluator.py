"""Оценка диалога одним вызовом модели (все критерии сразу) + валидация + один повтор.

Критерии берутся из переданного снимка чек-листа (из БД) — в коде ничего не захардкожено.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Any

from .llm.base import LLMClient, LLMParseError
from .prompt import SYSTEM_PROMPT, build_user_prompt
from .scoring import valid_answer

log = logging.getLogger("cqa.evaluator")
QUOTE_MAX = 120


def _norm(s: str) -> str:
    """Для сравнения цитат: без регистра, пробелов и пунктуации (буквы/цифры любых алфавитов)."""
    s = unicodedata.normalize("NFKC", str(s or "")).casefold()
    return "".join(ch for ch in s if ch.isalnum())


def _words(s: str) -> list[str]:
    return re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", str(s or "")).casefold())


FUZZY_THRESHOLD = 0.6


def quote_matches(quote: str, text: str, fuzzy: bool = False) -> bool:
    """Чаты — строго: подстрока без учёта регистра, пробелов и пунктуации.
    Звонки (fuzzy) — ещё и нечётко: >= 60% слов цитаты есть в реплике или difflib.ratio >= 0.6
    с лучшим окном реплики той же длины (ошибки распознавания, дубли, маски)."""
    q, t = _norm(quote), _norm(text)
    if not q:
        return False
    if q in t:
        return True
    if not fuzzy:
        return False
    qw = _words(quote)
    if len(qw) >= 2:
        tw = set(_words(text))
        if sum(w in tw for w in qw) / len(qw) >= FUZZY_THRESHOLD:
            return True
    if len(q) < 6:
        return False
    if len(t) <= len(q):
        return SequenceMatcher(None, q, t).ratio() >= FUZZY_THRESHOLD
    step = max(1, len(q) // 4)
    return max(SequenceMatcher(None, q, t[i:i + len(q)]).ratio() for i in range(0, len(t) - len(q) + 1, step)) >= FUZZY_THRESHOLD


def normalize_answer(c: dict, a: Any) -> Any:
    """Приводит ответ модели к каноничному виду: "Yes" -> "yes", "N/A" -> "na", "15" / 15.0 -> 15."""
    if isinstance(a, bool) or a is None:
        return a
    if isinstance(a, str):
        t = a.strip().lower().replace("/", "").replace(" ", "")
        if t in ("na", "n.a.", "неприменимо"):
            return "na"
        if c.get("type") != "scale":
            return {"да": "yes", "нет": "no", "иә": "yes", "жоқ": "no", "true": "yes", "false": "no"}.get(t, t)
        try:
            a = float(t.replace(",", "."))
        except ValueError:
            return a
    if isinstance(a, float) and a.is_integer():
        return int(a)
    return a


def _int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and re.fullmatch(r"\s*\d+\s*", v):
        return int(v)
    return None


def validate_output(data: Any, criteria: list[dict], transcript: list[dict], fuzzy: bool = False) -> tuple[dict[str, dict], dict[str, list[str]], list[str]]:
    """Проверяет ответ модели.

    Возвращает (items по criterion_id — уже очищенные от невалидных частей,
                ошибки по criterion_id, общие ошибки). Пустые ошибки = ответ полностью валиден.
    У очищенного item поле "_valid" = True, если по нему нет ошибок.
    """
    n = len(transcript)
    by_id = {c["id"]: c for c in criteria}
    errs: dict[str, list[str]] = {}
    general: list[str] = []
    out: dict[str, dict] = {}

    raw_items = data.get("items") if isinstance(data, dict) else None
    if not isinstance(raw_items, list):
        return {}, {}, ["В ответе нет массива items."]

    for raw in raw_items:
        if not isinstance(raw, dict):
            general.append("Элемент items не является объектом.")
            continue
        cid = str(raw.get("criterion_id", ""))
        if cid not in by_id:
            general.append(f"Лишний критерий «{cid}»: такого id нет в чек-листе.")
            continue
        if cid in out:
            general.append(f"Критерий {cid} встречается в items дважды.")
            continue
        c = by_id[cid]
        e = errs.setdefault(cid, [])
        answer = normalize_answer(c, raw.get("answer"))
        if not valid_answer(c, answer):
            if answer == "na":
                e.append(f"{cid}: N/A не разрешён для этого критерия.")
            elif c.get("type") == "scale":
                e.append(f"{cid}: ответ {raw.get('answer')!r} не входит в scale_steps {c.get('scale_steps')}.")
            else:
                e.append(f"{cid}: ответ {raw.get('answer')!r} недопустим (ожидается yes/no{'/na' if c.get('allow_na') else ''}).")
            answer = None
        na_reason = raw.get("na_reason")
        na_reason = str(na_reason).strip() if na_reason not in (None, "") else None
        if answer == "na" and not na_reason:
            e.append(f"{cid}: для N/A нужно непустое na_reason.")
            answer = None
        if answer != "na":
            na_reason = None

        evidence, quotes = [], []
        for k, item in enumerate(raw.get("evidence") or []):
            idx = _int(item.get("index")) if isinstance(item, dict) else _int(item)
            quote = str(item.get("quote") or "") if isinstance(item, dict) else ""
            if idx is None or not 0 <= idx < n:
                e.append(f"{cid}: evidence[{k}] — индекс {item.get('index') if isinstance(item, dict) else item!r} вне диапазона 0..{n - 1}.")
                continue
            if not quote_matches(quote, transcript[idx].get("text"), fuzzy):
                e.append(f"{cid}: evidence[{k}] — цитата не найдена в реплике [{idx}]: «{quote[:60]}».")
                continue
            if idx not in evidence:
                evidence.append(idx)
                quotes.append({"index": idx, "quote": quote[:QUOTE_MAX]})

        rng = raw.get("checked_range")
        checked_range = None
        if rng is not None:
            a, b = (_int(rng[0]), _int(rng[1])) if isinstance(rng, list) and len(rng) == 2 else (None, None)
            if a is None or b is None or not (0 <= a <= b < n):
                e.append(f"{cid}: checked_range {rng!r} некорректен (нужно [from, to] в пределах 0..{n - 1}).")
            else:
                checked_range = [a, b]

        if answer is not None and answer != "na" and not evidence and not checked_range:
            e.append(f"{cid}: для ответа нужны evidence с цитатами или checked_range.")

        out[cid] = {
            "criterion_id": cid, "answer": answer, "final_answer": None,
            "explanation": str(raw.get("explanation") or "").strip(),
            "evidence": evidence, "evidence_quotes": quotes, "checked_range": checked_range,
            "na_reason": na_reason, "decision": None, "_valid": not e,
        }

    for c in criteria:
        if c["id"] not in out:
            errs.setdefault(c["id"], []).append(f"{c['id']}: нет ответа по критерию «{c.get('title')}».")
    errs = {k: v for k, v in errs.items() if v}
    return out, errs, general


def _salvage(c: dict, item: dict | None, n: int) -> dict:
    """Финальная версия пункта, если и после повтора он невалиден: оставить валидное, не падать."""
    if item is None:
        item = {"criterion_id": c["id"], "answer": None, "final_answer": None, "explanation": "",
                "evidence": [], "evidence_quotes": [], "checked_range": None, "na_reason": None, "decision": None}
    item = {k: v for k, v in item.items() if k != "_valid"}
    if c.get("is_flag") and item["answer"] == "no" and not item["evidence"] and not item["checked_range"]:
        item["checked_range"] = [0, max(0, n - 1)]
    if not item["explanation"]:
        item["explanation"] = "Модель не дала корректного обоснования; требуется ручная проверка."
    return item


def _add_usage(total: dict, u: dict) -> None:
    total["input_tokens"] += int(u.get("input_tokens") or 0)
    total["output_tokens"] += int(u.get("output_tokens") or 0)
    total["duration_ms"] += int(u.get("duration_ms") or 0)
    total["calls"] += 1


def _cost(usage: dict, price_in: float | None, price_out: float | None) -> float | None:
    if price_in is None and price_out is None:
        return None
    return round(usage["input_tokens"] / 1e6 * (price_in or 0) + usage["output_tokens"] / 1e6 * (price_out or 0), 6)


def evaluate(llm: LLMClient, conv: dict, criteria: list[dict], *, price_in: float | None = None,
             price_out: float | None = None) -> dict:
    """-> {items, usage, warnings, model}. Исключения LLMError (сеть, ключ) пробрасываются."""
    transcript = conv.get("transcript") or []
    fuzzy = conv.get("channel") == "voice call"
    user = build_user_prompt(conv, criteria)
    usage = {"input_tokens": 0, "output_tokens": 0, "calls": 0, "duration_ms": 0, "retried": False}
    attempts: list[tuple[dict, dict[str, list[str]], list[str]]] = []
    raw_prev = ""

    for attempt in (1, 2):
        prompt = user
        if attempt == 2:
            _, prev_errs, prev_general = attempts[-1]
            problems = prev_general + [m for v in prev_errs.values() for m in v]
            prompt = (user + "\n\nТвой предыдущий ответ:\n" + raw_prev[:20000] +
                      "\n\nВ нём ошибки, исправь их и верни ПОЛНЫЙ JSON заново (все критерии):\n- " + "\n- ".join(problems))
            usage["retried"] = True
        try:
            data, u = llm.complete_json(SYSTEM_PROMPT, prompt)
            raw_prev = json.dumps(data, ensure_ascii=False)
            _add_usage(usage, u)
            attempts.append(validate_output(data, criteria, transcript, fuzzy))
        except LLMParseError as e:
            _add_usage(usage, e.usage)
            raw_prev = e.raw
            attempts.append(({}, {}, [str(e)]))
        items, errs, general = attempts[-1]
        log.info("evaluate conv=%s model=%s attempt=%d tokens_in=%d tokens_out=%d ms=%d errors=%d",
                 conv.get("conversation_id"), llm.model, attempt, usage["input_tokens"], usage["output_tokens"],
                 usage["duration_ms"], len(general) + sum(map(len, errs.values())))
        if not errs and not general:
            break

    # Слияние: по каждому критерию берём валидный пункт из последней попытки, иначе из первой, иначе — спасаем.
    last_items, last_errs, last_general = attempts[-1]
    final_items, warnings = [], list(last_general)
    for c in criteria:
        cid = c["id"]
        chosen = next((a[0][cid] for a in reversed(attempts) if cid in a[0] and a[0][cid]["_valid"]), None)
        if chosen is None:
            chosen = _salvage(c, last_items.get(cid) or next((a[0].get(cid) for a in attempts if a[0].get(cid)), None), len(transcript))
            warnings += last_errs.get(cid) or [f"{cid}: ответ модели невалиден после повтора."]
        else:
            chosen = {k: v for k, v in chosen.items() if k != "_valid"}
        final_items.append(chosen)

    usage["cost_usd"] = _cost(usage, price_in, price_out)
    log.info("evaluation_usage conv=%s model=%s calls=%d tokens_in=%d tokens_out=%d cost_usd=%s",
             conv.get("conversation_id"), llm.model, usage["calls"], usage["input_tokens"],
             usage["output_tokens"], usage["cost_usd"])
    usage["model"] = llm.model
    usage["provider"] = llm.provider
    return {"items": final_items, "usage": usage, "warnings": warnings, "model": f"{llm.provider}:{llm.model}"}
