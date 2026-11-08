# CQA — бэкенд

FastAPI + SQLite. Реализует описанный ниже REST-контракт под префиксом `/api`
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
При изменении исходного транскрипта прежние оценки получают `stale: true`; открытые апелляции
тоже устаревают. Снимок транскрипта, хеш входа, версия и текст промпта, параметры и идентификаторы
запросов сохраняются с новой оценкой. Обновление одной лишь ссылки аудио не меняет её применимость.

Невалидный ответ после повтора, отказ модели и ошибка сети сохраняются как `status: "error"` с
`error` и `total: null`, а не как нулевой балл. HTTP 200 у `/evaluations` означает сохранённую попытку:
проверяйте её `status` и `stale`. Батчи и CLI считают такие попытки неуспешными; интерфейс предлагает
повторную оценку и исключает их из показателей качества.

## Демо-данные

`python -m app.seed_demo` готовит показ сравнения версий и апелляций: чек-лист v2
(«Чек-лист качества чатов, v2: упор на клиентоориентированность»: «Эмпатия» 15→20, «Выявление
потребности» 15→10, уточнена формулировка «Завершения»; с `--add-criterion` ещё «Использование
имени клиента» вес 5 за счёт «Управления диалогом» 15→10), оценки v1 и v2 для 7 диалогов и 5 апелляций:
2 открытые (p1-kz-002 «Завершение», p1-ru-018 «Управление диалогом»), решённая с изменением ответа,
решённая с подтверждением и устаревшая (открыта по v1, затем диалог переоценён по v2).
Используются только существующие сервисы; скрипт идемпотентен (v2 и демо-апелляции не дублируются).

**Не портите боевой экспорт: работайте с копией БД.** Экспорт (`app.submission`) читает `cqa.db`, поэтому
скрипт отказывается писать в `backend/cqa.db` (обход — `--allow-main-db`, не нужен). Экспорт берёт чек-лист по
явному `checklist_id` (по умолчанию официальный v1, **не** «активный») и последнюю оценку по нему;
оценки v2, архивирование, апелляции и их решения на него не влияют (в файл идут исходные ответы модели),
`mock`-оценки он отвергает. Единственный риск — новые v1-оценки диалогов, у которых их не было, поэтому
демо делается в отдельном файле. `results/` скрипт не открывает.

```powershell
cd backend
Copy-Item cqa.db demo.db                      # demo.db в .gitignore (*.db)
$env:DB_PATH = "demo.db"                      # перекрывает DB_PATH из .env
$env:LLM_PROVIDER = "mock"                    # без платных вызовов; не задавайте — возьмётся из .env
python -m app.seed_demo --dry-run             # план, число вызовов модели, оценка стоимости; ничего не пишет
python -m app.seed_demo --add-criterion       # заполнить; v1 остаётся активной
uvicorn app.main:app --port 8000
```

Флаги: `--dialogs id1,id2`, `--limit 8`, `--activate-v2` (сделать v2 активной), `--skip-evaluate` (без вызовов
модели, апелляции по имеющимся оценкам), `--appeals-only` (только апелляции, без v2 и оценок), `--yes` (не
спрашивать подтверждение), `--db путь`. Если провайдер не `mock`, скрипт печатает число диалогов и стоимость и
без `--yes` спрашивает подтверждение. Ошибка по одному диалогу не прерывает остальные.
Порядок: v1-оценки → апелляции по v1 → переоценка по v2 → открытые апелляции. Открытые создаются после
переоценки: любая новая оценка диалога переводит его открытые апелляции в «устарела», иначе они
не остались бы открытыми. Откройте `#/checklists/compare/cl-chat-quality-v1/cl-chat-quality-v2`, `#/appeals`.
Сброс: удалите `demo.db` и снова скопируйте `cqa.db`.

## Смена провайдера модели (`backend/.env`)

| Провайдер | Настройки |
|---|---|
| mock (по умолчанию) | `LLM_PROVIDER=mock` |
| OpenAI | `LLM_PROVIDER=openai`, `LLM_API_KEY=...`, `LLM_MODEL=...` |
| Gemini | `LLM_PROVIDER=openai`, `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, ключ, модель |
| Ollama | `LLM_PROVIDER=openai`, `LLM_BASE_URL=http://localhost:11434/v1`, `LLM_MODEL=...` (ключ не нужен) |

После правки `.env` перезапустите uvicorn. Проверка: `GET /api/health`.

## Стоимость одной оценки

Каждая оценка — один вызов модели на диалог (все критерии сразу) и не более одного повтора,
если ответ не прошёл валидацию. В `evaluation.usage` хранится сумма по всем вызовам:
`calls`, `input_tokens`, `output_tokens`, `duration_ms`, `retried`, `cost_usd`, где
`cost_usd = input_tokens / 1e6 × PRICE_IN_PER_MTOK + output_tokens / 1e6 × PRICE_OUT_PER_MTOK`
(задайте в `.env` цены выбранной модели).
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
  JS/Python-кейсы находятся в отдельном QA-наборе вне этого репозитория.

