"""Strict structured-output contract; criterion semantics are validated by evaluator.py."""
EVALUATION_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "criterion_id": {"type": "string"},
                    "answer": {"anyOf": [{"type": "string", "enum": ["yes", "no", "na"]}, {"type": "number"}]},
                    "evidence": {"type": "array", "items": {
                        "type": "object", "additionalProperties": False,
                        "properties": {"index": {"type": "integer"}, "quote": {"type": "string"}},
                        "required": ["index", "quote"],
                    }},
                    "checked_range": {"anyOf": [{"type": "array", "items": {"type": "integer"},
                                                    "minItems": 2, "maxItems": 2}, {"type": "null"}]},
                    "na_reason": {"type": ["string", "null"]},
                    "explanation": {"type": "string"},
                },
                "required": ["criterion_id", "answer", "evidence", "checked_range", "na_reason", "explanation"],
            },
        },
    },
    "required": ["items"],
}
