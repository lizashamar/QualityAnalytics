"""Клиент API организаторов: GET по ORGANIZER_API_URL с group_id.

group_id подставляется в {group_id}, если он есть в URL, иначе добавляется query-параметром.
Ответ: {"error": "", "isSuccess": true, "data": {"dataset_group_id", "total_records", "records": [...]}}
"""
from __future__ import annotations

import logging
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx

log = logging.getLogger("cqa.organizers")


class OrganizerError(Exception):
    """Понятная ошибка для пользователя (отдаётся как 502)."""


def build_url(template: str, group_id: str) -> str:
    if "{group_id}" in template:
        return template.replace("{group_id}", group_id)
    parts = urlsplit(template)
    q = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "group_id"] + [("group_id", group_id)]
    return urlunsplit(parts._replace(query=urlencode(q)))


def http_get(url: str, timeout: float) -> httpx.Response:  # подменяется в тестах
    return httpx.get(url, timeout=timeout, follow_redirects=True, headers={"Accept": "application/json"})


def _valid_record(r) -> bool:
    return (isinstance(r, dict) and isinstance(r.get("conversation_id"), str) and r["conversation_id"].strip() != ""
            and isinstance(r.get("transcript"), list)
            and all(isinstance(t, dict) and "text" in t and "speaker" in t for t in r["transcript"]))


def fetch_dataset(url_template: str, group_id: str, timeout: float = 60) -> dict:
    """-> {group_id, total_records, records, skipped}. Записи возвращаются как пришли (метки времени и порядок не трогаем)."""
    if not url_template:
        raise OrganizerError("Не задан ORGANIZER_API_URL в backend/.env")
    url = build_url(url_template, group_id)
    host = urlsplit(url).netloc
    try:
        resp = http_get(url, timeout)
    except httpx.TimeoutException:
        raise OrganizerError(f"API организаторов ({host}) не ответило за {int(timeout)} с") from None
    except httpx.HTTPError as e:
        raise OrganizerError(f"API организаторов ({host}) недоступно: {type(e).__name__}") from None
    if resp.status_code >= 400:
        raise OrganizerError(f"API организаторов вернуло HTTP {resp.status_code}")
    try:
        body = resp.json()
    except ValueError:
        raise OrganizerError("API организаторов вернуло не JSON") from None
    return parse_response(body, group_id)


def parse_response(body, group_id: str) -> dict:
    """Разбор тела ответа организаторов (используется и для импорта из файла)."""
    if not isinstance(body, dict) or not body.get("isSuccess"):
        msg = (body.get("error") if isinstance(body, dict) else "") or "isSuccess=false"
        raise OrganizerError(f"API организаторов сообщило об ошибке: {msg}")
    data = body.get("data") or {}
    raw = data.get("records") or []
    records = [r for r in raw if _valid_record(r)]
    log.info("organizers group=%s records=%d skipped=%d", group_id, len(records), len(raw) - len(records))
    return {
        "group_id": data.get("dataset_group_id") or group_id,
        "total_records": data.get("total_records", len(raw)),
        "records": records,
        "skipped": len(raw) - len(records),
    }
