"""CLI: демо-данные для показа сравнения версий чек-листа и апелляций.

  python -m app.seed_demo [--dialogs id1,id2] [--limit 8] [--dry-run] [--activate-v2]
                          [--skip-evaluate] [--appeals-only] [--add-criterion] [--yes] [--db PATH]

Только существующие сервисы (db.create_checklist_version, services.run_evaluation / create_appeal /
resolve_appeal), без собственного SQL. Скрипт пишет ТОЛЬКО в БД и никогда не трогает results/.
Идемпотентен: v2 и демо-апелляции ищутся перед созданием, оценки не повторяются.

Порядок: v2 (не активируется) -> оценки v1 -> апелляции по v1 (решённые и «устаревшая») ->
переоценка по v2 -> открытые апелляции. Открытые создаются ПОСЛЕ переоценки: insert_evaluation
переводит все открытые апелляции диалога в outdated, иначе они бы устарели сразу.
"""
from __future__ import annotations

import argparse
import copy
import sqlite3
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from pathlib import Path

from .config import BACKEND_DIR, Settings, load_settings
from .db import Database
from .llm import LLMError, make_client
from .prompt import SYSTEM_PROMPT, build_user_prompt
from .scoring import calculate, validate_checklist
from .services import ApiError, answers_of, ap_key, create_appeal, ev_key, evaluation_out, resolve_appeal, run_evaluation

DEFAULT_DIALOGS = ["p1-ru-025", "p1-ru-023", "p1-kz-002", "p1-ru-018", "p1-kz-003", "p1-en-001", "p4-ru-001"]
BASE_ID = "cl-chat-quality-v1"
V2_NAME = "Чек-лист качества чатов, v2: упор на клиентоориентированность"
V2_DESCRIPTION = ("Демо-версия: больше веса эмпатии и меньше — выявлению потребности; "
                  "уточнена формулировка критерия «Завершение».")
NEW_CRITERION_ID = "c9"

# роль диалога в демо: (вид апелляции, фиксированный критерий или None — подбирается по оценке)
ROLES = {
    "p1-kz-002": ("open", "c7"),
    "p1-ru-018": ("open", "c6"),
    "p1-kz-003": ("changed", None),
    "p1-en-001": ("confirmed", None),
    "p1-ru-023": ("outdated", None),
}

# критерий -> (комментарий апелляции, причина «ответ изменён», причина «оценка подтверждена»)
TEXTS = {
    "c1": ("Оператор поздоровался на языке клиента и представился в первом же сообщении, прошу пересмотреть оценку.",
           "Проверено по транскрипту: приветствие и представление есть в первой реплике оператора, ответ изменён на «Да».",
           "В первой реплике оператора нет приветствия с представлением, оценка модели подтверждена."),
    "c2": ("Оператор уточнил недостающие данные до ответа по существу, критерий выполнен.",
           "Уточняющий вопрос прозвучал до ответа по существу, ответ изменён на «Да».",
           "Уточняющие вопросы заданы уже после ответа по существу, оценка подтверждена."),
    "c3": ("Личность клиента была подтверждена до раскрытия данных, это видно по системному событию.",
           "Системное событие подтверждает идентификацию до раскрытия данных, ответ изменён на «Да».",
           "Подтверждения личности до раскрытия данных в транскрипте нет, оценка подтверждена."),
    "c4": ("Основной вопрос клиента закрыт, пропущена лишь второстепенная деталь, консультация оценена слишком низко.",
           "Основной вопрос решён, пропущена только второстепенная деталь, ступень шкалы повышена.",
           "Существенная часть запроса осталась без ответа, ступень шкалы подтверждена."),
    "c5": ("Оператор извинился за неудобство и отреагировал на конкретную проблему клиента, прошу пересмотреть оценку.",
           "В репликах есть извинение и реакция на конкретную проблему клиента, ответ изменён на «Да».",
           "Вежливость есть, но реакции на конкретную проблему клиента нет, оценка «Нет» подтверждена."),
    "c6": ("Ответы были ясными и шли в правильном порядке, об ожидании клиента предупредили, ступень шкалы занижена.",
           "Ответы ясные, об ожидании предупредили, ступень шкалы повышена.",
           "Есть заметный сбой в порядке ответов, ступень шкалы подтверждена."),
    "c7": ("Оператор предложил дальнейшую помощь и попрощался, но критерий оценён как невыполненный.",
           "Прощание и предложение помощи есть в последней реплике оператора, ответ изменён на «Да».",
           "Диалог закрыт без итога и предложения помощи, оценка подтверждена."),
}
DEMO_COMMENTS = {t[0] for t in TEXTS.values()}
CHANGE_PREFS = ["c5", "c1", "c7", "c2", "c3", "c4", "c6"]
CONFIRM_PREFS = ["c5", "c2", "c1", "c7", "c3", "c4", "c6"]
OUTDATED_PREFS = ["c4", "c6", "c2", "c5", "c1", "c3", "c7"]


