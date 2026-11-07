"""Валидация ответа модели, повтор, слияние, учёт usage."""
import json

from app.evaluator import evaluate, validate_output
from app.llm.base import LLMClient, extract_json
from app.llm.mock import MockClient

CONV = {
    "conversation_id": "t-1", "channel": "agent chat", "language": "RU",
    "transcript": [
        {"timestamp": "00:01", "speaker": "client", "text": "Здравствуйте, какая комиссия по тарифу «Стандарт»?"},
        {"timestamp": "00:20", "speaker": "operator", "text": "Здравствуйте! Меня зовут Алия, служба поддержки. Комиссия 0,1% от суммы."},
        {"timestamp": "00:40", "speaker": "client", "text": "Спасибо!"},
        {"timestamp": "00:50", "speaker": "operator", "text": "Обращайтесь, всего доброго!"},
    ],
}


def good_items(criteria):
    out = []
    for c in criteria:
        if c["is_flag"]:
            out.append({"criterion_id": c["id"], "answer": "no", "evidence": [], "checked_range": [0, 3], "na_reason": None, "explanation": "ok"})
        elif c["id"] == "c3":
            out.append({"criterion_id": c["id"], "answer": "na", "evidence": [], "checked_range": None,
                        "na_reason": "Общий вопрос о тарифах не требует идентификации.", "explanation": "ok"})
        else:
            ans = max(c["scale_steps"]) if c["type"] == "scale" else "yes"
            out.append({"criterion_id": c["id"], "answer": ans, "evidence": [{"index": 1, "quote": "меня зовут алия"}],
                        "checked_range": None, "na_reason": None, "explanation": "ok"})
    return out


class Scripted(LLMClient):
    provider = "scripted"

    def __init__(self, replies):
        super().__init__("scripted-1")
        self.replies, self.prompts = list(replies), []

    def complete(self, system, user):
        self.prompts.append(user)
        r = self.replies.pop(0)
        return (r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)), {"input_tokens": 1000, "output_tokens": 200}


def test_valid_output_passes(seed_criteria):
    items, errs, general = validate_output({"items": good_items(seed_criteria)}, seed_criteria, CONV["transcript"])
    assert not errs and not general and len(items) == 8


def test_bad_index(seed_criteria):
    it = good_items(seed_criteria)
    it[0]["evidence"] = [{"index": 99, "quote": "x"}]
    _, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("вне диапазона" in m for m in errs["c1"])


def test_invented_quote(seed_criteria):
    it = good_items(seed_criteria)
    it[0]["evidence"] = [{"index": 1, "quote": "Я оператор Марат, рад помочь"}]
    items, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("цитата не найдена" in m for m in errs["c1"])
    assert items["c1"]["evidence"] == []


def test_quote_ignores_case_space_punct(seed_criteria):
    it = good_items(seed_criteria)
    it[0]["evidence"] = [{"index": 1, "quote": "ЗДРАВСТВУЙТЕ  меня-зовут, Алия"}]
    _, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert "c1" not in errs


def test_extra_and_missing_criterion(seed_criteria):
    it = good_items(seed_criteria)[1:] + [{"criterion_id": "c99", "answer": "yes", "evidence": [], "explanation": ""}]
    _, errs, general = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("Лишний критерий «c99»" in m for m in general)
    assert any("нет ответа" in m for m in errs["c1"])


def test_na_not_allowed_and_na_without_reason(seed_criteria):
    it = good_items(seed_criteria)
    it[0].update(answer="na", na_reason="так")       # c1: N/A запрещён
    it[2].update(na_reason="")                         # c3: N/A без причины
    items, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("N/A не разрешён" in m for m in errs["c1"])
    assert any("na_reason" in m for m in errs["c3"])
    assert items["c1"]["answer"] is None


def test_scale_value_and_normalization(seed_criteria):
    it = good_items(seed_criteria)
    it[3]["answer"] = 12          # c4: нет такой ступени
    it[5]["answer"] = "7"         # c6: строка-число приводится
    it[0]["answer"] = "Yes"
    items, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("scale_steps" in m for m in errs["c4"])
    assert items["c6"]["answer"] == 7 and "c6" not in errs
    assert items["c1"]["answer"] == "yes"


def test_answer_needs_evidence_or_range(seed_criteria):
    it = good_items(seed_criteria)
    it[0]["evidence"] = []
    _, errs, _ = validate_output({"items": it}, seed_criteria, CONV["transcript"])
    assert any("evidence" in m for m in errs["c1"])


def test_retry_fixes_and_usage_summed(seed_criteria):
    bad = good_items(seed_criteria)
    bad[0]["evidence"] = [{"index": 1, "quote": "выдумка"}]
    llm = Scripted([{"items": bad}, {"items": good_items(seed_criteria)}])
    r = evaluate(llm, CONV, seed_criteria, price_in=4, price_out=20)
    assert r["warnings"] == []
    assert r["usage"]["calls"] == 2 and r["usage"]["retried"]
    assert r["usage"]["input_tokens"] == 2000 and r["usage"]["output_tokens"] == 400
    assert r["usage"]["cost_usd"] == round(2000 / 1e6 * 4 + 400 / 1e6 * 20, 6)
    assert "цитата не найдена" in llm.prompts[1]  # повтор содержит конкретные ошибки


def test_second_failure_keeps_valid_and_warns(seed_criteria):
    bad = good_items(seed_criteria)
    bad[0]["evidence"] = [{"index": 1, "quote": "выдумка"}, {"index": 3, "quote": "всего доброго"}]
    bad[3]["answer"] = 13
    llm = Scripted(["это не json", {"items": bad}])
    r = evaluate(llm, CONV, seed_criteria)
    items = {i["criterion_id"]: i for i in r["items"]}
    assert items["c1"]["evidence"] == [3]               # невалидная цитата убрана, валидная осталась
    assert items["c4"]["answer"] is None                # недопустимая ступень не сохранена
    assert any("c4" in w for w in r["warnings"]) and any("c1" in w for w in r["warnings"])
    assert len(r["items"]) == 8 and r["usage"]["calls"] == 2


def test_merge_prefers_valid_from_first_attempt(seed_criteria):
    first = good_items(seed_criteria)
    first[0]["answer"] = "maybe"
    second = good_items(seed_criteria)
    second[1]["answer"] = "maybe"   # во втором ответе сломан другой критерий
    r = evaluate(Scripted([{"items": first}, {"items": second}]), CONV, seed_criteria)
    items = {i["criterion_id"]: i for i in r["items"]}
    assert items["c1"]["answer"] == "yes" and items["c2"]["answer"] == "yes"


def test_fences_stripped():
    assert extract_json('```json\n{"items": []}\n```') == {"items": []}
    assert extract_json('Вот ответ: {"items": []} — готово') == {"items": []}


def test_mock_passes_validation_on_any_checklist(seed_criteria):
    crit = seed_criteria + [{"id": "k1", "section": "Новая", "title": "Предложение следующего шага", "question": "?",
                             "type": "scale", "weight": 10, "allow_na": False, "na_condition": "",
                             "scale_steps": [3, 1, 0], "scale_labels": {}, "is_flag": False}]
    r = evaluate(MockClient(), CONV, crit)
    assert r["warnings"] == [], r["warnings"]
    assert r["usage"]["calls"] == 1
    assert [i["criterion_id"] for i in r["items"]] == [c["id"] for c in crit]
