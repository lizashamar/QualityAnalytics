"""Сравнение версий чек-листа: diff критериев, итоги «было → стало», апелляции, выборочная переоценка."""
import copy
import time

import pytest
from fastapi.testclient import TestClient

from app.compare import diff_criteria
from app.config import load_settings
from app.main import create_app
from app.scoring import calculate, round2
from tests.test_api import RECORDS

CONVS = [r for r in RECORDS if r.get("conversation_id")][:3]


@pytest.fixture
def client(tmp_path):
    s = load_settings().with_(db_path=str(tmp_path / "cmp.db"))
    app = create_app(s)
    app.state.db.upsert_conversations(CONVS, "DEV")
    with TestClient(app) as c:
        c.db = app.state.db
        yield c


def v1(client):
    return next(c for c in client.get("/api/checklists").json() if c["version"] == 1)


def save_v2(client, base, mutate):
    crit = copy.deepcopy(base["criteria"])
    mutate(crit)
    r = client.post("/api/checklists", json={"name": base["name"], "family_id": base["family_id"], "based_on": base["id"], "criteria": crit})
    assert r.status_code == 200, r.text
    return r.json()


def reweight(crit):
    by = {c["id"]: c for c in crit}
    by["c1"]["weight"] = 15   # 10 -> 15
    by["c4"]["weight"] = 15   # 20 -> 15, сумма остаётся 100


def evaluate(client, cid, checklist_id):
    r = client.post("/api/evaluations", json={"conversation_id": cid, "checklist_id": checklist_id})
    assert r.status_code == 200, r.text
    return r.json()


# ---------- diff критериев ----------
def test_diff_criteria(seed_criteria):
    a = copy.deepcopy(seed_criteria)
    b = copy.deepcopy(seed_criteria)
    by = {c["id"]: c for c in b}
    by["c1"]["weight"] = 15
    by["c2"]["allow_na"] = False
    by["c2"]["na_condition"] = ""
    by["c4"]["scale_steps"] = [20.0, 10.0, 0.0]          # шкала изменилась
    by["c6"]["scale_steps"] = [0, 4, 7, 10]               # тот же набор ступеней, другой порядок — не изменение
    by["c5"]["title"] = "Эмпатия"
    by["c5"]["question"] = "Новая формулировка"
    by["c3"]["section"] = "Безопасность"
    b = [c for c in b if c["id"] != "c7"] + [{"id": "k9", "section": "Новое", "title": "Новый критерий", "question": "?",
                                              "type": "yesno", "weight": 5, "allow_na": False, "na_condition": "",
                                              "scale_steps": [], "scale_labels": {}, "is_flag": False}]
    d = diff_criteria(a, b)
    assert [x["criterion_id"] for x in d["added"]] == ["k9"]
    assert [x["criterion_id"] for x in d["removed"]] == ["c7"]
    ch = {x["criterion_id"]: {f["field"]: (f["from"], f["to"]) for f in x["changes"]} for x in d["changed"]}
    assert ch["c1"] == {"weight": (10, 15)}
    assert ch["c2"]["allow_na"] == (True, False) and "na_condition" in ch["c2"]
    assert ch["c4"]["scale_steps"] == ([20, 15, 10, 5, 0], [20, 10, 0])
    assert "c6" not in ch
    assert set(ch["c5"]) == {"title", "question"}
    assert ch["c3"] == {"section": ("Безопасность и решение", "Безопасность")}
    assert d["unchanged"] == 7 - len(ch)
    assert diff_criteria(a, copy.deepcopy(a)) == {"added": [], "removed": [], "changed": [], "unchanged": 8}


# ---------- сравнение версий на 3 диалогах ----------
def test_compare_two_versions(client):
    base = v1(client)
    ev1 = {c["conversation_id"]: evaluate(client, c["conversation_id"], base["id"]) for c in CONVS}
    two = save_v2(client, base, reweight)
    assert two["version"] == 2 and two["active"]
    ids = [c["conversation_id"] for c in CONVS]
    ev2 = {cid: evaluate(client, cid, two["id"]) for cid in ids[:2]}  # третий по v2 не оценён

    r = client.get("/api/checklists/compare", params={"from": base["id"], "to": two["id"]})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["from"]["version"] == 1 and data["to"]["version"] == 2
    changed = {x["criterion_id"]: x for x in data["diff"]["changed"]}
    assert set(changed) == {"c1", "c4"} and not data["diff"]["added"] and not data["diff"]["removed"]

    s = data["summary"]
    assert s["compared"] == 2 and s["not_evaluated_in_to"] == 1 and s["evaluated_in_from"] == 3
    assert {r["conversation_id"] for r in data["rows"]} == set(ids[:2])
    for row in data["rows"]:
        cid = row["conversation_id"]
        # итоги — тем же scoring по снимкам критериев каждой оценки
        assert row["total_from"] == ev1[cid]["total"]
        assert row["total_to"] == ev2[cid]["total"]
        assert row["total_to"] == calculate(ev2[cid]["criteria"], {i["criterion_id"]: i["answer"] for i in ev2[cid]["items"]})["total"]
        if row["total_from"] is not None and row["total_to"] is not None:
            assert row["delta"] == round2(row["total_to"] - row["total_from"])
        assert row["gross_from"] == ev1[cid]["gross_flag"] and row["gross_to"] == ev2[cid]["gross_flag"]
        # mock детерминирован: ответы те же, меняются баллы взвешенных критериев
        assert row["changed_criteria"] == []
        assert row["final_total_from"] is None and row["final_total_to"] is None
    pts = {p["criterion_id"] for row in data["rows"] for p in row["points_changed"]}
    assert pts and pts <= {"c1", "c2", "c3", "c4", "c5", "c6", "c7"}
    deltas = [r["delta"] for r in data["rows"]]
    assert s["avg_delta"] == round2(sum(deltas) / len(deltas))
    assert s["improved"] + s["declined"] + s["unchanged"] == 2
    assert s["reevaluation_cost_usd"] is not None and s["reevaluation_cost_usd"] > 0  # цены заданы в conftest

    # ответ изменился: другая версия критерия (c4 стал Да/Нет) -> попадает в changed_criteria
    three = save_v2(client, two, lambda crit: next(c for c in crit if c["id"] == "c4").update(type="yesno", scale_steps=[], scale_labels={}))
    evaluate(client, ids[0], three["id"])
    d3 = client.get("/api/checklists/compare", params={"from": two["id"], "to": three["id"]}).json()
    row = d3["rows"][0]
    assert any(c["criterion_id"] == "c4" and c["answer_from"] != c["answer_to"] for c in row["changed_criteria"])
    assert any(x["criterion_id"] == "c4" and {f["field"] for f in x["changes"]} >= {"type", "scale_steps"} for x in d3["diff"]["changed"])


