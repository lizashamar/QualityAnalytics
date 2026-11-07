"""CLI: python -m app.evaluate_all [--group DEV] [--checklist ID] [--only-missing]
Оценивает диалоги активной (или указанной) версией чек-листа с параллелизмом EVAL_CONCURRENCY."""
from __future__ import annotations

import argparse
import logging
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from .config import load_settings
from .db import Database
from .llm import LLMError, make_client
from .services import ApiError, run_evaluation


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Пакетная оценка диалогов")
    p.add_argument("--group", help="только диалоги этой группы (dataset_group)")
    p.add_argument("--checklist", help="id версии чек-листа (по умолчанию активная)")
    p.add_argument("--only-missing", action="store_true", help="пропустить уже оценённые")
    a = p.parse_args(argv)
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    s = load_settings()
    db = Database(s.db_file)
    db.migrate()
    cl = db.get_checklist(a.checklist) if a.checklist else db.active_checklist()
    if not cl:
        print("Чек-лист не найден", file=sys.stderr)
        return 2
    ids = [c["conversation_id"] for c in db.list_conversations(a.group)]
    if a.only_missing:
        done = {e["conversation_id"] for e in db.list_latest_evaluations(a.group)}
        ids = [i for i in ids if i not in done]
    try:
        llm = make_client(s)
    except LLMError as e:
        print(f"Ошибка модели: {e}", file=sys.stderr)
        return 2
    print(f"Оцениваем {len(ids)} диалогов чек-листом {cl['id']} ({s.llm_provider}:{s.llm_model}), параллельно {s.eval_concurrency}")
    t0, ok, failed, cost, tin, tout = time.time(), 0, 0, 0.0, 0, 0
    with ThreadPoolExecutor(max_workers=s.eval_concurrency) as pool:
        futs = {pool.submit(run_evaluation, db, s, llm, cid, cl["id"]): cid for cid in ids}
        for f in as_completed(futs):
            cid = futs[f]
            try:
                ev = f.result()
                ok += 1
                u = ev["usage"]
                cost += u.get("cost_usd") or 0
                tin += u.get("input_tokens") or 0
                tout += u.get("output_tokens") or 0
                flag = " ⚠ грубое нарушение" if ev["gross_flag"] else ""
                warn = f" (предупреждений: {len(ev['warnings'])})" if ev["warnings"] else ""
                print(f"  ✓ {cid}: {ev['total']}{flag}{warn}")
            except (ApiError, LLMError, Exception) as e:  # noqa: BLE001
                failed += 1
                print(f"  ✕ {cid}: {getattr(e, 'message', None) or e}")
    dt = time.time() - t0
    print(f"Готово: {ok} успешно, {failed} с ошибкой, {dt:.1f} с; токены {tin}/{tout}"
          + (f"; стоимость ${cost:.4f} (≈ ${cost / ok:.4f} за оценку)" if ok and (s.price_in_per_mtok or s.price_out_per_mtok) else ""))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
