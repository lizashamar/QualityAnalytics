# Conversation Quality Analytics | Team: kudafest

FastAPI + SQLite with a vanilla JavaScript interface for evaluating RU, KZ and EN support chats
and call transcripts. The prototype does not require login or a frontend build step.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env  # only if .env does not already exist
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
```

Configure the model provider, API key and organizer URL in `backend/.env`.
Open <http://localhost:8000>. See [backend documentation](backend/README.md) for Windows setup,
configuration, REST endpoints, cost accounting and the control-batch runbook.
Credentials, local datasets and databases are excluded from Git.

## Workflows

- **Обзор:** quality metrics, observed trends, review priorities and links to filtered conversations.
- **Диалоги:** search, shareable language/channel/status/quality/date filters, sorting and 25-row
  pages. Selections persist across filtering and pages. **Оценить выбранные** processes selected
  IDs; **Оценить все** processes every conversation in the loaded group.
- **Conversation details:** transcript search, evidence highlighting, audio seeking and scores
  with explanations, checklist version and reviewer history. Cmd/Ctrl+K opens quick navigation.
- **Апелляции:** submit a criterion dispute, then retain or change its answer with a required note.
  The preview and final score recalculate; reevaluation expires pending disputes on old results.
- **Чек-листы:** edit criteria, scales, weights, N/A conditions and independent violation flags.
  Saving creates a version; existing evaluations retain their original methodology.
  Reevaluate previously scored, selected or the first N conversations with the saved version.
  Compare versions to inspect criterion changes, score differences and underlying conversations;
  reviewer adjustments remain separate from the original scores.

Both themes use the shared [design system](DESIGN.md) and locally served CoFo Sans font.
The API workspace uses organizer datasets and persisted AI evaluations. The synthetic demo is
separate and never supplies submission scores.

## Submit organizer results

The exporter uses the unchanged official checklist, original AI answers, exact dataset IDs,
one-based evidence indices and the organizer's JSON 1.0 schema. Set `TEAM_NAME=kudafest` in
`backend/.env`, or pass `--team`. From the repository root:

```sh
PYTHONPATH=backend .venv/bin/python -m app.import_dataset DEV
PYTHONPATH=backend .venv/bin/python -m app.submission --group DEV --split dev --team kudafest --evaluate
PYTHONPATH=backend .venv/bin/python -m app.submission --group DEV --split dev --validate results/dev/results.json
```

`--evaluate` sends the selected group to your configured model API and saves new evaluations.
Without it, export only reads saved scores and does not call the model.
The DEV file must contain 65 records (60 chats and 5 calls). After the control dataset is released,
replace `CONTROL_GROUP` with its actual API group ID:

```sh
PYTHONPATH=backend .venv/bin/python -m app.import_dataset CONTROL_GROUP
PYTHONPATH=backend .venv/bin/python -m app.submission --group CONTROL_GROUP --split prod --team kudafest --evaluate
PYTHONPATH=backend .venv/bin/python -m app.submission --group CONTROL_GROUP --split prod --validate results/prod/results.json
```

PROD requires exactly 10 records. Its results file is generated only from the real control dataset;
there are no placeholder control scores. In **Диалоги → Сдать результаты организаторам**, the same
exporter can download `results.json`; save it under `results/dev/` or `results/prod/`.

Failed, missing, stale or unsupported evaluations remain explicit `status: "error"` records with
`score: null`. An export containing errors returns exit code 1; invalid configuration, counts or
schema return 2 and do not overwrite the output file. Inspect failures and reevaluate before
submission. Validation checks coverage, value types, evidence bounds, recomputed totals and the
critical flag. Demo evaluations and modified checklists cannot be exported as successful scores.

Commit and push both result files to the public repository before the organizer deadline, and
confirm they are visible on GitHub. Exporting or committing locally is not submission.

## Synthetic demo

Open <http://localhost:8000/?mock=1#/overview>, or select **Открыть синтетические сценарии**
from the API overview. The demo contains 11 conversations, including 5 mixed KZ/RU scenarios,
a bilingual checklist and 5 seeded appeals. Existing demo storage is extended without resetting
user records or the active checklist. API datasets remain separate.

Demo audio is a generated test signal, not spoken dialogue. The player supports seeking,
position preservation, source retry and timestamp mismatch warnings.
Real call audio is streamed through the backend, which resolves organizer HTML player pages,
supports byte ranges and refreshes expired cached media URLs. Additional media hosts must be
listed in `AUDIO_ALLOWED_HOSTS`; local/private network destinations are rejected.
[Scenario verification and remaining improvements](docs/design/SCENARIOS-AUDIO-QA.md) describe
what was checked and what still needs real speech data.

## Quality assurance

Tests, browser-only dependencies, screenshots and historical reference material are maintained
in a separate local QA folder, outside this source checkout. They are intentionally excluded
from this commit. The QA folder contains a source snapshot, checksummed archive, test dependencies
and a runner that links the suites to the current application code.

On this laptop the folder is `../QualityAnalytics-QA-2026-11-07`. From the repository root:

```sh
../QualityAnalytics-QA-2026-11-07/run-tests.sh "$PWD"
```

If the checkout or QA folder moves, pass the new checkout path to that runner. Browser setup and
commands are documented in the QA folder's README. No test dependency is required to run the app.
