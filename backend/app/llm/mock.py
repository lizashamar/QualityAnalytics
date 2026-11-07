"""Детерминированный mock-провайдер без сети (тесты, демо без ключа).

Разбирает тот же user-промпт, что получает настоящая модель, и отвечает JSON того же формата,
поэтому ответ проходит ту же валидацию. Эвристики по ключевым словам RU/KZ/EN; критерий
распознаётся по смыслу названия/формулировки, а неизвестный критерий получает правдоподобный
детерминированный ответ.
"""
from __future__ import annotations

import hashlib
import json
import re

from ..prompt import parse_user_prompt
from ..timeutil import first_operator_reaction, parse_seconds
from .base import LLMClient

GREET = ("здравств", "добрый день", "добрый вечер", "доброе утро", "привет", "сәлем", "қайырлы", "hello", "hi ", "hi,", "good morning", "good afternoon", "good evening")
# Представление — любое называние имени (в т.ч. под маской анонимизации).
INTRO_RE = re.compile(r"(?i:меня зовут|менің атым|атым\s|my name|\[имя скрыто\])"
                      r"|\b(?:I'?m|I am|this is|This is)\s+[A-Z]|\b[Яя]\s*[—-]?\s*[А-ЯЁ][а-яё]+|\b[Мм]ен\s+[А-ЯӘҒҚҢӨҰҮҺІ]")
IDENT = ("иин", "кодов", "личност", "паспорт", "жсн", "жеке басы", "verify", "verified", "identity", "date of birth", "security question")
POLITE = ("спасибо", "сожале", "извин", "пожалуйста", "рақмет", "кешіріңіз", "өтінемін", "sorry", "thank", "glad", "please", "apolog")
RUDE = ("не кричите", "как хотите", "не обязан", "идиот", "дурак", "тупой", "stupid", "shut up", "ақымақ")
BYE = ("всего доброго", "до свидания", "хорошего дня", "обращайтесь", "сау болыңыз", "көріскенше", "goodbye", "bye", "have a great", "have a nice")
WAIT = ("минут", "подождите", "ожидани", "проверяю", "күте тұрыңыз", "минут", "one moment", "please wait", "minute", "checking")
# Только для mock: настоящая модель решает по смыслу (см. system-промпт), а не по словам.
GROSS = ("переведите мне", "мне лично", "на мою карту", "на мою личную", "лично на карту", "личный номер", "я лично предлагаю",
         "через компанию оформлять не надо", "маған жеке", "жеке картама", "жеке нөміріңізді", "ақылы түрде",
         "personal account", "transfer to me", "my personal card", "your personal number", "i charge for private", "private advice")
LEFT = ("покинул", "left the chat", "inactivity", "чат шығып", "клиент вышел", "соединение с клиентом прервано", "байланыс үзілді",
        "connection to customer lost", "клиент завершил разговор")


def _has(text: str, words) -> bool:
    t = " " + text.lower() + " "
    return any(w in t for w in words)


def _secs(ts: str):
    return parse_seconds(ts)


def _h(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:8], 16)


