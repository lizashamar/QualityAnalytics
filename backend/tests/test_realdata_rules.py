"""Правила по реальным данным DEV: шумные звонки, ISO с 7 знаками, системные события, смешанные KZ-реплики."""
from app.evaluator import quote_matches, validate_output
from app.prompt import SYSTEM_PROMPT, build_user_prompt
from app.timeutil import first_operator_reaction, parse_seconds


def test_iso_7_fraction_digits():
    a = parse_seconds("2026-11-03T15:49:13.1900670+00:00")
    b = parse_seconds("2026-11-03T15:49:22.4171535+00:00")
    assert a is not None and abs((b - a) - 9.2270865) < 1e-5
    assert parse_seconds("03:40") == 220 and parse_seconds("1:02:03") == 3723 and parse_seconds("bad") is None


def test_reaction_counted_from_escalation():
    tr = [{"timestamp": "00:00", "speaker": "client", "text": "?"},
          {"timestamp": "00:02", "speaker": "bot", "text": "Сәлеметсіз бе! Мен AIM"},
          {"timestamp": "00:38", "speaker": "system", "text": "Чат операторға жіберілді."},
          {"timestamp": "01:15", "speaker": "operator", "text": "Сәлеметсіз бе, менің атым Аружан."}]
    assert first_operator_reaction(tr) == (37.0, 2, 3)
    assert "через 37 с после [2]" in build_user_prompt({"transcript": tr, "language": "KZ", "channel": "agent chat"}, [])


def test_chat_quotes_strict_but_case_punct_insensitive():
    text = "Веб-нұсқада «Кабинет» бөлімін ашыңыз, затем «Использовать маржу» на tradernet.global."
    assert quote_matches("веб нұсқада кабинет", text)
    assert quote_matches("«Использовать маржу» на TRADERNET.GLOBAL", text)
    assert not quote_matches("Веб-нұсқада Кабинетті ашыңыз", text)  # пересказ в чате не проходит


def test_call_quotes_fuzzy():
    text = "Здравствуйте, Фридом брокер меня зовут [Имя скрыто], чем могу помочь?"
    assert not quote_matches("Здравствуйте Фридом брокер меня зовут Тимур", text)          # строго — нет
    assert quote_matches("Здравствуйте Фридом брокер меня зовут Тимур", text, fuzzy=True)  # 5/6 слов
    assert quote_matches("Здраствуйте фридм брокер", text, fuzzy=True)                     # ошибки распознавания
    assert not quote_matches("переведите деньги мне лично на карту", text, fuzzy=True)


def test_system_event_can_be_evidence(seed_criteria):
    tr = [{"timestamp": "00:00", "speaker": "client", "text": "Покажите мой баланс"},
          {"timestamp": "00:05", "speaker": "system", "text": "Личность клиента подтверждена."},
          {"timestamp": "00:10", "speaker": "operator", "text": "Здравствуйте, я Тимур. Баланс 100 000 ₸."}]
    c3 = next(c for c in seed_criteria if c["id"] == "c3")
    items, errs, _ = validate_output({"items": [{"criterion_id": "c3", "answer": "yes", "evidence": [
        {"index": 1, "quote": "Личность клиента подтверждена"}], "checked_range": None, "na_reason": None, "explanation": "ok"}]},
        [c3], tr)
    assert not errs and items["c3"]["evidence"] == [1]


def test_prompt_mentions_required_rules():
    p = SYSTEM_PROMPT
    for must in ("ПЕРВОЙ РЕПЛИКЕ ОПЕРАТОРА", "Клиенттің жеке басы расталды", "Соединение с клиентом прервано",
                 "через компанию оформлять не надо", "ақылы түрде", "I charge for private advice", "не полный список",
                 "Дикцию, интонацию", "[Имя скрыто]", "tradernet.global", "3 мин"):
        assert must in p, must
