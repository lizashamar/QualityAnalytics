"""Порт frontend/js/scoring.js 1в1. Поведение и округление должны совпадать с JS.

calculate(criteria, answers) -> {total, sections, gross_flag, rows, applicable_weight}
Отсутствующий/недопустимый ответ не исключает критерий: 0 баллов и row["error"].
"""
from __future__ import annotations

import math
import sys
from typing import Any

Answer = Any  # "yes" | "no" | "na" | число


_EPS = sys.float_info.epsilon  # == Number.EPSILON


def round2(x: float) -> float:
    """Точная копия JS: Math.round((x + Number.EPSILON) * 100) / 100.

    Math.round — округление половины вверх в IEEE-double. Decimal(repr(x)) дал бы другой
    результат на границах (1.005 -> 1.01 вместо 1.00 в JS), поэтому повторяем арифметику JS.
    """
    v = (float(x) + _EPS) * 100
    r = math.floor(v)
    if v - r >= 0.5:
        r += 1
    return r / 100


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def normalize_criterion(c: dict) -> dict:
    """Adapt specification scale names to the existing checklist contract.

    Explicit scales contain every integer score. Legacy custom steps remain unchanged.
    """
    kind = c.get("evaluation_type")
    if kind not in ("binary", "scale_10", "scale_20"):
        return c
    result = {**c}
    if kind == "binary":
        result.update(type="yesno", scale_steps=[])
    else:
        maximum = 10 if kind == "scale_10" else 20
        result.update(type="scale", scale_steps=list(range(maximum, -1, -1)))
    return result


def _steps(c: dict) -> list[float]:
    return [float(s) for s in (c.get("scale_steps") or []) if _is_number(s)]


def _max_step(c: dict) -> float:
    st = _steps(c)
    return max(st) if st else 0.0


def allowed_answers(c: dict) -> list:
    c = normalize_criterion(c)
    if c.get("type") == "scale":
        base = sorted((c.get("scale_steps") or []), key=lambda x: -float(x))
    else:
        base = ["no", "yes"] if c.get("is_flag") else ["yes", "no"]
    return [*base, "na"] if c.get("allow_na") else list(base)


def valid_answer(c: dict | None, answer: Answer) -> bool:
    if not c:
        return False
    c = normalize_criterion(c)
    if answer == "na" and isinstance(answer, str):
        return bool(c.get("allow_na"))
    if c.get("type") == "scale":
        if not _is_number(answer):
            return False
        return float(answer) in _steps(c)
    return answer in ("yes", "no") and isinstance(answer, str)


def _fraction(c: dict, answer: Answer) -> float:
    if c.get("type") == "scale":
        m = _max_step(c)
        return float(answer) / m if m > 0 else 0.0
    return 1.0 if answer == "yes" else 0.0


def calculate(criteria: list[dict], answers: dict | None) -> dict:
    criteria = [normalize_criterion(c) for c in criteria]
    answers = answers or {}
    rows = []
    for c in criteria:
        has = c["id"] in answers
        answer = answers.get(c["id"]) if has else None
        valid = has and valid_answer(c, answer)
        error = "missing" if not has else ("invalid" if not valid else None)
        na = valid and answer == "na"
        is_flag = bool(c.get("is_flag"))
        rows.append({
            "criterion_id": c["id"],
            "section": c.get("section") or "",
            "answer": answer,
            "is_flag": is_flag,
            "applicable": (not is_flag) and not na,
            "weight": 0 if is_flag else (float(c.get("weight") or 0)),
            "effective_weight": 0.0,
            "fraction": None,
            "points": 0.0,
            "error": error,
        })

    W = sum(r["weight"] for r in rows if r["applicable"])
    by_id = {c["id"]: c for c in criteria}
    for r in rows:
        if not r["applicable"] or W == 0:
            continue
        r["effective_weight"] = r["weight"] / W * 100
        r["fraction"] = 0.0 if r["error"] else _fraction(by_id[r["criterion_id"]], r["answer"])
        r["points"] = r["fraction"] * r["effective_weight"]

    gross_flag = any(r["is_flag"] and not r["error"] and r["answer"] == "yes" for r in rows)
    total = None if W == 0 else min(100.0, max(0.0, round2(sum(r["points"] for r in rows))))

    sections: list[dict] = []
    for r in rows:
        s = next((x for x in sections if x["section"] == r["section"]), None)
        if s is None:
            s = {"section": r["section"], "points": 0.0, "max": 0.0, "percent": None, "gross_flag": False}
            sections.append(s)
        s["points"] += r["points"]
        s["max"] += r["effective_weight"]
        if r["is_flag"] and not r["error"] and r["answer"] == "yes":
            s["gross_flag"] = True
    for s in sections:
        s["points"] = round2(s["points"])
        s["max"] = round2(s["max"])
        s["percent"] = round2(s["points"] / s["max"] * 100) if s["max"] > 0 else None

    return {"total": total, "sections": sections, "gross_flag": gross_flag, "rows": rows,
            "applicable_weight": W if W % 1 else int(W)}


def validate_checklist(criteria: list[dict]) -> list[str]:
    """Тексты ошибок (пусто — ок). Совпадает с validateChecklist в JS."""
    criteria = [normalize_criterion(c) for c in criteria]
    errors: list[str] = []
    if not criteria:
        errors.append("Добавьте хотя бы один критерий.")
    total = sum(float(c.get("weight") or 0) for c in criteria if not c.get("is_flag"))
    if not math.isfinite(total):
        errors.append("Сумма весов должна быть конечным числом.")
    elif abs(total - 100) > 1e-9:
        t = round2(total)
        errors.append(f"Сумма весов критериев с баллами должна быть 100 (сейчас {int(t) if t == int(t) else t}).")
    ids: set = set()
    for i, c in enumerate(criteria):
        n = f"Критерий {i + 1}"
        if c.get("evaluation_type") not in (None, "binary", "scale_10", "scale_20"):
            errors.append(f"{n}: неизвестный evaluation_type.")
        weight = c.get("weight", 0)
        if not _is_number(weight) or weight < 0:
            errors.append(f"{n}: вес должен быть конечным неотрицательным числом.")
        if not str(c.get("id") or "").strip():
            errors.append(f"{n}: нет id.")
        if c.get("id") in ids:
            errors.append(f"{n}: повторяющийся id «{c.get('id')}».")
        ids.add(c.get("id"))
        if not str(c.get("title") or "").strip():
            errors.append(f"{n}: нет названия.")
        if not str(c.get("section") or "").strip():
            errors.append(f"{n}: не указана секция.")
        if not c.get("is_flag") and not (float(c.get("weight") or 0) > 0):
            errors.append(f"{n}: вес должен быть больше 0.")
        if c.get("type") == "scale":
            st = c.get("scale_steps") or []
            if len(st) < 2:
                errors.append(f"{n}: у шкалы должно быть минимум 2 ступени.")
            if any(not _is_number(x) or x < 0 for x in st):
                errors.append(f"{n}: ступени шкалы должны быть неотрицательными числами.")
            if len(set(st)) != len(st):
                errors.append(f"{n}: ступени шкалы не должны повторяться.")
            nums = [x for x in st if _is_number(x)]
            if not nums or not (max(nums) > 0):
                errors.append(f"{n}: верхняя ступень шкалы должна быть больше 0.")
        if c.get("allow_na") and not str(c.get("na_condition") or "").strip():
            errors.append(f"{n}: для N/A укажите условие.")
    return errors