class MockClient(LLMClient):
    provider = "mock"

    def __init__(self, model: str = "mock-heuristic-v1"):
        super().__init__(model)

    def complete(self, system: str, user: str) -> tuple[str, dict]:
        _lang, tr, criteria = parse_user_prompt(user)
        items = [self._judge(c, tr) for c in criteria]
        out = json.dumps({"items": items}, ensure_ascii=False)
        return out, {"input_tokens": (len(system) + len(user)) // 4, "output_tokens": len(out) // 4}

    def _judge(self, c: dict, tr: list[dict]) -> dict:
        ops = [r for r in tr if r["speaker"] == "operator"]
        clients = [r for r in tr if r["speaker"] == "client"]
        n = len(tr)
        last = max(0, n - 1)
        name = f"{c.get('title', '')} {c.get('question', '')}".lower()
        ev = lambda r: {"index": r["index"], "quote": r["text"][:80]}
        def res(answer, evidence=(), rng=None, na_reason=None, why=""):
            if answer == 'na' and not evidence and rng is None:
                rng = [0, last]
            label = {"yes": "Да", "no": "Нет", "na": "N/A"}.get(answer, str(answer))
            if c.get("is_flag") and answer in ("yes", "no"):
                label = "Нарушение выявлено" if answer == "yes" else "Нарушение не выявлено"
            basis = ", ".join(f"реплика {e['index'] + 1}" for e in evidence) or (f"реплики {rng[0] + 1}–{rng[1] + 1}" if rng else "диалог")
            return {"criterion_id": c["id"], "answer": answer, "evidence": list(evidence), "checked_range": rng,
                    "na_reason": na_reason, "explanation": f"{c.get('title')} — {label}. {why} Основание — {basis}. (mock)"}

        def scale_pick(level: int):  # 0 — верхняя ступень
            steps = sorted(c.get("scale_steps") or [0], key=lambda x: -float(x))
            return steps[min(level, len(steps) - 1)]

        gross = [r for r in ops if _has(r["text"], GROSS)]
        rude = [r for r in ops if _has(r["text"], RUDE)]
        op_range = [ops[0]["index"], ops[-1]["index"]] if ops else [0, last]

        if c.get("is_flag") or "груб" in name or "нарушен" in name:
            if gross or rude:
                return res("yes", [ev(r) for r in (gross or rude)[:2]], why="Оператор допустил грубое нарушение.")
            return res("no", [], [0, last], why="Оскорблений, услуг в обход компании и раскрытия данных не найдено.")

        if not ops:
            if c.get("allow_na"):
                return res("na", [], None, "Оператор не вступил в диалог.", "Ответов оператора нет.")
            return res(scale_pick(99) if c.get("type") == "scale" else "no", [], [0, last], why="Ответов оператора нет.")

        first = ops[0]
        if "контакт" in name or "приветств" in name or "поздоров" in name:
            ok = _has(first["text"], GREET) and bool(INTRO_RE.search(first["text"]))
            sec, _, _ = first_operator_reaction(tr)
            late = sec is not None and sec > 180
            if ok and not late:
                return res("yes", [ev(first)], why="Оператор поздоровался и представился в первом ответе.")
            return res("no", [ev(first)], [first["index"], first["index"]],
                       why="В первом ответе нет приветствия с представлением" + (" и он пришёл позже 3 минут." if late else "."))

        if "потребн" in name or "уточн" in name:
            asked = [r for r in ops[:2] if "?" in r["text"]]
            if asked:
                return res("yes", [ev(asked[0])], why="Оператор уточнил детали до ответа.")
            if c.get("allow_na") and clients and len(clients[0]["text"]) > 60 and re.search(r"\d", clients[0]["text"]):
                return res("na", [ev(clients[0])], None, "Клиент сразу сообщил все данные для ответа.", "Уточнять было нечего.")
            return res("no", [], op_range, why="Оператор не уточнил недостающие детали.")

        if "идентиф" in name or "личност" in name:
            hits = [r for r in tr if _has(r["text"], IDENT)]
            if hits:
                return res("yes", [ev(r) for r in hits[:2]], why="Проверка личности проведена до раскрытия данных.")
            if c.get("allow_na"):
                return res("na", [], None, "Запрос не требовал идентификации.", "Защищённых действий не было.")
            return res("no", [], op_range, why="Проверка личности не найдена.")

        if c.get("type") == "scale" and ("консульт" in name or "решен" in name or "ответ" in name and "ясн" not in name):
            if gross:
                return res(scale_pick(99), [ev(gross[0])], why="Ответа по существу нет, вместо него — предложение в обход компании.")
            longest = max(ops, key=lambda r: len(r["text"]))
            if len(clients) <= 1 and len(longest["text"]) < 40 and c.get("allow_na") and any(_has(r["text"], LEFT) for r in tr):
                return res("na", [ev(longest)], None, "Клиент ушёл, не сформулировав запрос.", "Запрос не прозвучал.")
            level = 0 if len(longest["text"]) > 100 else 1 if len(longest["text"]) > 60 else 3
            return res(scale_pick(level), [ev(longest)], why="Оценка полноты по самому содержательному ответу оператора.")

        if "эмпат" in name or "вежлив" in name or "клиентоориент" in name:
            if rude:
                return res("no", [ev(rude[0])], why="Пренебрежительная реакция на клиента.")
            polite = [r for r in ops if _has(r["text"], POLITE)]
            if polite:
                return res("yes", [ev(polite[0])], why="Оператор вежлив и реагирует на проблему клиента.")
            return res("no", [], op_range, why="Нет реакции на неудобство клиента.")

        if c.get("type") == "scale" and ("управлен" in name or "ясн" in name or "грамот" in name or "диалог" in name):
            level = 0
            if rude or gross:
                level = 2
            gaps = [(_secs(b["timestamp"]) or 0) - (_secs(a["timestamp"]) or 0) for a, b in zip(tr, tr[1:])]
            if any(g > 120 for g in gaps) and not any(_has(r["text"], WAIT) for r in ops):
                level = max(level, 1)
            if any(len(r["text"]) < 20 for r in ops):
                level = max(level, 1)
            return res(scale_pick(level), [ev(ops[-1])], why="Оценены ясность, порядок ответов и предупреждение об ожидании.")

        if "заверш" in name or "прощ" in name:
            byes = [r for r in ops if _has(r["text"], BYE)]
            if byes:
                return res("yes", [ev(byes[-1])], why="Оператор предложил помощь и попрощался.")
            left = [r for r in tr if r["speaker"] == "system" and _has(r["text"], LEFT)]
            if left and c.get("allow_na"):
                return res("na", [ev(left[0])], None, "Клиент покинул чат до завершения.", "Завершить диалог не было возможности.")
            return res("no", [], [ops[-1]["index"], last], why="Диалог закрыт без итога и прощания.")

        # Неизвестный критерий: правдоподобно и детерминированно.
        pick = ops[_h(c["id"], c.get("title"), len(tr)) % len(ops)]
        if c.get("type") == "scale":
            return res(scale_pick(_h(c["id"], "s") % 2), [ev(pick)], why="Оценка по репликам оператора.")
        good = _h(c["id"], len(tr)) % 4 != 0
        return res("yes", [ev(pick)], why="Действие найдено.") if good else res("no", [], op_range, why="Ожидаемое действие не найдено.")
