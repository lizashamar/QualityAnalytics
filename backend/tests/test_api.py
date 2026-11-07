"""Полный сценарий через TestClient с mock-провайдером, без сети."""
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app import organizers
from app.config import load_settings
from app.main import create_app

RECORDS = [
    {"conversation_id": "dev-ru-1", "channel": "agent chat", "language": "RU", "audio_url": None, "transcript": [
        {"timestamp": "00:02", "speaker": "client", "text": "Здравствуйте, хочу вывести деньги, заявка W-1 висит три дня."},
        {"timestamp": "00:40", "speaker": "operator", "text": "Здравствуйте! Меня зовут Алия. Подтвердите, пожалуйста, ИИН и кодовое слово."},
        {"timestamp": "01:00", "speaker": "client", "text": "ИИН 900101300123, слово Алатау"},
        {"timestamp": "01:30", "speaker": "operator", "text": "Спасибо, личность подтверждена. Заявка задержана банком, повторный запрос отправлен, деньги придут завтра."},
        {"timestamp": "01:50", "speaker": "operator", "text": "Если будут вопросы — обращайтесь, всего доброго!"}]},
    {"conversation_id": "dev-kz-1", "channel": "agent chat", "language": "KZ", "audio_url": None, "transcript": [
        {"timestamp": "00:03", "speaker": "client", "text": "Сәлеметсіз бе, шотқа ақша түспеді"},
        {"timestamp": "03:40", "speaker": "operator", "text": "Күте тұрыңыз."},
        {"timestamp": "04:50", "speaker": "operator", "text": "Білмеймін, банкке жазыңыз."},
        {"timestamp": "04:55", "speaker": "system", "text": "Чат оператормен жабылды"}]},
    {"conversation_id": "dev-call-1", "channel": "voice call", "language": "RU", "audio_url": "https://example/a.mp3", "transcript": [
        {"timestamp": "2026-11-04T10:15:03+05:00", "speaker": "operator", "text": "Служба поддержки, Тимур, здравствуйте."},
        {"timestamp": "2026-11-04T10:15:09+05:00", "speaker": "client", "text": "У меня зависла заявка на облигации."},
        {"timestamp": "2026-11-04T10:15:45+05:00", "speaker": "operator", "text": "Переведите мне лично на карту, я вложу ваши деньги выгоднее."}]},
    {"conversation_id": "", "transcript": []},  # некорректная — пропускается
]


class FakeResp:
    def __init__(self, body, status=200):
        self._b, self.status_code = body, status

    def json(self):
        return self._b


@pytest.fixture
def client(tmp_path, monkeypatch):
    calls = []

    def fake_get(url, timeout):
        calls.append(url)
        if "group_id=BROKEN" in url:
            return FakeResp({"error": "dataset not found", "isSuccess": False, "data": None})
        if "group_id=DOWN" in url:
            raise httpx.ConnectError("down")
        return FakeResp({"error": "", "isSuccess": True, "data": {"dataset_group_id": "DEV", "total_records": 4, "records": RECORDS}})

    monkeypatch.setattr(organizers, "http_get", fake_get)
    s = load_settings().with_(db_path=str(tmp_path / "t.db"))
    with TestClient(create_app(s)) as c:
        c.calls = calls
        yield c