def test_conversation_without_second_version(client):
    base = v1(client)
    for c in CONVS:
        evaluate(client, c["conversation_id"], base["id"])
    two = save_v2(client, base, reweight)
    data = client.get("/api/checklists/compare", params={"from": base["id"], "to": two["id"]}).json()
    assert data["rows"] == [] and data["summary"]["compared"] == 0
    assert data["summary"]["not_evaluated_in_to"] == 3 and data["summary"]["avg_delta"] is None


def test_open_appeal_outdated_and_old_evaluation_kept(client):
    base = v1(client)
    cid = CONVS[0]["conversation_id"]
    old = evaluate(client, cid, base["id"])
    ap = client.post("/api/appeals", json={"conversation_id": cid, "criterion_id": "c5", "comment": "Не согласен"}).json()
    assert ap["status"] == "open"
    two = save_v2(client, base, reweight)
    new = evaluate(client, cid, two["id"])
    aps = {a["id"]: a for a in client.get("/api/appeals").json()}
    assert aps[ap["id"]]["status"] == "outdated"
    assert client.post(f"/api/appeals/{ap['id']}/resolve", json={"new_answer": "yes", "reason": "x"}).status_code == 409
    kept = client.get(f"/api/evaluations/{old['id']}").json()
    assert kept["archived"] is True and kept["checklist_id"] == base["id"] and kept["total"] == old["total"]
    row = client.get("/api/checklists/compare", params={"from": base["id"], "to": two["id"]}).json()["rows"][0]
    assert row["evaluation_from"] == old["id"] and row["evaluation_to"] == new["id"]

    # решение проверяющего по новой оценке -> final_total отдельным полем
    ap2 = client.post("/api/appeals", json={"conversation_id": cid, "criterion_id": "c4", "comment": "Шаг назван"}).json()
    res = client.post(f"/api/appeals/{ap2['id']}/resolve", json={"new_answer": 20, "reason": "полностью"}).json()
    row = client.get("/api/checklists/compare", params={"from": base["id"], "to": two["id"]}).json()["rows"][0]
    assert row["final_total_to"] == res["decision"]["final_total"] and row["total_to"] == new["total"]

    hist = [h for h in client.get("/api/evaluations/history").json() if h["conversation_id"] == cid]
    assert [h["checklist_version"] for h in hist] == [1, 2] and hist[0]["archived"] is True


def test_batch_selected_with_cost(client):
    base = v1(client)
    for c in CONVS:
        evaluate(client, c["conversation_id"], base["id"])
    two = save_v2(client, base, reweight)
    ids = [c["conversation_id"] for c in CONVS[:2]]
    r = client.post("/api/evaluations/batch", json={"conversation_ids": ids + ["nope"], "checklist_id": two["id"]}).json()
    assert r["total"] == 3 and r["checklist_id"] == two["id"] and r["checklist_version"] == 2
    assert r["unknown_conversations"] == ["nope"] and r["estimated_cost_usd"] > 0
    for _ in range(100):
        j = client.get(f"/api/jobs/{r['job_id']}").json()
        if j["status"] == "finished":
            break
        time.sleep(0.05)
    assert j["done"] == 2 and j["failed"] == 1 and j["cost_usd"] > 0
    s = client.get("/api/checklists/compare", params={"from": base["id"], "to": two["id"]}).json()["summary"]
    assert s["compared"] == 2 and s["not_evaluated_in_to"] == 1
    assert client.get("/api/evaluations/cost").json()["average_cost_usd"] > 0


def test_compare_errors(client):
    base = v1(client)
    assert client.get("/api/checklists/compare", params={"from": base["id"], "to": base["id"]}).status_code == 400
    assert client.get("/api/checklists/compare", params={"from": base["id"], "to": "nope"}).status_code == 404
    assert client.get("/api/checklists/compare", params={"from": base["id"]}).status_code == 400
