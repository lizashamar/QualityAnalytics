"""Organizer JSON 1.0 export and validation; original AI answers are never overridden."""
from __future__ import annotations

import argparse
import json
import math
import os
import tempfile
from pathlib import Path

from .config import load_settings
from .db import Database, SEED_PATH
from .evaluator import validate_saved
from .provenance import digest, input_hash
from .scoring import calculate

SPEC = (
    ('c1', 'contact', 10, False, None), ('c2', 'discovery', 15, True, None),
    ('c3', 'identification', 20, True, None), ('c4', 'consultation', 20, True, (0, 5, 10, 15, 20)),
    ('c5', 'empathy', 15, False, None), ('c6', 'dialogue', 15, False, (0, 4, 7, 10)),
    ('c7', 'closure', 5, True, None), ('c8', 'critical', 0, False, None),
)
COUNTS = {'dev': 65, 'prod': 10}
SEED = json.loads(SEED_PATH.read_text(encoding='utf-8'))


def validate_submission(data: dict, expected_ids: set[str], split: str) -> None:
    def require(condition, message):
        if not condition:
            raise ValueError(message)
    require(isinstance(data, dict) and set(data) == {'schema_version', 'team_name', 'model', 'results'}, 'Неверные поля корневого объекта.')
    require(data['schema_version'] == '1.0', 'Ожидается schema_version 1.0.')
    require(isinstance(data['team_name'], str) and bool(data['team_name'].strip()), 'Укажите team_name.')
    model = data['model']
    require(isinstance(model, dict) and set(model) == {'mode', 'name'} and model['mode'] in ('local', 'external_api', 'hybrid') and isinstance(model['name'], str) and bool(model['name'].strip()), 'Некорректная модель.')
    results = data['results']
    require(isinstance(results, list) and len(results) == COUNTS[split], f'Для {split} требуется ровно {COUNTS[split]} записей.')
    require(all(isinstance(r, dict) and isinstance(r.get('conversation_id'), str) for r in results), 'Некорректная запись диалога.')
    ids = [r['conversation_id'] for r in results]
    require(len(set(ids)) == len(ids) and set(ids) == expected_ids, 'ID должны точно совпадать с набором, без повторов и пропусков.')
    for r in results:
        if r.get('status') == 'error':
            require(set(r) == {'conversation_id', 'status', 'criteria', 'score', 'error'} and r['criteria'] == [] and r['score'] is None and isinstance(r['error'], str) and bool(r['error'].strip()), f'{r["conversation_id"]}: некорректная ошибка.')
            continue
        require(r.get('status') == 'ok' and set(r) == {'conversation_id', 'status', 'criteria', 'score'}, 'Некорректный status или поля результата.')
        items = r['criteria']
        require(isinstance(items, list) and len(items) == 8 and all(isinstance(i, dict) for i in items), 'Нужны восемь критериев.')
        require(all(isinstance(i.get('criterion_id'), str) for i in items) and {i['criterion_id'] for i in items} == {s[1] for s in SPEC}, 'Неверные коды критериев.')
        answers = {}
        for internal, external, weight, na, steps in SPEC:
            i = next(i for i in items if i['criterion_id'] == external)
            require(set(i) == {'criterion_id', 'value', 'rationale', 'evidence_turns'}, f'{external}: неверные поля.')
            value = i['value']
            valid = (value is None and na) or (type(value) is bool if steps is None else type(value) in (int, float) and value in steps)
            require(valid, f'{external}: недопустимое значение или тип.')
            require(isinstance(i['rationale'], str) and bool(i['rationale'].strip()), f'{external}: обоснование обязательно.')
            evidence = i['evidence_turns']
            require(isinstance(evidence, list) and bool(evidence) and all(type(x) is int and x >= 1 for x in evidence) and len(evidence) == len(set(evidence)), f'{external}: нужны уникальные номера реплик с 1.')
            answers[internal] = 'na' if value is None else ('yes' if value else 'no') if type(value) is bool else value
        score = r['score']
        calc = calculate(SEED['criteria'], answers)
        require(isinstance(score, dict) and set(score) == {'final_score', 'critical_flag'}, 'Некорректные поля score.')
        total = score['final_score']
        require(type(total) in (int, float) and math.isfinite(total) and 0 <= total <= 100 and abs(total - calc['total']) < 1e-9, 'Итог не соответствует ответам, весам или округлению.')
        require(type(score['critical_flag']) is bool and score['critical_flag'] == calc['gross_flag'], 'critical_flag не совпадает с critical.')


def _error(cid: str, reason: str) -> dict:
    return {'conversation_id': cid, 'status': 'error', 'criteria': [], 'score': None, 'error': reason}


