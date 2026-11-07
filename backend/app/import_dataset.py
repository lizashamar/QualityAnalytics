"""CLI: импорт записей организаторов в БД (без запущенного сервера).

  python -m app.import_dataset DEV                         — через ORGANIZER_API_URL
  python -m app.import_dataset DEV --file ..\\docs\\dev.json — из сохранённого ответа API (запасной вариант)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys

from .config import load_settings
from .db import Database
from .organizers import OrganizerError, parse_response
from .services import import_dataset


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Импорт датасета организаторов по group_id")
    p.add_argument("group_id", help="например DEV")
    p.add_argument("--file", help="JSON-файл с ответом API организаторов вместо сетевого запроса")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    s = load_settings()
    db = Database(s.db_file)
    db.migrate()
    try:
        if a.file:
            with open(a.file, encoding="utf-8-sig") as f:
                data = parse_response(json.load(f), a.group_id)
            n = db.upsert_conversations(data["records"], a.group_id)
            r = {"group_id": a.group_id, "imported": n, "total": data["total_records"], "skipped": data["skipped"]}
        else:
            r = import_dataset(db, s, a.group_id)
    except (OrganizerError, OSError, ValueError) as e:
        print(f"Ошибка: {e}", file=sys.stderr)
        return 2
    print(f"Импортировано {r['imported']} из {r['total']} (пропущено некорректных: {r['skipped']}), группа {r['group_id']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
