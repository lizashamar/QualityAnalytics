# CQA — бэкенд

FastAPI + SQLite. Реализует REST-контракт из шапки `frontend/js/api.js` под префиксом `/api`
и отдаёт `frontend/` как статику: фронтенд открывается на http://localhost:8000 и работает
с реальным API (не в mock-режиме).

## Установка (Windows, PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1          # если скрипты запрещены: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
pip install -r requirements.txt
Copy-Item .env.example .env         # затем заполните .env
```

Минимум для демо — ничего не заполнять: `LLM_PROVIDER=mock` работает без ключа и сети.

## Запуск

```powershell
cd backend
.venv\Scripts\Activate.ps1
uvicorn app.main:app --port 8000
```

Откройте http://localhost:8000. Внизу навигации должно быть «API подключён».

Как фронтенд узнаёт адрес API: `frontend/index.html` подключает необязательный `config.local.js`.
Бэкенд отдаёт его динамически: `window.CQA_CONFIG = { API_BASE: location.origin + '/api' }`.
Если открыть фронтенд отдельно (`python -m http.server` из `frontend/`), файла нет (404 в консоли —
это нормально) и фронтенд работает в mock-режиме. Чтобы отдельно запущенный фронтенд ходил в API:
`http://localhost:5500/index.html?api=http://localhost:8000/api` (CORS для localhost разрешён).

## Импорт DEV

Через API (запрос к организаторам идёт с бэкенда — без проблем с CORS):

```powershell
curl.exe -s -X POST http://localhost:8000/api/datasets/import -H "Content-Type: application/json" --data-raw '{\"group_id\":\"DEV\"}'
```

Или без сервера: `python -m app.import_dataset DEV`.
Запасной вариант, если API организаторов недоступно, — из сохранённого ответа:
`python -m app.import_dataset DEV --file ..\docs\dev.json` (файл в `.gitignore`).

Импорт — upsert по `conversation_id`; метки времени и порядок реплик сохраняются как пришли.
Ошибка организаторов (`isSuccess=false`, сеть) → `502` с понятным текстом.

## Оценка

Один диалог:

```powershell
curl.exe -s -X POST http://localhost:8000/api/evaluations -H "Content-Type: application/json" --data-raw '{\"conversation_id\":\"p1-ru-001\"}'
```

Весь набор фоном (параллелизм `EVAL_CONCURRENCY`, одна ошибка не валит остальные; функция `cqa` — ниже):

```powershell
$job = cqa Post /evaluations/batch @{all=$true}
cqa Get "/jobs/$($job.job_id)"     # total, done, failed, errors, status, cost_usd
```

`{"all": true, "only_missing": true}` — только неоценённые; `{"conversation_ids": [...], "checklist_id": "..."}` — выборочно.
CLI: `python -m app.evaluate_all [--group DEV] [--checklist cl-chat-quality-v2] [--only-missing]` — печатает итог и стоимость.

> curl.exe в Windows PowerShell 5.1: внутренние кавычки JSON экранируются `\"`, и в значениях
> **не должно быть пробелов** — PowerShell 5.1 режет такой аргумент на части. Для тел с пробелами
> и кириллицей используйте функцию ниже (отправляет UTF-8).

```powershell
function cqa($method, $path, $body) {
  $b = $null
  if ($body) { $b = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 20 -Compress)) }
  Invoke-RestMethod -Method $method "http://localhost:8000/api$path" -ContentType "application/json; charset=utf-8" -Body $b
}
```

## Апелляции

```powershell
$a = cqa Post /appeals @{conversation_id="p1-ru-001"; criterion_id="c4"; comment="Шаг был назван"}
$r = cqa Post "/appeals/$($a.id)/resolve" @{new_answer=15; reason="Основной вопрос решён"}
$r.decision          # previous_total, final_total, new_answer, reason, resolved_at
```

`resolve` проверяет `new_answer` по снимку критериев этой оценки, причина обязательна, повторно
закрыть нельзя (`409`). В ответе `decision.previous_total` и `decision.final_total`.
При повторной оценке диалога открытые апелляции по нему становятся `outdated`.

## Смена провайдера модели (`backend/.env`)

