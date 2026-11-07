"""Stable identities for the input and methodology used by an evaluation."""
from __future__ import annotations

import hashlib
import json


def digest(value) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def conversation_input(conv: dict) -> dict:
    return {key: conv.get(key) for key in ("conversation_id", "channel", "language", "transcript")}


def input_hash(conv: dict) -> str:
    return digest(conversation_input(conv))