def say(msg: str = "") -> None:
    print(msg, flush=True)


def warn(msg: str) -> None:
    print(f"  ! {msg}", flush=True)


class ReadOnlyDatabase(Database):
    """Для --dry-run: файл открывается mode=ro, записать в него физически нельзя."""

    @contextmanager
    def conn(self):
        c = sqlite3.connect(Path(self.path).resolve().as_uri() + "?mode=ro", uri=True, timeout=30)
        c.row_factory = sqlite3.Row
        try:
            yield c
        finally:
            c.close()


# ---------- чек-лист v2 ----------

def build_v2_criteria(v1_criteria: list[dict], add_criterion: bool) -> list[dict]:
    crit = copy.deepcopy(v1_criteria)
    by_id = {c["id"]: c for c in crit}
    for cid in ("c2", "c5", "c6", "c7"):
        if cid not in by_id:
            raise ValueError(f"В базовой версии нет критерия {cid}: v2 строится по официальному чек-листу.")
    by_id["c2"]["weight"] = 10   # Выявление потребности 15 -> 10
    by_id["c5"]["weight"] = 20   # Эмпатия 15 -> 20
    by_id["c7"]["question"] = ("Да — оператор подвёл итог (что сделано или что будет дальше) и предложил дальнейшую помощь, "
                               "после чего попрощался.")
    if add_criterion:
        by_id["c6"]["weight"] = 10  # Управление диалогом 15 -> 10
        new = {"id": NEW_CRITERION_ID, "section": "Ведение и завершение диалога", "title": "Использование имени клиента",
               "question": "Да — оператор хотя бы раз обратился к клиенту по имени.", "type": "yesno", "weight": 5,
               "allow_na": True, "na_condition": "N/A — имя клиента неизвестно или скрыто анонимизацией.",
               "scale_steps": [], "scale_labels": {}, "is_flag": False}
        pos = next((i for i, c in enumerate(crit) if c.get("is_flag")), len(crit))
        crit.insert(pos, new)
    return crit


def ensure_v2(db: Database, base: dict, add_criterion: bool, activate: bool) -> dict:
    existing = next((c for c in db.list_checklists() if c["name"] == V2_NAME and c["family_id"] == base["family_id"]), None)
    if existing:
        say(f"v2 уже есть: {existing['id']} (повторно не создаётся)")
        if add_criterion and not any(c["id"] == NEW_CRITERION_ID for c in existing["criteria"]):
            warn("v2 создана без критерия «Использование имени клиента»; версии неизменяемы — удалите демо-БД и запустите заново.")
        v2 = existing
    else:
        criteria = build_v2_criteria(base["criteria"], add_criterion)
        errors = validate_checklist(criteria)
        if errors:
            raise ValueError("v2 не прошла проверку: " + " ".join(errors))
        v2 = db.create_checklist_version(name=V2_NAME, description=V2_DESCRIPTION, criteria=criteria,
                                         family_id=base["family_id"], based_on=base["id"], activate=False)
        say(f"создана {v2['id']}" + (" с критерием «Использование имени клиента»" if add_criterion else ""))
    if activate and not v2["active"]:
        v2 = db.activate_checklist(v2["id"])
        say(f"{v2['id']} сделана активной (--activate-v2)")
    return v2