def test_full_scenario(client):
    c = client
    # импорт через бэкенд
    r = c.post("/api/datasets/import", json={"group_id": "DEV"})
    assert r.status_code == 200, r.text
    assert r.json() == {"group_id": "DEV", "imported": 3, "total": 4, "skipped": 1}
    assert "group_id=DEV" in c.calls[0]
    convs = c.get("/api/conversations").json()
    assert {x["conversation_id"] for x in convs} == {"dev-ru-1", "dev-kz-1", "dev-call-1"}
    call = c.get("/api/conversations/dev-call-1").json()
    assert call["transcript"][0]["timestamp"] == "2026-11-04T10:15:03+05:00"  # как пришло
    assert c.get("/api/conversations?group_id=DEV").json() and not c.get("/api/conversations?group_id=X").json()

    # повторный импорт — upsert, не дубли
    c.post("/api/datasets/import", json={"group_id": "DEV"})
    assert len(c.get("/api/conversations").json()) == 3

    # чек-лист v1 из сида активен
    cls = c.get("/api/checklists").json()
    assert len(cls) == 1 and cls[0]["active"] and cls[0]["id"] == "cl-chat-quality-v1" and len(cls[0]["criteria"]) == 8

    # оценка
    ev = c.post("/api/evaluations", json={"conversation_id": "dev-call-1", "checklist_id": "cl-chat-quality-v1"}).json()
    assert ev["id"].startswith("ev-") and ev["checklist_version"] == 1
    assert ev["gross_flag"] is True  # предложение перевести деньги лично
    assert len(ev["items"]) == 8 and all(i["id"] == f'{ev["id"]}:{i["criterion_id"]}' for i in ev["items"])
    assert all(set(i) >= {"criterion_id", "answer", "final_answer", "explanation", "evidence", "checked_range", "na_reason", "decision"} for i in ev["items"])
    assert ev["usage"]["calls"] == 1 and ev["usage"]["cost_usd"] is not None
    assert c.get(f"/api/evaluations/{ev['id']}").json()["id"] == ev["id"]
    assert c.get("/api/evaluations/latest", params={"conversation_id": "dev-call-1"}).json()["id"] == ev["id"]
    assert c.get("/api/evaluations/latest", params={"conversation_id": "dev-ru-1"}).status_code == 404
    assert [e["id"] for e in c.get("/api/evaluations").json()] == [ev["id"]]

    # апелляция (формат фронтенда: evaluation_item_id) и запрет дубля
    c4 = next(i for i in ev["items"] if i["criterion_id"] == "c4")
    ap = c.post("/api/appeals", json={"evaluation_item_id": c4["id"], "comment": "Оператор назвал следующий шаг"})
    assert ap.status_code == 200, ap.text
    ap = ap.json()
    assert ap["status"] == "open" and ap["id"].startswith("AP-") and ap["checklist_id"] == "cl-chat-quality-v1"
    dup = c.post("/api/appeals", json={"conversation_id": "dev-call-1", "criterion_id": "c4", "comment": "ещё раз"})
    assert dup.status_code == 409
    assert c.post("/api/appeals", json={"conversation_id": "dev-call-1", "criterion_id": "c4", "comment": "  "}).status_code == 400

    # resolve: недопустимое значение, пустая причина, успех, повторное закрытие
    assert c.post(f"/api/appeals/{ap['id']}/resolve", json={"new_answer": 12, "reason": "x"}).status_code == 400
    assert c.post(f"/api/appeals/{ap['id']}/resolve", json={"new_answer": 10, "reason": ""}).status_code == 400
    res = c.post(f"/api/appeals/{ap['id']}/resolve", json={"new_answer": 10, "reason": "Шаг назван частично"})
    assert res.status_code == 200, res.text
    d = res.json()["decision"]
    assert d["previous_total"] == ev["total"] and d["final_total"] > ev["total"] and d["new_answer"] == 10
    assert res.json()["resolution"] == d and res.json()["status"] == "resolved"
    assert c.post(f"/api/appeals/{ap['id']}/resolve", json={"new_answer": 5, "reason": "y"}).status_code == 409
    ev2 = c.get(f"/api/evaluations/{ev['id']}").json()
    assert ev2["total"] == ev["total"] and ev2["final_total"] == d["final_total"]  # total исходный, final пересчитан
    item = next(i for i in ev2["items"] if i["criterion_id"] == "c4")
    assert item["final_answer"] == 10 and item["decision"]["reason"] == "Шаг назван частично"

    # открытая апелляция по другому критерию — потом станет outdated
    open_ap = c.post("/api/appeals", json={"conversation_id": "dev-call-1", "criterion_id": "c1", "comment": "не согласен"}).json()

    # новая версия чек-листа: замена критерия c7
    crit = cls[0]["criteria"]
    crit[6] = {**crit[6], "title": "Предложение следующего шага", "question": "Да — оператор предложил следующий шаг.",
               "type": "scale", "scale_steps": [5, 2, 0], "scale_labels": {"5": "чётко", "2": "частично", "0": "нет"}, "allow_na": False, "na_condition": ""}
    bad = c.post("/api/checklists", json={"name": cls[0]["name"], "criteria": [*crit[:6], {**crit[6], "weight": 10}, crit[7]]})
    assert bad.status_code == 400 and "Сумма весов" in bad.json()["detail"]
    v2 = c.post("/api/checklists", json={"name": cls[0]["name"], "criteria": crit})
    assert v2.status_code == 200, v2.text
    v2 = v2.json()
    assert v2["version"] == 2 and v2["active"] and v2["family_id"] == "cl-chat-quality"
    assert [x["active"] for x in c.get("/api/checklists").json()] == [False, True]
    assert c.post("/api/checklists/cl-chat-quality-v1/activate").json()["active"] is True
    assert c.post(f"/api/checklists/{v2['id']}/activate").json()["active"] is True

    # повторная оценка новой версией -> открытые апелляции outdated, старая оценка доступна по id
    ev3 = c.post("/api/evaluations", json={"conversation_id": "dev-call-1", "checklist_id": v2["id"]}).json()
    assert ev3["checklist_version"] == 2
    assert next(i for i in ev3["items"] if i["criterion_id"] == "c7")["answer"] in (5, 2, 0)
    aps = {a["id"]: a for a in c.get("/api/appeals").json()}
    assert aps[open_ap["id"]]["status"] == "outdated" and aps[ap["id"]]["status"] == "resolved"
    assert c.post(f"/api/appeals/{open_ap['id']}/resolve", json={"new_answer": "yes", "reason": "x"}).status_code == 409
    old = c.get(f"/api/evaluations/{ev['id']}").json()
    assert old["archived"] is True and old["checklist_id"] == "cl-chat-quality-v1"
    assert [e["id"] for e in c.get("/api/evaluations").json()] == [ev3["id"]]
    assert c.post("/api/appeals", json={"evaluation_item_id": f"{ev['id']}:c2", "comment": "x"}).status_code == 409


