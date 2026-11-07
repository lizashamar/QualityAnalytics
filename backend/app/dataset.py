"""Atomic UTF-8 snapshots for the ingestion proxy, independent of SQLite."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .services import ApiError


def save_dataset(path: Path, data: dict) -> None:
    """Replace only after a complete write; a failed fetch keeps the previous snapshot."""
    temporary = None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=".dataset-", suffix=".tmp", delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except (OSError, ValueError):
        raise ApiError(500, "Не удалось сохранить dataset.json") from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def read_dataset(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ApiError(404, "Датасет не загружен. Вызовите /api/fetch-dataset") from None
    except (OSError, ValueError):
        raise ApiError(500, "Не удалось прочитать dataset.json") from None
    if not isinstance(data, dict) or not isinstance(data.get("records"), list):
        raise ApiError(500, "Некорректный формат dataset.json")
    return data
