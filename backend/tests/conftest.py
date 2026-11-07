import json
import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# До импорта app.main: тесты не трогают backend/cqa.db, не читают реальный ключ и не ходят в сеть.
_tmp = tempfile.mkdtemp(prefix="cqa-test-")
os.environ.update({"DB_PATH": os.path.join(_tmp, "import.db"), "LLM_PROVIDER": "mock", "LLM_MODEL": "",
                   "LLM_API_KEY": "", "ORGANIZER_API_URL": "https://organizers.example/api/dataset",
                   "PRICE_IN_PER_MTOK": "4", "PRICE_OUT_PER_MTOK": "20", "EVAL_CONCURRENCY": "3"})

SEED = json.loads((ROOT / "app" / "seed_checklist.json").read_text(encoding="utf-8"))


@pytest.fixture
def seed_criteria():
    return json.loads(json.dumps(SEED["criteria"]))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    import httpx

    def blocked(*a, **k):
        raise AssertionError("Тест попытался выйти в сеть")

    monkeypatch.setattr(httpx, "get", blocked)
    monkeypatch.setattr(httpx, "post", blocked)
