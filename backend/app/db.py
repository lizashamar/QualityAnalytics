"""SQLite: схема, лёгкая миграция при старте, сид чек-листа, доступ к данным.

Все JSON хранятся как TEXT. Соединение открывается на операцию; запись — под общим lock
(батч оценок пишет из нескольких потоков). Транскрипт сохраняется как пришёл.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .provenance import input_hash

SEED_PATH = Path(__file__).with_name("seed_checklist.json")

SCHEMA = {
    "checklists": {
        "id": "TEXT PRIMARY KEY",
        "family_id": "TEXT",
        "name": "TEXT NOT NULL",
        "description": "TEXT DEFAULT ''",
        "version": "INTEGER NOT NULL",
        "is_active": "INTEGER NOT NULL DEFAULT 0",
        "created_at": "TEXT NOT NULL",
        "based_on": "TEXT",
        "criteria_json": "TEXT NOT NULL",
    },
    "conversations": {
        "conversation_id": "TEXT PRIMARY KEY",
        "channel": "TEXT",
        "language": "TEXT",
        "transcript_json": "TEXT NOT NULL",
        "audio_url": "TEXT",
        "dataset_group": "TEXT",
        "imported_at": "TEXT",
    },
    "evaluations": {
        "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
        "conversation_id": "TEXT NOT NULL",
        "checklist_id": "TEXT NOT NULL",
        "checklist_version": "INTEGER",
        "model": "TEXT",
        "created_at": "TEXT NOT NULL",
        "criteria_json": "TEXT NOT NULL",
        "items_json": "TEXT NOT NULL",
        "usage_json": "TEXT",
        "warnings_json": "TEXT",
        "archived": "INTEGER NOT NULL DEFAULT 0",
        "status": "TEXT NOT NULL DEFAULT 'ok'",
        "error": "TEXT",
        "stale": "INTEGER NOT NULL DEFAULT 0",
        "provenance_json": "TEXT",
    },
    "appeals": {
        "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
        "evaluation_id": "INTEGER NOT NULL",
        "conversation_id": "TEXT NOT NULL",
        "criterion_id": "TEXT NOT NULL",
        "comment": "TEXT NOT NULL",
        "original_answer": "TEXT",
        "status": "TEXT NOT NULL",
        "created_at": "TEXT NOT NULL",
        "decision_json": "TEXT",
    },
}
INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_eval_conv ON evaluations(conversation_id, archived)",
    "CREATE INDEX IF NOT EXISTS ix_appeal_eval ON appeals(evaluation_id, status)",
    "CREATE INDEX IF NOT EXISTS ix_conv_group ON conversations(dataset_group)",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def dumps(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False)


def loads(s: str | None, default: Any = None) -> Any:
    return default if s in (None, "") else json.loads(s)


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        self.write_lock = threading.RLock()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def conn(self) -> Iterator[sqlite3.Connection]:
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        try:
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

    @contextmanager
    def tx(self) -> Iterator[sqlite3.Connection]:
        """Транзакция записи (сериализована между потоками)."""
        with self.write_lock, self.conn() as c:
            yield c

    def migrate(self) -> None:
        with self.tx() as c:
            c.execute("PRAGMA journal_mode = WAL")
            for table, cols in SCHEMA.items():
                c.execute(f"CREATE TABLE IF NOT EXISTS {table} ({', '.join(f'{k} {v}' for k, v in cols.items())})")
                have = {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}
                for k, v in cols.items():
                    if k not in have:  # добавочная миграция старых баз
                        c.execute(f"ALTER TABLE {table} ADD COLUMN {k} {v.replace('PRIMARY KEY', '').replace('AUTOINCREMENT', '')}")
            for ix in INDEXES:
                c.execute(ix)
            if c.execute("SELECT COUNT(*) FROM checklists").fetchone()[0] == 0:
                seed = json.loads(SEED_PATH.read_text(encoding="utf-8"))
                c.execute(
                    "INSERT INTO checklists (id, family_id, name, description, version, is_active, created_at, criteria_json)"
                    " VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
                    (seed["id"], seed["family_id"], seed["name"], seed.get("description", ""), seed["version"],
                     seed.get("created_at") or now_iso(), dumps(seed["criteria"])),
                )

    @staticmethod
    def _checklist(r: sqlite3.Row) -> dict:
        return {
            "id": r["id"], "family_id": r["family_id"], "name": r["name"], "description": r["description"] or "",
            "version": r["version"], "active": bool(r["is_active"]), "created_at": r["created_at"],
            "based_on": r["based_on"], "criteria": loads(r["criteria_json"], []),
        }

    def list_checklists(self) -> list[dict]:
        with self.conn() as c:
            return [self._checklist(r) for r in c.execute("SELECT * FROM checklists ORDER BY family_id, version")]

    def get_checklist(self, cid: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM checklists WHERE id = ?", (cid,)).fetchone()
            return self._checklist(r) if r else None

    def active_checklist(self) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM checklists WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1").fetchone()
            return self._checklist(r) if r else None

    def create_checklist_version(self, *, name: str, description: str, criteria: list[dict], family_id: str | None,
                                 based_on: str | None, activate: bool) -> dict:
        with self.tx() as c:
            if not family_id and based_on:
                r = c.execute("SELECT family_id FROM checklists WHERE id = ?", (based_on,)).fetchone()
                family_id = r["family_id"] if r else None
            if not family_id:  # тот же чек-лист по имени — новая версия, иначе новое семейство
                r = c.execute("SELECT family_id FROM checklists WHERE name = ? ORDER BY version DESC LIMIT 1", (name,)).fetchone()
                family_id = r["family_id"] if r else "cl-" + datetime.now().strftime("%Y%m%d%H%M%S%f")
            version = (c.execute("SELECT MAX(version) FROM checklists WHERE family_id = ?", (family_id,)).fetchone()[0] or 0) + 1
            cid = f"{family_id}-v{version}"
            if activate:
                c.execute("UPDATE checklists SET is_active = 0")
            c.execute(
                "INSERT INTO checklists (id, family_id, name, description, version, is_active, created_at, based_on, criteria_json)"
                " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (cid, family_id, name, description, version, 1 if activate else 0, now_iso(), based_on, dumps(criteria)),
            )
        return self.get_checklist(cid)

    def activate_checklist(self, cid: str) -> dict | None:
        with self.tx() as c:
            if not c.execute("SELECT 1 FROM checklists WHERE id = ?", (cid,)).fetchone():
                return None
            c.execute("UPDATE checklists SET is_active = CASE WHEN id = ? THEN 1 ELSE 0 END", (cid,))
        return self.get_checklist(cid)

    @staticmethod
    def _conversation(r: sqlite3.Row) -> dict:
        return {
            "conversation_id": r["conversation_id"], "channel": r["channel"], "language": r["language"],
            "transcript": loads(r["transcript_json"], []), "audio_url": r["audio_url"],
            "dataset_group": r["dataset_group"], "imported_at": r["imported_at"],
        }

    def list_conversations(self, group_id: str | None = None) -> list[dict]:
        q, args = "SELECT * FROM conversations", ()
        if group_id:
            q, args = q + " WHERE dataset_group = ?", (group_id,)
        with self.conn() as c:
            return [self._conversation(r) for r in c.execute(q + " ORDER BY conversation_id", args)]

    def get_conversation(self, conv_id: str) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM conversations WHERE conversation_id = ?", (conv_id,)).fetchone()
            return self._conversation(r) if r else None

    def upsert_conversations(self, records: list[dict], group_id: str) -> int:
        ts = now_iso()
        with self.tx() as c:
            for rec in records:
                previous = c.execute("SELECT * FROM conversations WHERE conversation_id = ?", (rec["conversation_id"],)).fetchone()
                if previous and input_hash(self._conversation(previous)) != input_hash(rec):
                    c.execute("UPDATE evaluations SET stale = 1 WHERE conversation_id = ?", (rec["conversation_id"],))
                    c.execute("UPDATE appeals SET status = 'outdated' WHERE conversation_id = ? AND status = 'open'", (rec["conversation_id"],))
                c.execute(
                    "INSERT INTO conversations (conversation_id, channel, language, transcript_json, audio_url, dataset_group, imported_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET channel=excluded.channel,"
                    " language=excluded.language, transcript_json=excluded.transcript_json, audio_url=excluded.audio_url,"
                    " dataset_group=excluded.dataset_group, imported_at=excluded.imported_at",
                    (rec["conversation_id"], rec.get("channel"), rec.get("language"), dumps(rec.get("transcript") or []),
                     rec.get("audio_url"), group_id, ts),
                )
        return len(records)

    @staticmethod
    def _evaluation(r: sqlite3.Row) -> dict:
        return {
            "id": r["id"], "conversation_id": r["conversation_id"], "checklist_id": r["checklist_id"],
            "checklist_version": r["checklist_version"], "model": r["model"], "created_at": r["created_at"],
            "criteria": loads(r["criteria_json"], []), "items": loads(r["items_json"], []),
            "usage": loads(r["usage_json"], {}), "warnings": loads(r["warnings_json"], []), "archived": bool(r["archived"]),
            "status": r["status"], "error": r["error"], "stale": bool(r["stale"]),
            "provenance": loads(r["provenance_json"], {}),
        }

    def insert_evaluation(self, ev: dict) -> tuple[int, int]:
        """Сохраняет новую оценку, архивирует прежние по диалогу, открытые апелляции -> outdated.
        Возвращает (id оценки, число устаревших апелляций)."""
        with self.tx() as c:
            current = c.execute("SELECT * FROM conversations WHERE conversation_id = ?", (ev["conversation_id"],)).fetchone()
            provenance = ev.get("provenance") or {}
            stale = bool(current and provenance.get("input_hash") and input_hash(self._conversation(current)) != provenance["input_hash"])
            c.execute("UPDATE evaluations SET archived = 1 WHERE conversation_id = ? AND archived = 0", (ev["conversation_id"],))
            n = c.execute("UPDATE appeals SET status = 'outdated' WHERE conversation_id = ? AND status = 'open'",
                          (ev["conversation_id"],)).rowcount
            cur = c.execute(
                "INSERT INTO evaluations (conversation_id, checklist_id, checklist_version, model, created_at, criteria_json,"
                " items_json, usage_json, warnings_json, status, error, stale, provenance_json, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
                (ev["conversation_id"], ev["checklist_id"], ev["checklist_version"], ev["model"], now_iso(),
                 dumps(ev["criteria"]), dumps(ev["items"]), dumps(ev["usage"]), dumps(ev["warnings"]),
                 ev.get("status", "ok"), ev.get("error"), int(stale), dumps(provenance)),
            )
            return cur.lastrowid, n

    def get_evaluation(self, eid: int) -> dict | None:
        with self.conn() as c:
            r = c.execute("SELECT * FROM evaluations WHERE id = ?", (eid,)).fetchone()
            return self._evaluation(r) if r else None

    def latest_evaluation(self, conv_id: str, checklist_id: str | None = None) -> dict | None:
        q, args = "SELECT * FROM evaluations WHERE conversation_id = ?", [conv_id]
        if checklist_id:
            q += " AND checklist_id = ?"
            args.append(checklist_id)
        with self.conn() as c:
            r = c.execute(q + " ORDER BY id DESC LIMIT 1", args).fetchone()
            return self._evaluation(r) if r else None

    def list_latest_evaluations(self, group_id: str | None = None) -> list[dict]:
        q = "SELECT e.* FROM evaluations e"
        args: tuple = ()
        if group_id:
            q += " JOIN conversations c ON c.conversation_id = e.conversation_id AND c.dataset_group = ?"
            args = (group_id,)
        with self.conn() as c:
            return [self._evaluation(r) for r in c.execute(q + " WHERE e.archived = 0 ORDER BY e.id", args)]

    def latest_evaluations_by_checklist(self, checklist_id: str) -> dict[str, dict]:
        """conversation_id -> последняя оценка по этой версии чек-листа (включая архивные)."""
        q = ("SELECT e.* FROM evaluations e JOIN (SELECT conversation_id, MAX(id) AS mid FROM evaluations"
             " WHERE checklist_id = ? GROUP BY conversation_id) m ON e.id = m.mid")
        with self.conn() as c:
            return {r["conversation_id"]: self._evaluation(r) for r in c.execute(q, (checklist_id,))}

    def latest_evaluations_per_version(self, group_id: str | None = None) -> list[dict]:
        """По каждому диалогу — последняя оценка по каждой версии чек-листа, в порядке версий."""
        q = ("SELECT e.* FROM evaluations e JOIN (SELECT conversation_id, checklist_id, MAX(id) AS mid FROM evaluations"
             " GROUP BY conversation_id, checklist_id) m ON e.id = m.mid")
        args: tuple = ()
        if group_id:
            q += " JOIN conversations c ON c.conversation_id = e.conversation_id AND c.dataset_group = ?"
            args = (group_id,)
        with self.conn() as c:
            return [self._evaluation(r) for r in c.execute(q + " ORDER BY e.conversation_id, e.checklist_version, e.id", args)]

    def average_evaluation_cost(self) -> float | None:
        """Средняя стоимость одной оценки по сохранённым usage.cost_usd (None — цены не заданы)."""
        with self.conn() as c:
            r = c.execute("SELECT AVG(json_extract(usage_json, '$.cost_usd')) FROM evaluations"
                          " WHERE json_extract(usage_json, '$.cost_usd') IS NOT NULL").fetchone()
            return round(r[0], 6) if r and r[0] is not None else None

    def update_evaluation_items(self, c: sqlite3.Connection, eid: int, items: list[dict]) -> None:
        c.execute("UPDATE evaluations SET items_json = ? WHERE id = ?", (dumps(items), eid))

    @staticmethod
    def _appeal(r: sqlite3.Row) -> dict:
        return {
            "id": r["id"], "evaluation_id": r["evaluation_id"], "conversation_id": r["conversation_id"],
            "criterion_id": r["criterion_id"], "comment": r["comment"], "original_answer": loads(r["original_answer"]),
            "status": r["status"], "created_at": r["created_at"], "decision": loads(r["decision_json"]),
            "checklist_id": r["checklist_id"] if "checklist_id" in r.keys() else None,
        }

    _APPEAL_Q = "SELECT a.*, e.checklist_id AS checklist_id FROM appeals a LEFT JOIN evaluations e ON e.id = a.evaluation_id"

    def list_appeals(self) -> list[dict]:
        with self.conn() as c:
            return [self._appeal(r) for r in c.execute(self._APPEAL_Q + " ORDER BY a.id")]

    def get_appeal(self, aid: int, c: sqlite3.Connection | None = None) -> dict | None:
        if c is not None:
            r = c.execute(self._APPEAL_Q + " WHERE a.id = ?", (aid,)).fetchone()
            return self._appeal(r) if r else None
        with self.conn() as cc:
            return self.get_appeal(aid, cc)
