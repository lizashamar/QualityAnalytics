"""Бизнес-операции и приведение к формату фронтенда (frontend/js/api.js)."""
from __future__ import annotations

import logging

from . import organizers
from .config import Settings
from .db import Database, dumps, loads, now_iso
from .evaluator import evaluate, normalize_answer, validate_saved
from .llm.base import LLMClient
from .scoring import calculate, round2, valid_answer

log = logging.getLogger("cqa.services")


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def ev_key(n: int) -> str:
    return f"ev-{n}"


def ap_key(n: int) -> str:
    return f"AP-{n}"


def parse_key(s: str, prefix: str, what: str) -> int:
    t = str(s).strip()
    if t.lower().startswith(prefix.lower()):
        t = t[len(prefix):]
    if not t.isdigit():
        raise ApiError(404, f"{what} «{s}» не найдена")
    return int(t)


def answers_of(items: list[dict], final: bool) -> dict:
    return {i["criterion_id"]: (i.get("final_answer") if final and i.get("final_answer") is not None else i.get("answer")) for i in items}


def _sections(calc: dict) -> list[dict]:
    return [{k: s[k] for k in ("section", "points", "max", "percent", "gross_flag")} for s in calc["sections"]]


def criterion_result_fields(item: dict) -> dict:
    """Expose specification names alongside the established UI contract."""
    answer = item.get("answer")
    if answer == "na":
        status, score = "na", None
    elif isinstance(answer, (int, float)) and not isinstance(answer, bool):
        status, score = "scale", answer
    elif answer in ("yes", "no"):
        status, score = ("passed", 1) if answer == "yes" else ("failed", 0)
    else:
        status, score = "invalid", None
    return {"status": status, "raw_score": score, "rationale": item.get("explanation", ""),
            "na_justification": item.get("na_reason")}


def evaluation_out(ev: dict, conv: dict | None = None) -> dict:
    criteria, items = ev["criteria"], ev["items"]
    orig = calculate(criteria, answers_of(items, final=False))
    fin = calculate(criteria, answers_of(items, final=True))
    failed = ev.get("status") == "error" or any(r["error"] for r in orig["rows"]) or len(items) != len(criteria)
    if conv is not None and not failed and not ev.get('stale'):
        _, errors, general = validate_saved(ev, conv)
        failed = bool(errors or general)
    unavailable = failed or ev.get("stale", False)
    rows = {r["criterion_id"]: r for r in orig["rows"]}
    key = ev_key(ev["id"])
    return {
        "id": key,
        "conversation_id": ev["conversation_id"],
        "checklist_id": ev["checklist_id"],
        "checklist_version": ev["checklist_version"],
        "model": ev["model"],
        "created_at": ev["created_at"],
        "archived": ev["archived"],
        "status": "error" if failed else "ok",
        "error": ev.get("error") or ("Неполная или невалидная оценка. Запустите повторную оценку." if failed else None),
        "stale": bool(ev.get("stale")),
        "provenance": ev.get("provenance") or {},
        "total": None if unavailable else orig["total"],
        "gross_flag": None if unavailable else orig["gross_flag"],
        "sections": [] if unavailable else _sections(orig),
        "final_total": None if unavailable else fin["total"],
        "final_gross_flag": None if unavailable else fin["gross_flag"],
        "items": [{"id": f"{key}:{i['criterion_id']}", **i, **criterion_result_fields(i), "points": round2(rows[i["criterion_id"]]["points"]) if i["criterion_id"] in rows else 0}
                  for i in items],
        "criteria": criteria,
        "usage": ev["usage"],
        "warnings": ev["warnings"],
    }


def appeal_out(a: dict) -> dict:
    ek = ev_key(a["evaluation_id"])
    return {
        "id": ap_key(a["id"]),
        "evaluation_id": ek,
        "evaluation_item_id": f"{ek}:{a['criterion_id']}",
        "conversation_id": a["conversation_id"],
        "criterion_id": a["criterion_id"],
        "checklist_id": a["checklist_id"],
        "comment": a["comment"],
        "original_answer": a["original_answer"],
        "status": a["status"],
        "created_at": a["created_at"],
        "decision": a["decision"],
        "resolution": a["decision"],  # то же, имя из контракта фронтенда
    }


def run_evaluation(db: Database, settings: Settings, llm: LLMClient, conversation_id: str, checklist_id: str | None) -> dict:
    conv = db.get_conversation(conversation_id)
    if not conv:
        raise ApiError(404, f"Диалог «{conversation_id}» не найден")
    cl = db.get_checklist(checklist_id) if checklist_id else db.active_checklist()
    if not cl:
        raise ApiError(404, f"Чек-лист «{checklist_id}» не найден" if checklist_id else "Нет активного чек-листа")
    result = evaluate(llm, conv, cl["criteria"], price_in=settings.price_in_per_mtok, price_out=settings.price_out_per_mtok)
    eid, outdated = db.insert_evaluation({
        "conversation_id": conversation_id, "checklist_id": cl["id"], "checklist_version": cl["version"],
        "model": result["model"], "criteria": cl["criteria"], "items": result["items"],
        "status": result.get("status", "ok"), "error": result.get("error"), "provenance": result.get("provenance", {}),
        "usage": result["usage"], "warnings": result["warnings"],
    })
    u = result["usage"]
    log.info("evaluation saved id=%s conv=%s checklist=%s calls=%d tokens=%d/%d cost=%s warnings=%d outdated_appeals=%d",
             eid, conversation_id, cl["id"], u["calls"], u["input_tokens"], u["output_tokens"], u["cost_usd"],
             len(result["warnings"]), outdated)
    return evaluation_out(db.get_evaluation(eid), conv)