# ---------- состояние оценок ----------

def eval_ok(db: Database, ev: dict | None) -> bool:
    return bool(ev) and not ev.get("stale") and evaluation_out(ev, db.get_conversation(ev["conversation_id"]))["status"] == "ok"


def missing(db: Database, ids: list[str], checklist_id: str) -> list[str]:
    cur = db.latest_evaluations_by_checklist(checklist_id)
    return [i for i in ids if not eval_ok(db, cur.get(i))]


def pick_dialogs(db: Database, ids: list[str], limit: int) -> list[str]:
    present = []
    for cid in dict.fromkeys(ids):
        if db.get_conversation(cid):
            present.append(cid)
        else:
            warn(f"диалог {cid} не загружен в БД — пропущен")
    if len(present) > limit:
        warn(f"--limit {limit}: не берём {', '.join(present[limit:])}")
    return present[:limit]


def estimate(db: Database, s: Settings, ids: list[str], criteria: list[dict]) -> dict:
    """Грубая оценка: вход — символы промпта / 3 (кириллица), выход — среднее по реальным оценкам или 90 токенов на критерий."""
    tin = sum((len(SYSTEM_PROMPT) + len(build_user_prompt(db.get_conversation(i), criteria))) // 3 for i in ids)
    real = [e["usage"].get("output_tokens") for e in db.list_latest_evaluations()
            if not str(e.get("model", "")).startswith("mock") and (e.get("usage") or {}).get("output_tokens")]
    out_each = round(sum(real) / len(real)) if real else 90 * len(criteria) + 150
    tout = out_each * len(ids)
    cost = None
    if s.price_in_per_mtok is not None or s.price_out_per_mtok is not None:
        cost = tin / 1e6 * (s.price_in_per_mtok or 0) + tout / 1e6 * (s.price_out_per_mtok or 0)
    return {"in": tin, "out": tout, "cost": cost}


def cost_line(est: dict, n: int) -> str:
    c = "не оценивается (PRICE_IN_PER_MTOK / PRICE_OUT_PER_MTOK не заданы)" if est["cost"] is None else \
        f"≈ ${est['cost']:.4f} (с повторами при невалидном ответе до ${est['cost'] * 2:.4f})"
    return f"{n} вызовов модели, токены ≈ {est['in']}/{est['out']}, стоимость {c}"


# ---------- выбор критерия и ответов ----------

def _item(ev: dict, cid: str) -> dict:
    return next(i for i in ev["items"] if i["criterion_id"] == cid)


def _scored(ev: dict, prefs: list[str]) -> list[dict]:
    crit = [c for c in ev["criteria"] if not c.get("is_flag")]
    return sorted(crit, key=lambda c: prefs.index(c["id"]) if c["id"] in prefs else len(prefs))


def _top(c: dict):
    return max(c["scale_steps"]) if c.get("type") == "scale" else "yes"


def _raise(c: dict, answer):
    """Следующий ответ выше текущего; None — повышать некуда."""
    if c.get("type") != "scale":
        return None if answer == "yes" else "yes"
    if answer in ("na", None):
        return _top(c)
    higher = sorted(x for x in c["scale_steps"] if x > answer)
    return higher[0] if higher else None


def _total_with(ev: dict, cid: str, new) -> float | None:
    answers = answers_of(ev["items"], final=False)
    answers[cid] = new
    return calculate(ev["criteria"], answers)["total"]


def pick_change(ev: dict) -> tuple[str, object] | None:
    base = calculate(ev["criteria"], answers_of(ev["items"], final=False))["total"]
    for allow_na in (False, True):
        for c in _scored(ev, CHANGE_PREFS):
            a = _item(ev, c["id"])["answer"]
            new = _raise(c, a)
            if new is None or (a == "na" and not allow_na) or (a != "na" and allow_na):
                continue
            if _total_with(ev, c["id"], new) != base:
                return c["id"], new
    return None


def pick_confirm(ev: dict, prefs: list[str]) -> str | None:
    cands = [c for c in _scored(ev, prefs) if _item(ev, c["id"])["answer"] != "na"]
    low = [c for c in cands if _item(ev, c["id"])["answer"] != _top(c)]
    return (low or cands or [{"id": None}])[0]["id"]


def texts_for(cid: str, title: str) -> tuple[str, str, str]:
    return TEXTS.get(cid) or (f"Не согласен с оценкой по критерию «{title}»: в диалоге есть выполненные действия оператора.",
                              "Проверено по транскрипту, ответ изменён.", "Проверено по транскрипту, оценка подтверждена.")


def title_of(ev: dict, cid: str) -> str:
    return next(c.get("title", cid) for c in ev["criteria"] if c["id"] == cid)


def demo_appeal(db: Database, conv_id: str, criterion: str | None = None) -> dict | None:
    return next((a for a in db.list_appeals() if a["conversation_id"] == conv_id and a["comment"] in DEMO_COMMENTS
                 and (criterion is None or a["criterion_id"] == criterion)), None)


def describe(res: dict) -> str:
    d = res.get("decision") or {}
    return f"{res['id']} {res['criterion_id']}: итог {d.get('previous_total')} -> {d.get('final_total')}"


def safe(label: str, fn):
    try:
        return fn()
    except ApiError as e:
        warn(f"{label}: {e.message}")
    except Exception as e:  # noqa: BLE001 — одна ошибка не должна ронять остальные шаги
        warn(f"{label}: {type(e).__name__}: {e}")
    return None


# ---------- апелляции ----------

def appeals_on_v1(db: Database, v1: dict, ids: list[str], will_reevaluate: bool) -> None:
    """Решённые (с изменением и с подтверждением) и «устаревшая» — по текущим оценкам v1."""
    cur = db.latest_evaluations_by_checklist(v1["id"])

    def usable(cid):
        ev = cur.get(cid)
        return ev if ev and not ev["archived"] and eval_ok(db, ev) else None

    def existing(cid, role):
        found = demo_appeal(db, cid)
        if found and found["status"] == "open" and role in ("changed", "confirmed"):
            _finish(db, found, role)
        elif found:
            say(f"  = {cid}: демо-апелляция {ap_key(found['id'])} уже есть ({found['status']}) — пропуск")
        return found

    def make(cid, ev, crit, role):
        ap = safe(f"{cid}: создание апелляции", lambda: create_appeal(
            db, evaluation_item_id=f"{ev_key(ev['id'])}:{crit}", conversation_id=None, criterion_id=None,
            comment=texts_for(crit, title_of(ev, crit))[0]))
        if not ap:
            return
        if role == "outdated":
            say(f"  + {cid}: открыта {ap['id']} по {crit} (v1), станет «устарела» после переоценки по v2")
        else:
            _finish(db, ap, role)

    # «изменён ответ»: нужен диалог, где повышение ответа реально меняет итог (у 100 баллов повышать нечего)
    fixed = next((c for c in ids if ROLES.get(c, (None,))[0] == "changed"), None)
    cands = ([fixed] if fixed else []) + [c for c in ids if c not in ROLES]
    if fixed or cands:
        if not any(existing(c, "changed") for c in cands):
            for cid in cands:
                ev = usable(cid)
                pick = pick_change(ev) if ev else None
                if pick:
                    make(cid, ev, pick[0], "changed")
                    break
            else:
                warn("не нашлось диалога, где решение меняет итог (у всех максимум или нет оценки v1) — «ответ изменён» пропущена")

    for cid in ids:
        role = ROLES.get(cid, (None, None))[0]
        if role not in ("confirmed", "outdated") or existing(cid, role):
            continue
        ev = usable(cid)
        if not ev:
            warn(f"{cid}: нет актуальной оценки v1 (нет или уже переоценён) — апелляция «{role}» пропущена")
            continue
        if role == "outdated" and not will_reevaluate:
            warn(f"{cid}: «устаревшая» апелляция появляется только после переоценки по v2 — пропущена (запустите без --skip-evaluate)")
            continue
        crit = pick_confirm(ev, CONFIRM_PREFS if role == "confirmed" else OUTDATED_PREFS)
        if crit:
            make(cid, ev, crit, role)
        else:
            warn(f"{cid}: нет подходящего критерия для апелляции — пропуск")


def _finish(db: Database, ap: dict, role: str) -> None:
    ev = db.get_evaluation(int(ap["evaluation_id"].split("-")[1]))
    crit = next(c for c in ev["criteria"] if c["id"] == ap["criterion_id"])
    current = _item(ev, crit["id"])["answer"]
    new = _raise(crit, current) if role == "changed" else current
    if new is None or (role == "changed" and new == current):
        new = current
        warn(f"{ap['conversation_id']}: ответ повысить нельзя, решение сохранится как подтверждение")
    _, change_reason, confirm_reason = texts_for(crit["id"], crit.get("title", ""))
    res = safe(f"{ap['conversation_id']}: решение", lambda: resolve_appeal(
        db, ap["id"], new, change_reason if new != current else confirm_reason))
    if res:
        say(f"  + {ap['conversation_id']}: {describe(res)} ({'ответ изменён' if new != current else 'оценка подтверждена'})")


def open_appeals(db: Database, ids: list[str]) -> None:
    for cid in ids:
        role, crit = ROLES.get(cid, (None, None))
        if role != "open":
            continue
        ev = db.latest_evaluation(cid)
        if demo_appeal(db, cid, crit):
            say(f"  = {cid}: демо-апелляция по {crit} уже есть — пропуск")
            continue
        if not ev or not any(c["id"] == crit for c in ev["criteria"]):
            warn(f"{cid}: нет оценки с критерием {crit} — апелляция пропущена")
            continue
        if any(a["conversation_id"] == cid and a["criterion_id"] == crit and a["status"] == "open" and a["evaluation_id"] == ev["id"]
               for a in db.list_appeals()):
            warn(f"{cid}: по {crit} уже есть открытая апелляция — пропуск")
            continue
        if ev["checklist_version"] == 1:
            warn(f"{cid}: открытая апелляция создаётся по оценке v1 (v2 не запускалась) и устареет при переоценке")
        ap = safe(f"{cid}: создание апелляции", lambda: create_appeal(
            db, evaluation_item_id=f"{ev_key(ev['id'])}:{crit}", conversation_id=None, criterion_id=None,
            comment=texts_for(crit, title_of(ev, crit))[0]))
        if ap:
            say(f"  + {cid}: открыта {ap['id']} по {crit} (оценка {ap['evaluation_id']})")


# ---------- оценка ----------

def evaluate_many(db: Database, s: Settings, ids: list[str], checklist: dict) -> int:
    if not ids:
        return 0
    client = make_client(s)
    failed = 0
    with ThreadPoolExecutor(max_workers=s.eval_concurrency) as pool:
        futs = {pool.submit(run_evaluation, db, s, client, i, checklist["id"]): i for i in ids}
        for f in as_completed(futs):
            cid = futs[f]
            try:
                ev = f.result()
                if ev.get("status") == "error" or ev.get("stale"):
                    raise ValueError(ev.get("error") or "диалог изменился во время оценки")
                say(f"  ✓ {cid} [{checklist['id']}]: {ev['total']}")
            except Exception as e:  # noqa: BLE001
                failed += 1
                warn(f"{cid} [{checklist['id']}]: {getattr(e, 'message', None) or e}")
    return failed


def confirm(args, s: Settings, n: int, line: str) -> bool:
    if s.llm_provider == "mock" or n == 0:
        return True
    say(f"Провайдер {s.llm_provider}:{s.llm_model} — платные вызовы. Диалогов к оценке: {n}. {line}")
    if args.yes:
        return True
    if not sys.stdin.isatty():
        say("Нужно подтверждение: добавьте --yes.")
        return False
    return input("Продолжить? [y/N] ").strip().lower() in ("y", "yes", "д", "да")


# ---------- запуск ----------

def parse(argv):
    p = argparse.ArgumentParser(description="Демо-данные: чек-лист v2, переоценка, апелляции")
    p.add_argument("--dialogs", help="id через запятую (по умолчанию демо-набор)")
    p.add_argument("--limit", type=int, default=8)
    p.add_argument("--dry-run", action="store_true", help="только план и оценка стоимости, БД открывается read-only")
    p.add_argument("--activate-v2", action="store_true", help="сделать v2 активной (по умолчанию остаётся v1)")
    p.add_argument("--skip-evaluate", action="store_true", help="не вызывать модель; апелляции — по уже имеющимся оценкам")
    p.add_argument("--appeals-only", action="store_true", help="только апелляции: без v2 и без оценок")
    p.add_argument("--add-criterion", action="store_true", help="добавить в v2 критерий «Использование имени клиента»")
    p.add_argument("--yes", action="store_true", help="не спрашивать подтверждение при платной модели")
    p.add_argument("--db", help="файл БД вместо DB_PATH")
    p.add_argument("--allow-main-db", action="store_true", help="разрешить запись в backend/cqa.db (боевая БД)")
    return p.parse_args(argv)


def dry_run(db: Database, s: Settings, args, ids_in: list[str]) -> int:
    say(f"[dry-run] БД: {db.path} (read-only), модель {s.llm_provider}:{s.llm_model}")
    ids = pick_dialogs(db, ids_in, args.limit)
    base = db.get_checklist(BASE_ID) or db.active_checklist()
    if not base:
        say("Нет базового чек-листа — нечего планировать.")
        return 0
    v2 = next((c for c in db.list_checklists() if c["name"] == V2_NAME and c["family_id"] == base["family_id"]), None)
    say(f"Диалоги ({len(ids)}): {', '.join(ids) or '—'}")
    say(f"v2: {'уже есть ' + v2['id'] if v2 else 'будет создана'}; {'v2 станет активной' if args.activate_v2 else 'v2 активирована не будет'}")
    calls = 0
    est_total = {"in": 0, "out": 0, "cost": 0.0 if s.price_in_per_mtok is not None or s.price_out_per_mtok is not None else None}
    if not (args.skip_evaluate or args.appeals_only):
        crit_v2 = v2["criteria"] if v2 else build_v2_criteria(base["criteria"], args.add_criterion)
        for label, cl_id, crit in (("v1", base["id"], base["criteria"]), ("v2", v2["id"] if v2 else None, crit_v2)):
            todo = missing(db, ids, cl_id) if cl_id else list(ids)
            say(f"оценить по {label}: {len(todo)} из {len(ids)} ({', '.join(todo) or 'уже оценены'})")
            if todo:
                e = estimate(db, s, todo, crit)
                calls += len(todo)
                est_total["in"] += e["in"]
                est_total["out"] += e["out"]
                if e["cost"] is not None and est_total["cost"] is not None:
                    est_total["cost"] += e["cost"]
    else:
        say("оценки пропущены (--skip-evaluate / --appeals-only): вызовов модели не будет")
    for cid in ids:
        role, crit = ROLES.get(cid, (None, None))
        if role:
            state = demo_appeal(db, cid)
            say(f"апелляция {role}: {cid}{' ' + crit if crit else ''} — {'уже есть (' + state['status'] + ')' if state else 'будет создана'}")
    say(f"Итого: {cost_line(est_total, calls)}")
    say("Ничего не записано.")
    return 0


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    args = parse(argv)
    s = load_settings()
    if args.db:
        s = s.with_(db_path=args.db)
    ids_in = [x.strip() for x in args.dialogs.split(",") if x.strip()] if args.dialogs else DEFAULT_DIALOGS
    path = Path(s.db_file)

    if args.dry_run:
        if not path.exists():
            say(f"[dry-run] БД {path} не существует: загружать нечего, будет создана пустая. Ничего не записано.")
            return 0
        try:
            return dry_run(ReadOnlyDatabase(path), s, args, ids_in)
        except sqlite3.OperationalError as e:
            say(f"[dry-run] БД {path} не инициализирована ({e}). Ничего не записано.")
            return 0

    if path.resolve() == (BACKEND_DIR / "cqa.db").resolve() and not args.allow_main_db:
        print(f"Отказ: {path} — основная БД, из которой делается экспорт. Демо-данные в неё писать нельзя.\n"
              "Сделайте копию (Copy-Item cqa.db demo.db) и запустите с DB_PATH=demo.db или --db demo.db.", file=sys.stderr)
        return 2
    db = Database(path)
    db.migrate()
    say(f"БД: {path}; модель {s.llm_provider}:{s.llm_model}")
    ids = pick_dialogs(db, ids_in, args.limit)
    if not ids:
        say("Нет подходящих диалогов в БД — сначала python -m app.import_dataset DEV")
        return 1
    base = db.get_checklist(BASE_ID) or db.active_checklist()
    if not base:
        print("Нет базового чек-листа", file=sys.stderr)
        return 2
    do_eval = not (args.skip_evaluate or args.appeals_only)
    v2 = None
    if not args.appeals_only:
        try:
            v2 = ensure_v2(db, base, args.add_criterion, args.activate_v2)
        except ValueError as e:
            print(f"Ошибка: {e}", file=sys.stderr)
            return 2
    failed = 0
    if do_eval:
        todo1, todo2 = missing(db, ids, base["id"]), missing(db, ids, v2["id"])
        est = estimate(db, s, todo1, base["criteria"]) if todo1 else {"in": 0, "out": 0, "cost": 0.0}
        e2 = estimate(db, s, todo2, v2["criteria"]) if todo2 else {"in": 0, "out": 0, "cost": 0.0}
        tot = {"in": est["in"] + e2["in"], "out": est["out"] + e2["out"],
               "cost": None if est["cost"] is None or e2["cost"] is None else est["cost"] + e2["cost"]}
        if not confirm(args, s, len(set(todo1) | set(todo2)), cost_line(tot, len(todo1) + len(todo2))):
            say("Отменено, ничего не записано.")
            return 1
        try:
            say("Оценки по v1 (если нет):")
            failed += evaluate_many(db, s, todo1, base)
        except LLMError as e:
            print(f"Ошибка модели: {e}", file=sys.stderr)
            return 2
    say("Апелляции по оценкам v1:")
    appeals_on_v1(db, base, ids, will_reevaluate=do_eval)
    if do_eval:
        say("Переоценка по v2 (старые оценки архивируются):")
        failed += evaluate_many(db, s, missing(db, ids, v2["id"]), v2)
    say("Открытые апелляции:")
    open_appeals(db, ids)
    active = db.active_checklist()
    say(f"Готово. Активный чек-лист: {active['id'] if active else '—'}"
        + ("" if args.activate_v2 else " (v2 не активирована). results/ не тронут."))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
