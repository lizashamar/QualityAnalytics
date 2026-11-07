# Conversation Quality Analytics

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
[Product context](PRODUCT.md) describes data boundaries and supported workflows.

## Synthetic demo

Open <http://localhost:8000/?mock=1#/overview>, or select **Открыть синтетические сценарии**
from the API overview. The demo contains 11 conversations, including 5 mixed KZ/RU scenarios,
a bilingual checklist and 5 seeded appeals. Existing demo storage is extended without resetting
user records or the active checklist. API datasets remain separate.

Demo audio is a generated test signal, not spoken dialogue. The player supports seeking,
position preservation, source retry and timestamp mismatch warnings.
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