def get_evaluation(db: Database, key: str) -> dict:
    ev = db.get_evaluation(parse_key(key, "ev-", "Оценка"))
    if not ev:
        raise ApiError(404, f"Оценка «{key}» не найдена")
    return evaluation_out(ev, db.get_conversation(ev['conversation_id']))


def create_appeal(db: Database, *, evaluation_item_id: str | None, conversation_id: str | None,
                  criterion_id: str | None, comment: str) -> dict:
    comment = (comment or "").strip()
    if not comment:
        raise ApiError(400, "Комментарий к апелляции обязателен")
    if evaluation_item_id:
        if ":" not in evaluation_item_id:
            raise ApiError(400, "evaluation_item_id должен иметь вид ev-<id>:<criterion_id>")
        ek, criterion_id = evaluation_item_id.split(":", 1)
        ev = db.get_evaluation(parse_key(ek, "ev-", "Оценка"))
        if not ev:
            raise ApiError(404, f"Оценка «{ek}» не найдена")
    else:
        if not conversation_id or not criterion_id:
            raise ApiError(400, "Нужно evaluation_item_id или пара conversation_id + criterion_id")
        ev = db.latest_evaluation(conversation_id)
        if not ev:
            raise ApiError(404, f"У диалога «{conversation_id}» нет оценки")
    if ev["archived"] or ev.get("stale") or evaluation_out(ev, db.get_conversation(ev['conversation_id']))['status'] == 'error':
        raise ApiError(409, "Оценка устарела: диалог переоценён, оспорьте новую оценку")
    item = next((i for i in ev["items"] if i["criterion_id"] == criterion_id), None)
    if not item:
        raise ApiError(404, f"В оценке нет критерия «{criterion_id}»")
    with db.tx() as c:
        if c.execute("SELECT 1 FROM appeals WHERE evaluation_id = ? AND criterion_id = ? AND status = 'open'",
                     (ev["id"], criterion_id)).fetchone():
            raise ApiError(409, "По этому критерию уже есть открытая апелляция")
        current = item.get("final_answer") if item.get("final_answer") is not None else item.get("answer")
        cur = c.execute(
            "INSERT INTO appeals (evaluation_id, conversation_id, criterion_id, comment, original_answer, status, created_at)"
            " VALUES (?, ?, ?, ?, ?, 'open', ?)",
            (ev["id"], ev["conversation_id"], criterion_id, comment, dumps(current), now_iso()),
        )
        return appeal_out(db.get_appeal(cur.lastrowid, c))


def resolve_appeal(db: Database, key: str, new_answer, reason: str) -> dict:
    aid = parse_key(key, "AP-", "Апелляция")
    reason = (reason or "").strip()
    with db.tx() as c:
        ap = db.get_appeal(aid, c)
        if not ap:
            raise ApiError(404, f"Апелляция «{key}» не найдена")
        if ap["status"] == "resolved":
            raise ApiError(409, "Апелляция уже рассмотрена")
        evaluation = db.get_evaluation(ap["evaluation_id"])
        if ap["status"] == "outdated" or evaluation.get("stale") or evaluation_out(evaluation, db.get_conversation(evaluation['conversation_id']))['status'] == 'error':
            raise ApiError(409, "Апелляция устарела: диалог переоценён")
        row = c.execute("SELECT criteria_json, items_json FROM evaluations WHERE id = ?", (ap["evaluation_id"],)).fetchone()
        criteria, items = loads(row["criteria_json"], []), loads(row["items_json"], [])
        crit = next((x for x in criteria if x["id"] == ap["criterion_id"]), None)
        answer = normalize_answer(crit or {}, new_answer)
        if not valid_answer(crit, answer):
            raise ApiError(400, f"Недопустимый ответ {new_answer!r} для критерия «{crit['title'] if crit else ap['criterion_id']}»")
        if not reason:
            raise ApiError(400, "Причина решения обязательна")
        previous_total = calculate(criteria, answers_of(items, final=True))["total"]
        item = next(i for i in items if i["criterion_id"] == ap["criterion_id"])
        previous_answer = item.get("final_answer") if item.get("final_answer") is not None else item.get("answer")
        item["final_answer"] = answer
        final = calculate(criteria, answers_of(items, final=True))
        decision = {
            "appeal_id": ap_key(aid), "new_answer": answer, "previous_answer": previous_answer, "reason": reason,
            "resolved_at": now_iso(), "previous_total": previous_total, "final_total": final["total"],
            "final_gross_flag": final["gross_flag"],
        }
        item["decision"] = decision
        db.update_evaluation_items(c, ap["evaluation_id"], items)
        c.execute("UPDATE appeals SET status = 'resolved', decision_json = ? WHERE id = ?", (dumps(decision), aid))
        return appeal_out(db.get_appeal(aid, c))


def import_dataset(db: Database, settings: Settings, group_id: str) -> dict:
    group_id = group_id.strip()
    if not group_id:
        raise ApiError(400, "group_id не может быть пустым")
    data = organizers.fetch_dataset(settings.organizer_api_url, group_id)
    n = db.upsert_conversations(data["records"], group_id)
    return {"group_id": group_id, "imported": n, "total": data["total_records"], "skipped": data["skipped"]}