## REST

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/conversations?group_id=` | диалоги |
| GET | `/api/conversations/{id}` | диалог |
| GET | `/api/conversations/{id}/audio` | поток записи с Range; разрешение HTML-страницы плеера |
| POST | `/api/datasets/import` `{group_id}` | импорт у организаторов → `{imported, total, skipped}` |
| GET | `/api/checklists` | все версии |
| GET | `/api/results/export?group_id=DEV&split=dev&team_name=kudafest` | файл results.json в формате организаторов |
| GET | `/api/checklists/compare?from=&to=` | изменения критериев и сравнение оценок двух версий |
| POST | `/api/checklists` `{name, criteria, family_id?, activate?}` | новая версия (version = max+1) |
| POST | `/api/checklists/{id}/activate` | сделать активной |
| POST | `/api/evaluations` `{conversation_id, checklist_id?}` | оценить (по умолчанию активной версией) |
| GET | `/api/evaluations` | последние оценки по диалогам |
| GET | `/api/evaluations/history?group_id=` | последние оценки каждого диалога по каждой версии |
| GET | `/api/evaluations/cost` | сводная стоимость оценок |
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

## Проверка

Экспорт и проверка сдаваемого JSON описаны в [порядке сдачи](../README.md#submit-organizer-results).
В PowerShell из `backend/`: `python -m app.submission --group DEV --split dev --team kudafest --evaluate`.
Для экспорта сохранённых результатов уберите `--evaluate`. Проверка:
`python -m app.submission --group DEV --split dev --validate ..\results\dev\results.json`.
Апелляции не подменяют исходные AI-ответы.

`AUDIO_ALLOWED_HOSTS` перечисляет дополнительные доверенные домены аудио. Для текущих страниц
организаторов используется `freedomholdingcorporation.crm11.dynamics.com`. Прокси не принимает
произвольный URL от браузера, разрешает HTTPS и проверяет домены, адреса и каждое перенаправление.

Тесты API, фронтенда и браузерные сценарии хранятся вне рабочего дерева.
Инструкции по отдельному QA-набору приведены в [корневом README](../README.md#quality-assurance).
Тесты используют временные базы и mock-провайдеров, без платных вызовов и изменения `cqa.db`.

## Безопасность

`.env`, `*.db` и `docs/dev.json` в `.gitignore`. В логах нет ключей, транскриптов и `audio_url`,
только id диалогов, токены, время и стоимость. Авторизации нет (прототип).

## Organizer proxy and local snapshot

Configure `ORGANIZER_API_URL` in `backend/.env` with the organizer's GET endpoint.
The URL can include `{group_id}`; otherwise the backend adds/replaces the query parameter.
No organizer endpoint is bundled with this repository.

```sh
# From the repository root (macOS/Linux):
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Set ORGANIZER_API_URL, then:
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
curl 'http://localhost:8000/api/fetch-dataset'
curl 'http://localhost:8000/api/dialogues'
```

- `GET /api/fetch-dataset?group_id=DEV` calls the organizer server-side and atomically
  saves `{group_id, total_records, records, skipped}` to `backend/dataset.json`.
  `DEV` is the default; use another group for the control batch. The response is the saved object.
- `GET /api/dialogues` returns the saved `records` array without contacting the organizer,
  including after a server restart. A missing snapshot returns 404.
- `DATASET_PATH` overrides the snapshot location (relative paths resolve under `backend/`).
- Invalid individual records are omitted and counted in `skipped`, matching the existing importer.
  Malformed envelopes, upstream HTTP errors and timeouts return 502 and preserve the last snapshot.
- The frontend is served at the same origin, so requests to `/api/dialogues` need no browser CORS workaround.
  The existing `/api/datasets/import` continues to import into SQLite for the current UI;
  the snapshot endpoint is independent of that workflow.
- DEV is expected to contain 65 dialogues; inspect `total_records`, `records.length`, and `skipped`
  to verify the live batch. Other group sizes are accepted.

Live organizer verification requires a configured URL; automated tests use a 65-dialogue fixture.

## Strict OpenAI evaluations

Set these values in `backend/.env` (never commit the actual key):

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=gpt-6-luna
LLM_API_KEY=your_key
LLM_BASE_URL=https://api.openai.com/v1
PRICE_IN_PER_MTOK=0.10
PRICE_OUT_PER_MTOK=0.50
```

The client sends `response_format.type=json_schema` with `strict=true` and
`max_completion_tokens`; it never silently falls back to unstructured output.
The schema preserves the current application contract (`answer`, `explanation`,
`evidence`, `na_reason`). Semantic validation additionally checks criterion IDs,
allowed answers, N/A conditions and evidence. Explanations use the dialogue language.
Refusals and truncated output preserve token usage for the evaluator's bounded retry.
Usage and the estimated USD cost are stored with each successful evaluation and logged
without transcript text or API credentials. Rates above are specification assumptions.

