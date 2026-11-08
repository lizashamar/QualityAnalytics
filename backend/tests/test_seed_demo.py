"""Тесты python -m app.seed_demo: только временные БД и mock-провайдер, без сети и без изменения cqa.db / results/."""
from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from app import seed_demo
from app.config import BACKEND_DIR
from app.db import Database
from app.scoring import validate_checklist

RESULTS = BACKEND_DIR.parent / "results"

GOOD = [("client", "Здравствуйте, не могу войти в личный кабинет, ИИН 123456789012, пишу уже второй раз."),
        ("operator", "Здравствуйте! Меня зовут Анна. Уточните, пожалуйста, какую ошибку вы видите при входе?"),
        ("client", "Пишет, что пароль неверен."),
        ("operator", "Сожалею о неудобстве. Подтвердите кодовое слово, и я сброшу доступ. Ваш пароль сброшен, проверьте почту, "
                     "вход будет доступен через несколько минут после подтверждения."),
        ("client", "Спасибо, получилось."),
        ("operator", "Рада помочь! Обращайтесь, всего доброго.")]
MID = [("client", "Здравствуйте, не открывается приложение, уже второй день."),
       ("operator", "Здравствуйте! Меня зовут Олег. Перезапустите приложение и повторите вход, пожалуйста, подождите несколько минут "
                    "после перезапуска, настройки обновятся."),
       ("client", "Получилось, спасибо."),
       ("operator", "Хорошо.")]
BAD = [("client", "Почему списали комиссию? Это неудобно, объясните."),
       ("operator", "ок"),
       ("client", "И что дальше?"),
       ("operator", "ждите")]


SHAPES = {"p1-kz-003": MID, "p1-ru-025": MID, "p1-en-001": BAD, "p1-ru-023": BAD}  # остальные — GOOD


def _records(ids):
    out = []
    for cid in ids:
        rows = SHAPES.get(cid, GOOD)
        out.append({"conversation_id": cid, "channel": "agent chat", "language": "RU", "audio_url": None,
                    "transcript": [{"timestamp": f"00:{i * 10:02d}", "speaker": s, "text": t} for i, (s, t) in enumerate(rows)]})
    return out


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.setenv("LLM_MODEL", "")
    db_path = tmp_path / "demo.db"
    db = Database(db_path)
    db.migrate()
    db.upsert_conversations(_records(seed_demo.DEFAULT_DIALOGS), "DEV")
    return db, db_path


def _tree_hash(root: Path) -> str:
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(root).as_posix().encode() + p.read_bytes())
    return h.hexdigest()


