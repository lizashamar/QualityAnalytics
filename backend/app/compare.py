"""Сравнение двух версий чек-листа: diff критериев и изменение итогов диалогов.

Итоги считаются существующим scoring.calculate по снимку критериев КАЖДОЙ оценки (criteria_json),
для каждой версии берётся последняя оценка диалога (включая архивные). Расчёт баллов не меняется.
"""
from __future__ import annotations

from typing import Any

from .db import Database
from .scoring import calculate, round2

# поле -> подпись для интерфейса
FIELDS = {
    "title": "Название",
    "question": "Описание",
    "section": "Раздел",
    "weight": "Вес",
    "type": "Тип ответа",
    "scale_steps": "Шкала",
    "scale_labels": "Описания ступеней",
    "allow_na": "N/A разрешён",
    "na_condition": "Условие N/A",
    "is_flag": "Флаг грубого нарушения",
}
EPS = 0.005


def _num(v: Any) -> Any:
    if isinstance(v, bool) or v is None:
        return v
    if isinstance(v, (int, float)):
        f = float(v)
        return int(f) if f.is_integer() else f
    return v


def _label_key(k: Any) -> str:
    try:
        return str(_num(float(k)))
    except (TypeError, ValueError):
        return str(k)


def _norm(field: str, v: Any) -> Any:
    """Нормализация для сравнения: 20 == 20.0, порядок ступеней не важен, пустое == отсутствующее."""
    if field == "scale_steps":
        return sorted((_num(x) for x in (v or [])), reverse=True)
    if field == "scale_labels":
        return {_label_key(k): str(t) for k, t in (v or {}).items() if str(t).strip()}
    if field == "weight":
        return _num(v or 0)
    if field in ("allow_na", "is_flag"):
        return bool(v)
    if field == "type":
        return v or "yesno"
    return (v or "").strip() if isinstance(v, str) or v is None else v


def _brief(c: dict) -> dict:
    return {"criterion_id": c["id"], "title": c.get("title", ""), "section": c.get("section", ""),
            "weight": _num(c.get("weight", 0)), "type": c.get("type", "yesno"), "is_flag": bool(c.get("is_flag")),
            "allow_na": bool(c.get("allow_na")), "scale_steps": _norm("scale_steps", c.get("scale_steps"))}


def diff_criteria(a: list[dict], b: list[dict]) -> dict:
    """{added: [...], removed: [...], changed: [{criterion_id, title, changes: [{field, label, from, to}]}]}"""
    by_a = {c["id"]: c for c in a}
    by_b = {c["id"]: c for c in b}
    added = [_brief(c) for c in b if c["id"] not in by_a]
    removed = [_brief(c) for c in a if c["id"] not in by_b]
    changed = []
    for c in b:
        old = by_a.get(c["id"])
        if not old:
            continue
        changes = []
        for f, label in FIELDS.items():
            x, y = _norm(f, old.get(f)), _norm(f, c.get(f))
            if x != y:
                changes.append({"field": f, "label": label, "from": x, "to": y})
        if changes:
            changed.append({"criterion_id": c["id"], "title": c.get("title") or old.get("title", ""), "changes": changes})
    return {"added": added, "removed": removed, "changed": changed,
            "unchanged": sum(1 for c in b if c["id"] in by_a) - len(changed)}


def _answers(items: list[dict], final: bool) -> dict:
    return {i["criterion_id"]: (i.get("final_answer") if final and i.get("final_answer") is not None else i.get("answer")) for i in items}


def _score(ev: dict) -> dict:
    crit = ev["criteria"]
    orig = calculate(crit, _answers(ev["items"], False))
    fin = calculate(crit, _answers(ev["items"], True))
    has_decision = any(i.get("final_answer") is not None for i in ev["items"])
    return {
        "total": orig["total"], "gross": orig["gross_flag"],
        "final_total": fin["total"] if has_decision else None,
        "final_gross": fin["gross_flag"] if has_decision else None,
        "rows": {r["criterion_id"]: r for r in orig["rows"]},
        "answers": _answers(ev["items"], False),
        "titles": {c["id"]: c.get("title", c["id"]) for c in crit},
        "flags": {c["id"] for c in crit if c.get("is_flag")},
        "cost": (ev.get("usage") or {}).get("cost_usd"),
    }


def _pts(score: dict, cid: str):
    if cid in score["flags"]:
        return None
    r = score["rows"].get(cid)
    return round2(r["points"]) if r and r["applicable"] else None


