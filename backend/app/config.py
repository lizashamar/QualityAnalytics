"""Настройки из окружения и backend/.env (простой парсер, без зависимостей). Секреты не логируются."""
from __future__ import annotations

import os
from dataclasses import dataclass, field, replace
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_DIR = BACKEND_DIR.parent / "frontend"


def _load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k.strip()] = v
    return out


def _float(v: str | None) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except ValueError:
        return None


@dataclass(frozen=True)
class Settings:
    llm_provider: str = "mock"
    llm_model: str = ""
    llm_api_key: str = field(default="", repr=False)
    llm_base_url: str = ""
    llm_effort: str = "medium"
    llm_fallbacks: bool = True
    llm_max_tokens: int = 16000
    price_in_per_mtok: float | None = None
    price_out_per_mtok: float | None = None
    organizer_api_url: str = ""
    eval_concurrency: int = 4
    dataset_path: str = "dataset.json"
    db_path: str = "cqa.db"
    frontend_dir: str = str(FRONTEND_DIR)

    @property
    def dataset_file(self) -> Path:
        p = Path(self.dataset_path)
        return p if p.is_absolute() else BACKEND_DIR / p

    @property
    def db_file(self) -> Path:
        p = Path(self.db_path)
        return p if p.is_absolute() else BACKEND_DIR / p

    def with_(self, **kw) -> "Settings":
        return replace(self, **kw)


DEFAULT_MODELS = {"anthropic": "claude-opus-5-5", "openai": "gpt-4o-mini", "mock": "mock-heuristic-v1"}


def load_settings() -> Settings:
    env = {**_load_dotenv(BACKEND_DIR / ".env"), **os.environ}
    provider = (env.get("LLM_PROVIDER") or "mock").strip().lower()
    return Settings(
        llm_provider=provider,
        llm_model=(env.get("LLM_MODEL") or DEFAULT_MODELS.get(provider, "")).strip(),
        llm_api_key=(env.get("LLM_API_KEY") or "").strip(),
        llm_base_url=(env.get("LLM_BASE_URL") or "").strip(),
        llm_effort=(env.get("LLM_EFFORT") or "medium").strip(),
        llm_fallbacks=(env.get("LLM_FALLBACKS") or "1").strip().lower() not in ("0", "false", "no", "off"),
        llm_max_tokens=int(env.get("LLM_MAX_TOKENS") or 16000),
        price_in_per_mtok=_float(env.get("PRICE_IN_PER_MTOK")),
        price_out_per_mtok=_float(env.get("PRICE_OUT_PER_MTOK")),
        organizer_api_url=(env.get("ORGANIZER_API_URL") or "").strip(),
        eval_concurrency=max(1, int(env.get("EVAL_CONCURRENCY") or 4)),
        dataset_path=(env.get("DATASET_PATH") or "dataset.json").strip(),
        db_path=(env.get("DB_PATH") or "cqa.db").strip(),
    )