| Провайдер | Настройки |
|---|---|
| mock (по умолчанию) | `LLM_PROVIDER=mock` |
| Claude | `LLM_PROVIDER=anthropic`, `LLM_API_KEY=...`, `LLM_MODEL=` (пусто = `claude-opus-5-5`), `LLM_EFFORT=medium` |
| OpenAI | `LLM_PROVIDER=openai`, `LLM_API_KEY=...`, `LLM_MODEL=...` |
| Gemini | `LLM_PROVIDER=openai`, `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, ключ, модель |
| Ollama | `LLM_PROVIDER=openai`, `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=...` (ключ не нужен) |

После правки `.env` перезапустите uvicorn. Проверка: `GET /api/health`.
Для Claude включён серверный fallback при отказе модели (`LLM_FALLBACKS=1`; `0` — выключить).

## Стоимость одной оценки

Каждая оценка — один вызов модели на диалог (все критерии сразу) и не более одного повтора,
если ответ не прошёл валидацию. В `evaluation.usage` хранится сумма по всем вызовам:
`calls`, `input_tokens`, `output_tokens`, `duration_ms`, `retried`, `cost_usd`, где
`cost_usd = input_tokens / 1e6 × PRICE_IN_PER_MTOK + output_tokens / 1e6 × PRICE_OUT_PER_MTOK`
(задайте цены в `.env`, например `4` и `20` для claude-opus-5-5).
Батч (`GET /api/jobs/{id}`) и `evaluate_all` суммируют стоимость по набору; `evaluate_all` печатает
среднюю цену за оценку. В mock-режиме токены — грубая оценка по длине текста, реальные цифры дают
только настоящие провайдеры: прогоните 3–5 диалогов и возьмите среднее.

## Как устроена оценка

- Критерии берутся из версии чек-листа в БД; замена критерия в редакторе не требует правок кода.
- System-промпт (`app/prompt.py`): оценивается только оператор (bot/system — контекст), приветствие
  и представление — в первой реплике оператора, системные события (подтверждение личности,
  закрытие/обрыв) допустимы как доказательство, «Нет» против N/A, грубые ошибки по смыслу,
  порог первой реакции 3 мин (время вычисляется на бэкенде и передаётся модели), для звонков
  запрет оценивать дикцию и интонацию.
- Валидация ответа (`app/evaluator.py`): JSON, ровно один item на критерий, допустимый ответ,
  N/A только при `allow_na` и с причиной, индексы реплик, цитаты (чаты — строго без учёта
  регистра и пунктуации; звонки — нечётко: ≥ 60% слов или difflib ≥ 0.6), evidence или
  `checked_range`. При ошибках — один повтор с их перечнем; если снова не прошло, сохраняется
  валидное, остальное — в `warnings`.
- Итог считает `app/scoring.py` — порт `frontend/js/scoring.js` 1в1. Общие кейсы в
  `tests/fixtures/scoring_cases.json` прогоняются и в pytest, и в `node frontend/test/scoring.test.js`.

## REST

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/conversations?group_id=` | диалоги |
| GET | `/api/conversations/{id}` | диалог |
| POST | `/api/datasets/import` `{group_id}` | импорт у организаторов → `{imported, total, skipped}` |
| GET | `/api/checklists` | все версии |
| POST | `/api/checklists` `{name, criteria, family_id?, activate?}` | новая версия (version = max+1) |
| POST | `/api/checklists/{id}/activate` | сделать активной |
| POST | `/api/evaluations` `{conversation_id, checklist_id?}` | оценить (по умолчанию активной версией) |
| GET | `/api/evaluations` | последние оценки по диалогам |
| GET | `/api/evaluations/latest?conversation_id=&checklist_id=` | последняя оценка (404, если нет) |
| GET | `/api/evaluations/{id}` | оценка (в т.ч. архивная) |
| POST | `/api/evaluations/batch` | фоновый батч → `{job_id}` |
| GET | `/api/jobs/{job_id}` | прогресс батча |
| GET | `/api/appeals` | апелляции |
| POST | `/api/appeals` `{evaluation_item_id}` или `{conversation_id, criterion_id}` + `comment` | создать |
| POST | `/api/appeals/{id}/resolve` `{new_answer, reason}` | решение проверяющего |

Особенности контракта: id — строки (`ev-12`, `AP-3`, пункт оценки `ev-12:c4`); `total`/`sections` —
исходная оценка, `final_total`/`final_gross_flag` — после решений проверяющего; статусы апелляций
`open|resolved|outdated` (фронтенд показывает `open` как «На рассмотрении»). Ошибки: `400` (валидация),
`404`, `409` (дубль или повторное решение), `502` (модель или API организаторов), текст — в `detail`.

## Тесты

```powershell
cd backend; .venv\Scripts\python.exe -m pytest -q
cd ..\frontend; node test/scoring.test.js
```

Тесты не ходят в сеть (организаторы и модель подменяются) и не трогают `cqa.db`.

## Безопасность

`.env`, `*.db` и `docs/dev.json` в `.gitignore`. В логах нет ключей, транскриптов и `audio_url`,
только id диалогов, токены, время и стоимость. Авторизации нет (прототип).