def _file_hash(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def _raw_eval_count(db: Database) -> int:
    with db.conn() as c:
        return c.execute("SELECT COUNT(*) FROM evaluations").fetchone()[0]


def test_creates_v2_appeals_and_keeps_v1_active(env):
    db, path = env
    v1_before = db.get_checklist("cl-chat-quality-v1")
    assert seed_demo.main(["--db", str(path), "--add-criterion"]) == 0
    v1, v2 = db.get_checklist("cl-chat-quality-v1"), db.get_checklist("cl-chat-quality-v2")
    assert v1 == v1_before and v1["active"] and not v2["active"]
    assert db.active_checklist()["id"] == "cl-chat-quality-v1"
    assert validate_checklist(v2["criteria"]) == []
    w = {c["id"]: c["weight"] for c in v2["criteria"]}
    assert (w["c2"], w["c5"], w["c6"], w["c9"]) == (10, 20, 10, 5) and sum(w.values()) == 100
    status = sorted(a["status"] for a in db.list_appeals())
    assert status == ["open", "open", "outdated", "resolved", "resolved"]
    open_ = {(a["conversation_id"], a["criterion_id"]) for a in db.list_appeals() if a["status"] == "open"}
    assert open_ == {("p1-kz-002", "c7"), ("p1-ru-018", "c6")}
    resolved = [a for a in db.list_appeals() if a["status"] == "resolved"]
    changed = [a for a in resolved if a["decision"]["new_answer"] != a["decision"]["previous_answer"]]
    kept = [a for a in resolved if a["decision"]["new_answer"] == a["decision"]["previous_answer"]]
    assert len(changed) == 1 and len(kept) == 1
    assert changed[0]["decision"]["previous_total"] != changed[0]["decision"]["final_total"]
    assert all(a["decision"]["reason"] for a in resolved)
    # исходные AI-ответы не подменены: решение лежит в final_answer
    ev = db.get_evaluation(changed[0]["evaluation_id"])
    item = next(i for i in ev["items"] if i["criterion_id"] == changed[0]["criterion_id"])
    assert item["answer"] == changed[0]["decision"]["previous_answer"] and item["final_answer"] == changed[0]["decision"]["new_answer"]


def test_idempotent(env):
    db, path = env
    assert seed_demo.main(["--db", str(path), "--add-criterion"]) == 0
    before = (len(db.list_checklists()), [(a["id"], a["status"]) for a in db.list_appeals()], _raw_eval_count(db))
    assert seed_demo.main(["--db", str(path), "--add-criterion"]) == 0
    after = (len(db.list_checklists()), [(a["id"], a["status"]) for a in db.list_appeals()], _raw_eval_count(db))
    assert before == after and before[0] == 2 and len(before[1]) == 5


def test_dry_run_writes_nothing(env, capsys):
    db, path = env
    before = _file_hash(path)
    assert seed_demo.main(["--db", str(path), "--dry-run", "--add-criterion"]) == 0
    out = capsys.readouterr().out
    assert "вызовов модели" in out and "Ничего не записано" in out
    assert _file_hash(path) == before
    assert len(db.list_checklists()) == 1 and not db.list_appeals()


def test_dry_run_does_not_create_missing_db(tmp_path, monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    p = tmp_path / "none.db"
    assert seed_demo.main(["--db", str(p), "--dry-run"]) == 0
    assert not p.exists() and not list(tmp_path.iterdir())


def test_v2_not_activated_without_flag_and_activated_with_flag(env):
    db, path = env
    assert seed_demo.main(["--db", str(path), "--skip-evaluate"]) == 0
    assert not db.get_checklist("cl-chat-quality-v2")["active"]
    assert db.active_checklist()["id"] == "cl-chat-quality-v1"
    assert seed_demo.main(["--db", str(path), "--skip-evaluate", "--activate-v2"]) == 0
    assert db.active_checklist()["id"] == "cl-chat-quality-v2"


def test_results_dir_untouched(env):
    db, path = env
    before = _tree_hash(RESULTS)
    seed_demo.main(["--db", str(path), "--dry-run"])
    seed_demo.main(["--db", str(path)])
    seed_demo.main(["--db", str(path), "--activate-v2", "--appeals-only"])
    assert _tree_hash(RESULTS) == before


def test_demo_evaluations_stay_out_of_export(env):
    """Официальный экспорт берёт v1 и отвергает mock-оценки; v2 и апелляции на него не влияют."""
    from app.submission import build_submission
    db, path = env
    seed_demo.main(["--db", str(path)])
    with pytest.raises(ValueError):  # нет настоящей модели -> экспорт отказывает, а не включает демо
        build_submission(db, "DEV", "kudafest", "dev", "cl-chat-quality-v1")


def test_refuses_main_db_and_missing_dialogs(env, capsys):
    main_db = BACKEND_DIR / "cqa.db"
    before = _file_hash(main_db) if main_db.exists() else None
    assert seed_demo.main(["--db", str(main_db)]) == 2
    assert (_file_hash(main_db) if main_db.exists() else None) == before
    db, path = env
    assert seed_demo.main(["--db", str(path), "--dialogs", "nope-1,p1-en-001", "--skip-evaluate"]) == 0
    assert "nope-1" in capsys.readouterr().out