Request format reference: [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
Other OpenAI-compatible servers must support this schema format and completion token parameter.

## Scoring scales

Checklist criteria submitted to `POST /api/checklists` can specify
`evaluation_type: "binary"`, `"scale_10"`, or `"scale_20"`. Binary criteria use
`yes`/`no`; explicit scales accept every integer from zero through 10 or 20.
For example, 6/10 with a 30-point weight earns 18 points before N/A redistribution.
The API normalizes these names into the existing `type` / `scale_steps` representation,
so prompts, reviewer choices, the checklist editor and stored evaluations remain compatible.
Existing custom step scales and historical checklist versions are preserved.

N/A removes the criterion from the applicable weight sum; remaining weights are multiplied
by `100 / applicable_weight`. Missing or invalid answers earn zero and retain their weight.
Gross violations are independent flags and do not subtract points. The final total is
rounded once to two decimals and bounded to 0–100. If every scored criterion is N/A,
the result is `null` (unscorable), rather than awarding a score without applicable criteria.
Negative and nonfinite weights are rejected when saving a checklist.

## Result UI, appeals and control readiness

- The scorecard shows model, input/output tokens and estimated USD cost to six decimal places.
  The total score displays two decimals. Actual cost depends on the configured rates and usage.
- Evidence chips scroll to and highlight the message and, when audio is present, seek to its
  timestamp. MM:SS values are direct audio offsets; ISO timestamps are relative to the first
  parseable timestamp. Quotes are escaped before display. Playback remains user-controlled.
- Reviewer forms show the operator comment, original rationale and a live total preview.
  Confirmation requires a note. Scores and appeal states refresh from the server after review
  and reevaluation. Duplicate submissions are disabled while a request is pending.
- The criterion editor supports IDs, definitions, weights, binary answers, complete 0–10/0–20
  integer scales, custom steps, N/A conditions and violation flags. Saving creates a version;
  existing evaluations are preserved. Specification-style API fields `description` and
  `evaluation_type` are normalized to `question`, `type`, and `scale_steps` for storage.
- Evaluation items also expose `status`, `raw_score`, `rationale`, and `na_justification` aliases.
  Evidence indices refer to exact transcript messages; `evidence_quotes` holds cited text.

### T+23h control-batch runbook

1. Confirm the backend is running and `/api/health` reports the configured OpenAI model.
2. Open **Диалоги**, enter the released group ID under **Группа датасета**, then select
   **Загрузить группу**. Check the imported, reported and skipped counts in the notification.
   Group IDs are sent as data and query-encoded; the backend URL does not need a code change.
3. In **Чек-листы**, edit or swap the requested criteria. Keep scored weights at 100;
   save and activate the new version. The editor reports invalid weights and duplicate IDs.
4. Select **Применить к диалогам**, choose the control dialogues and run the evaluations.
   Import itself does not start paid evaluations. Review warnings, evidence and per-evaluation costs.
5. Open a result, submit an appeal, then use **Апелляции** to confirm or override it with a note.
   Check the preview, original score, saved reviewer decision and updated final score.

API alternative for a background batch (replace CONTROL with the released ID):

```sh
curl -X POST http://localhost:8000/api/datasets/import \
  -H 'Content-Type: application/json' -d '{"group_id":"CONTROL"}'
curl 'http://localhost:8000/api/conversations?group_id=CONTROL'
# Pass the returned conversation_id values and your checklist ID:
curl -X POST http://localhost:8000/api/evaluations/batch \
  -H 'Content-Type: application/json' \
  -d '{"conversation_ids":["CONTROL_DIALOGUE_ID"],"checklist_id":"CHECKLIST_ID"}'
# GET /api/jobs/JOB_ID returns progress, errors and accumulated estimated cost.
```

The UI accepts `?api=...&group=...&mock=0` or Dynamics web resource `?data=` parameters.
Keep API keys exclusively on the backend. For a Dynamics deployment on a different origin,
configure that exact trusted origin in backend CORS before embedding; localhost origins are
currently allowed for development. Signed audio URLs must remain valid for playback.

Browser/API regression suites and screenshots are maintained in the external QA folder.
Live organizer playback still depends on the signed audio URL remaining valid.

### Batch evaluation from the dialogue list

The **Диалоги** page provides individual checkboxes, a header checkbox that selects the
currently shown rows, and a checklist selector. **Оценить выбранные** evaluates the selected
IDs, including selections hidden by a later filter. **Оценить все** evaluates every dialogue
in the loaded group regardless of filters. Evaluation creates a new result for already-scored
conversations. Controls are disabled while a batch runs; progress and success/error counts are
shown. Requests run sequentially and continue after individual failures.
