# Conversation Quality Analytics

A FastAPI + SQLite prototype with a modular vanilla JavaScript interface for evaluating
RU, KZ and EN support chats and call transcripts. No login is required.

## Run locally

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
cp backend/.env.example backend/.env  # only if .env does not already exist
# Fill backend/.env with the OpenAI key and organizer URL.
.venv/bin/python -m uvicorn app.main:app --app-dir backend --port 8000
```

Open <http://localhost:8000>. In **Диалоги**, use **Загрузить группу** to import DEV
or the released control group. Open a dialogue and select **Оценить**. The result shows
scores, rationale, evidence, tokens and estimated cost. Voice evidence links seek the recording.

On **Диалоги**, select rows with checkboxes and choose **Оценить выбранные**, or use
**Оценить все** for every dialogue in the loaded group (including filtered-out rows).
Choose the checklist above the table. Progress and success/error counts appear during the batch.

Use **Оспорить** to submit an appeal; review it in **Апелляции**. A reviewer can retain
or change the answer with a required note; the preview and final total recalculate.
In **Чек-листы**, create or edit criteria, save a version, activate it, and apply it to
selected dialogues. Existing evaluations retain their original checklist version.

## Progress

- [x] 1: organizer proxy, local snapshot and dialogue endpoints; live DEV verified (65 records).
- [x] 2: strict JSON schema, parser, token/cost logging; live `gpt-6-luna` evaluation verified.
- [x] 3: full integer scales, proportional N/A redistribution, independent violation flags and rounding.
- [x] 4: responsive result components, transcript/audio evidence navigation and cost display.
- [x] 5: operator appeals, reviewer preview/override, stored decisions and recalculation.
- [x] 6: dynamic checklist editing and group import; control-group routing tested with fixtures.

Automated API and UI component/handler tests pass. Interactive browser layout and real audio
playback still need a manual check: no connected browser was available during implementation.
The unreleased secret control dataset has not been requested.

## Verify

```sh
.venv/bin/python -m pytest backend/tests -q
node frontend/test/scoring.test.js
node frontend/test/results.test.js
node frontend/test/workflows.test.js
node frontend/test/batch.test.js
```

See [backend documentation](backend/README.md) for configuration, REST endpoints, cost assumptions,
Windows commands and the T+23h control-batch runbook. Credentials and local datasets are excluded from Git.