def test_batch_job(client):
    c = client
    c.post("/api/datasets/import", json={"group_id": "DEV"})
    r = c.post("/api/evaluations/batch", json={"all": True}).json()
    assert r["total"] == 3
    for _ in range(100):
        j = c.get(f"/api/jobs/{r['job_id']}").json()
        if j["status"] == "finished":
            break
        time.sleep(0.05)
    assert j == {**j, "status": "finished", "total": 3, "done": 3, "failed": 0, "errors": []}
    assert j["cost_usd"] > 0
    assert len(c.get("/api/evaluations").json()) == 3
    r2 = c.post("/api/evaluations/batch", json={"conversation_ids": ["dev-ru-1", "nope"]}).json()
    for _ in range(100):
        j2 = c.get(f"/api/jobs/{r2['job_id']}").json()
        if j2["status"] == "finished":
            break
        time.sleep(0.05)
    assert j2["done"] == 1 and j2["failed"] == 1 and j2["errors"][0]["conversation_id"] == "nope"
    assert c.post("/api/evaluations/batch", json={}).status_code == 400
    assert c.get("/api/jobs/zzz").status_code == 404


def test_errors(client):
    c = client
    r = c.post("/api/datasets/import", json={"group_id": "BROKEN"})
    assert r.status_code == 502 and "dataset not found" in r.json()["detail"]
    r = c.post("/api/datasets/import", json={"group_id": "DOWN"})
    assert r.status_code == 502 and "недоступно" in r.json()["detail"]
    assert c.post("/api/evaluations", json={"conversation_id": "nope"}).status_code == 404
    assert c.post("/api/evaluations", json={}).status_code == 400
    assert c.get("/api/evaluations/ev-999").status_code == 404
    assert c.post("/api/checklists/zzz/activate").status_code == 404
    assert c.post("/api/appeals/AP-1/resolve", json={"new_answer": "yes", "reason": "x"}).status_code == 404


def test_static_frontend_and_config(client):
    r = client.get("/config.local.js")
    assert r.status_code == 200 and "API_BASE" in r.text
    r = client.get("/")
    assert r.status_code == 200 and "config.local.js" in r.text and "js/app.js" in r.text
    assert client.get("/js/api.js").status_code == 200
    assert client.get("/api/health").json()["llm_provider"] == "mock"


def test_json_charset_utf8(client):
    assert client.get("/api/checklists").headers["content-type"] == "application/json; charset=utf-8"
    assert client.get("/api/evaluations/ev-1").headers["content-type"] == "application/json; charset=utf-8"


def test_cors_localhost(client):
    r = client.options("/api/conversations", headers={"Origin": "http://localhost:5500", "Access-Control-Request-Method": "GET"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5500"
    r = client.options("/api/conversations", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in r.headers