def compare_evaluations(evs_from: dict[str, dict], evs_to: dict[str, dict]) -> dict:
    """evs_*: conversation_id -> evaluation (как из db._evaluation). Возвращает {summary, rows}."""
    both = sorted(set(evs_from) & set(evs_to))
    rows = []
    for cid in both:
        a, b = _score(evs_from[cid]), _score(evs_to[cid])
        delta = round2(b["total"] - a["total"]) if a["total"] is not None and b["total"] is not None else None
        changed, points_changed = [], []
        for k in list(dict.fromkeys([*a["answers"], *b["answers"]])):
            ans_a, ans_b = a["answers"].get(k), b["answers"].get(k)
            pa, pb = _pts(a, k), _pts(b, k)
            entry = {"criterion_id": k, "title": b["titles"].get(k) or a["titles"].get(k) or k,
                     "answer_from": ans_a, "answer_to": ans_b, "points_from": pa, "points_to": pb}
            if ans_a != ans_b or (k in a["answers"]) != (k in b["answers"]):
                changed.append(entry)
            elif pa is not None and pb is not None and abs(pa - pb) > EPS:
                points_changed.append(entry)
        rows.append({
            "conversation_id": cid,
            "evaluation_from": f"ev-{evs_from[cid]['id']}", "evaluation_to": f"ev-{evs_to[cid]['id']}",
            "total_from": a["total"], "total_to": b["total"], "delta": delta,
            "final_total_from": a["final_total"], "final_total_to": b["final_total"],
            "gross_from": a["gross"], "gross_to": b["gross"],
            "changed_criteria": changed, "points_changed": points_changed,
        })

    with_delta = [r for r in rows if r["delta"] is not None]
    tf = [r["total_from"] for r in rows if r["total_from"] is not None]
    tt = [r["total_to"] for r in rows if r["total_to"] is not None]
    gf = sum(1 for r in rows if r["gross_from"])
    gt = sum(1 for r in rows if r["gross_to"])
    costs = [c for c in (( evs_to[cid].get("usage") or {}).get("cost_usd") for cid in evs_to) if isinstance(c, (int, float))]
    summary = {
        "compared": len(rows),
        "evaluated_in_from": len(evs_from), "evaluated_in_to": len(evs_to),
        "not_evaluated_in_to": len(set(evs_from) - set(evs_to)),
        "not_evaluated_in_from": len(set(evs_to) - set(evs_from)),
        "avg_from": round2(sum(tf) / len(tf)) if tf else None,
        "avg_to": round2(sum(tt) / len(tt)) if tt else None,
        "avg_delta": round2(sum(r["delta"] for r in with_delta) / len(with_delta)) if with_delta else None,
        "improved": sum(1 for r in with_delta if r["delta"] > EPS),
        "declined": sum(1 for r in with_delta if r["delta"] < -EPS),
        "unchanged": sum(1 for r in with_delta if abs(r["delta"]) <= EPS),
        "gross_from": gf, "gross_to": gt, "gross_changed": gf != gt or any(r["gross_from"] != r["gross_to"] for r in rows),
        "reevaluation_cost_usd": round(sum(costs), 6) if costs else None,
    }
    return {"summary": summary, "rows": rows}


def compare_checklists(db: Database, from_id: str, to_id: str) -> dict:
    from .services import ApiError  # локально: services импортирует много всего
    a, b = db.get_checklist(from_id), db.get_checklist(to_id)
    if not a:
        raise ApiError(404, f"Чек-лист «{from_id}» не найден")
    if not b:
        raise ApiError(404, f"Чек-лист «{to_id}» не найден")
    if a["id"] == b["id"]:
        raise ApiError(400, "Выберите две разные версии чек-листа")
    result = compare_evaluations(db.latest_evaluations_by_checklist(a["id"]), db.latest_evaluations_by_checklist(b["id"]))
    brief = lambda cl: {"id": cl["id"], "name": cl["name"], "version": cl["version"], "family_id": cl["family_id"],  # noqa: E731
                        "created_at": cl["created_at"], "criteria": len(cl["criteria"])}
    return {"from": brief(a), "to": brief(b), "diff": diff_criteria(a["criteria"], b["criteria"]), **result}


def evaluation_history(db: Database, group_id: str | None = None) -> list[dict]:
    """По каждому диалогу — последняя оценка по каждой версии чек-листа (для «v1: 75 → v2: 68»)."""
    out = []
    for ev in db.latest_evaluations_per_version(group_id):
        s = _score(ev)
        out.append({"conversation_id": ev["conversation_id"], "evaluation_id": f"ev-{ev['id']}",
                    "checklist_id": ev["checklist_id"], "checklist_version": ev["checklist_version"],
                    "total": s["total"], "final_total": s["final_total"], "gross_flag": s["gross"],
                    "created_at": ev["created_at"], "archived": ev["archived"]})
    return out
