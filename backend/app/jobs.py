"""Фоновые батчи оценки: ограничение параллелизма, одна ошибка не валит остальные. Состояние — в памяти процесса."""
from __future__ import annotations

import logging
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

log = logging.getLogger("cqa.jobs")


class JobManager:
    def __init__(self):
        self._jobs: dict[str, dict] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            j = self._jobs.get(job_id)
            return {**j, "errors": list(j["errors"])} if j else None

    def start(self, conversation_ids: list[str], work: Callable[[str], dict], concurrency: int) -> str:
        job_id = uuid.uuid4().hex[:12]
        job = {"job_id": job_id, "status": "running", "total": len(conversation_ids), "done": 0, "failed": 0,
               "errors": [], "cost_usd": 0.0, "input_tokens": 0, "output_tokens": 0, "evaluation_ids": []}
        with self._lock:
            self._jobs[job_id] = job

        def one(cid: str):
            try:
                ev = work(cid)
                with self._lock:
                    job["done"] += 1
                    u = ev.get("usage") or {}
                    job["cost_usd"] = round(job["cost_usd"] + (u.get("cost_usd") or 0), 6)
                    job["input_tokens"] += u.get("input_tokens") or 0
                    job["output_tokens"] += u.get("output_tokens") or 0
                    job["evaluation_ids"].append(ev["id"])
            except Exception as e:  # noqa: BLE001 — одна ошибка не валит батч
                msg = getattr(e, "message", None) or str(e) or type(e).__name__
                log.warning("job %s conv=%s failed: %s", job_id, cid, msg)
                with self._lock:
                    job["failed"] += 1
                    job["errors"].append({"conversation_id": cid, "error": msg})

        def run():
            with ThreadPoolExecutor(max_workers=max(1, concurrency)) as pool:
                list(pool.map(one, conversation_ids))
            with self._lock:
                job["status"] = "finished"
            log.info("job %s finished: done=%d failed=%d cost=%s", job_id, job["done"], job["failed"], job["cost_usd"])

        threading.Thread(target=run, name=f"job-{job_id}", daemon=True).start()
        return job_id
