import json
from pathlib import Path

import pytest

from app.scoring import allowed_answers, calculate, round2, valid_answer, validate_checklist

ROOT = Path(__file__).resolve().parents[1]
SEED = json.loads((ROOT / "app" / "seed_checklist.json").read_text(encoding="utf-8"))["criteria"]
CASES = json.loads((ROOT / "tests" / "fixtures" / "scoring_cases.json").read_text(encoding="utf-8"))
BY = {c["id"]: c for c in SEED}


def test_seed_shape():
    assert [c["weight"] for c in SEED] == [10, 15, 20, 20, 15, 15, 5, 0]
    assert [c["id"] for c in SEED if c["allow_na"]] == ["c2", "c3", "c4", "c7"]
    assert validate_checklist(SEED) == []


@pytest.mark.parametrize("case", CASES["calculate"], ids=lambda c: c["name"])
def test_calculate_cases(case):
    crit = [c for c in SEED if c["id"] in case["only"]] if "only" in case else SEED
    r = calculate(crit, case["answers"])
    assert r["total"] == case["expect"]["total"]
    assert r["gross_flag"] is case["expect"]["gross_flag"]
    assert r["applicable_weight"] == case["expect"]["applicable_weight"]


@pytest.mark.parametrize("case", CASES["valid_answer"], ids=lambda c: f'{c["criterion_id"]}={c["answer"]!r}')
def test_valid_answer_cases(case):
    assert valid_answer(BY[case["criterion_id"]], case["answer"]) is case["valid"]


def test_sections():
    r = calculate(SEED, CASES["calculate"][0]["answers"])
    s1 = next(s for s in r["sections"] if s["section"] == "Начало и понимание запроса")
    assert s1["max"] == 15.38 and s1["percent"] == 100
    flag = next(s for s in r["sections"] if s["section"] == "Грубые нарушения")
    assert flag["max"] == 0 and flag["percent"] is None
    assert abs(sum(s["max"] for s in r["sections"]) - 100) < 0.05


def test_missing_marked():
    r = calculate(SEED, {"c1": "yes"})
    assert next(x for x in r["rows"] if x["criterion_id"] == "c3")["error"] == "missing"


def test_round_matches_js():
    # Значения получены в node: Math.round((x + Number.EPSILON) * 100) / 100
    js = {1.005: 1.01, 2.675: 2.68, 0.125: 0.13, 85.38461538461539: 85.38, 54.61538461538461: 54.62, 0.5: 0.5, 99.995: 100}
    for x, want in js.items():
        assert round2(x) == want, x


def test_allowed_answers():
    assert allowed_answers(BY["c4"]) == [20, 15, 10, 5, 0, "na"]
    assert allowed_answers(BY["c1"]) == ["yes", "no"]
    assert allowed_answers(BY["c8"]) == ["no", "yes"]


def test_bool_is_not_number():
    assert valid_answer(BY["c6"], True) is False