def _result(conv: dict, ev: dict | None) -> dict:
    cid = conv['conversation_id']
    if ev is None:
        return _error(cid, 'Диалог ещё не оценён выбранной версией чек-листа.')
    if ev.get('stale') or (ev.get('provenance', {}).get('input_hash') and ev['provenance']['input_hash'] != input_hash(conv)):
        return _error(cid, 'Исходный диалог изменился; требуется переоценка.')
    if ev.get('status') == 'error':
        return _error(cid, ev.get('error') or 'Оценка завершилась ошибкой.')
    if digest(ev['criteria']) != digest(SEED['criteria']):
        return _error(cid, 'Оценка выполнена изменённым чек-листом, не официальной методикой.')
    if not ev.get('model') or ev['model'].split(':', 1)[0] == 'mock':
        return _error(cid, 'Демонстрационные оценки нельзя использовать в сдаваемых результатах.')
    items, errors, general = validate_saved(ev, conv)
    if errors or general:
        return _error(cid, 'Оценка не прошла проверку доказательств: ' + '; '.join(general + [x for values in errors.values() for x in values]))
    criteria, answers = [], {}
    for internal, external, *_ in SPEC:
        i = items[internal]
        answer = i['answer']
        answers[internal] = answer
        turns = set(i['evidence'])
        if i['checked_range']:
            a, b = i['checked_range']
            turns.update(range(a, b + 1))
        rationale = i['explanation']
        if answer == 'na' and i['na_reason'] not in rationale:
            rationale += ' ' + i['na_reason']
        criteria.append({'criterion_id': external, 'value': None if answer == 'na' else answer == 'yes' if isinstance(answer, str) else answer,
                         'rationale': rationale, 'evidence_turns': [x + 1 for x in sorted(turns)]})
    calc = calculate(ev['criteria'], answers)
    return {'conversation_id': cid, 'status': 'ok', 'criteria': criteria,
            'score': {'final_score': calc['total'], 'critical_flag': calc['gross_flag']}}


def build_submission(db: Database, group_id: str, team_name: str, split: str, checklist_id: str = SEED['id']) -> dict:
    if split not in COUNTS:
        raise ValueError('Выберите dev или prod.')
    if not team_name.strip():
        raise ValueError('Укажите название команды: --team или TEAM_NAME в backend/.env.')
    conversations = db.list_conversations(group_id)
    if len(conversations) != COUNTS[split]:
        raise ValueError(f'В группе {group_id}: {len(conversations)} диалогов; для {split} требуется {COUNTS[split]}. Сначала импортируйте полный набор.')
    cl = db.get_checklist(checklist_id)
    if not cl or digest(cl['criteria']) != digest(SEED['criteria']):
        raise ValueError('Для сдачи выберите неизменённый официальный чек-лист.')
    evaluations = db.latest_evaluations_by_checklist(checklist_id)
    selected = [evaluations.get(c['conversation_id']) for c in conversations]
    modes, names = set(), set()
    for ev in selected:
        if not ev:
            continue
        provider, _, requested = ev.get('model', '').partition(':')
        if provider == 'mock':
            continue
        modes.add('external_api' if provider in ('openai', 'openai-compat', 'gemini') else 'local')
        names.update(ev.get('usage', {}).get('served_by_history') or [requested])
    if not names or not all(names):
        raise ValueError('Нет фактически использованной AI-модели в этом наборе. Запустите реальную оценку перед экспортом.')
    payload = {'schema_version': '1.0', 'team_name': team_name.strip(),
               'model': {'mode': next(iter(modes)) if len(modes) == 1 else 'hybrid', 'name': ', '.join(sorted(names))},
               'results': [_result(c, ev) for c, ev in zip(conversations, selected)]}
    validate_submission(payload, {c['conversation_id'] for c in conversations}, split)
    return payload


def write_submission(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False) as f:
            temporary = Path(f.name)
            json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporary, path)
    finally:
        if temporary:
            temporary.unlink(missing_ok=True)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description='Экспорт и проверка результатов организаторов JSON 1.0')
    p.add_argument('--split', required=True, choices=COUNTS)
    p.add_argument('--group', required=True, help='Исходная группа API организаторов')
    p.add_argument('--team', help='Название команды; по умолчанию TEAM_NAME из backend/.env')
    p.add_argument('--checklist', default=SEED['id'])
    p.add_argument('--output', type=Path)
    p.add_argument('--validate', type=Path, help='Проверить существующий файл относительно ID группы')
    p.add_argument('--evaluate', action='store_true', help='Заново оценить всю группу перед экспортом')
    a = p.parse_args(argv)
    s = load_settings()
    db = Database(s.db_file)
    db.migrate()
    try:
        if a.validate:
            data = json.loads(a.validate.read_text(encoding='utf-8'))
            validate_submission(data, {c['conversation_id'] for c in db.list_conversations(a.group)}, a.split)
            lengths = {c['conversation_id']: len(c['transcript']) for c in db.list_conversations(a.group)}
            for r in data['results']:
                if r['status'] == 'ok' and any(t > lengths[r['conversation_id']] for i in r['criteria'] for t in i['evidence_turns']):
                    raise ValueError('evidence_turns выходит за пределы исходного транскрипта.')
        else:
            if a.evaluate:
                from .evaluate_all import main as evaluate_all
                if s.llm_provider == 'mock':
                    raise ValueError('Для сдачи нужен реальный AI-провайдер, не mock.')
                if len(db.list_conversations(a.group)) != COUNTS[a.split]:
                    raise ValueError(f'До вызова модели импортируйте ровно {COUNTS[a.split]} диалогов группы {a.group}.')
                checklist = db.get_checklist(a.checklist)
                if not checklist or digest(checklist['criteria']) != digest(SEED['criteria']):
                    raise ValueError('Оценка для сдачи требует неизменённого официального чек-листа.')
                evaluate_all(['--group', a.group, '--checklist', a.checklist])
            data = build_submission(db, a.group, a.team if a.team is not None else s.team_name, a.split, a.checklist)
            path = a.output or Path(__file__).resolve().parents[2] / 'results' / a.split / 'results.json'
            write_submission(path, data)
            print(f'Сохранено: {path}')
        errors = sum(r['status'] == 'error' for r in data['results'])
        print(f'JSON 1.0: {len(data["results"])} записей, {errors} ошибок. Команда: {data["team_name"]}.')
        return 1 if errors else 0
    except (ValueError, OSError) as e:
        print(f'Экспорт отклонён: {e}')
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
