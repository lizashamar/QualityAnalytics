"""FastAPI-приложение CQA: REST по контракту frontend/js/api.js (под /api) + статика frontend/.

Запуск из backend/:  uvicorn app.main:app --port 8000
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Literal, Union

from fastapi import APIRouter, FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, model_validator

from . import services
from .dataset import read_dataset, save_dataset
from .organizers import fetch_dataset
from .config import Settings, load_settings
from .db import Database
from .jobs import JobManager
from .llm import LLMClient, LLMError, make_client
from .organizers import OrganizerError
from .scoring import normalize_criterion, validate_checklist
from .services import ApiError

log = logging.getLogger("cqa")

Number = Union[int, float]


class UTF8JSONResponse(JSONResponse):
    """Явный charset: иначе Windows PowerShell 5.1 (Invoke-RestMethod) читает кириллицу как ISO-8859-1."""
    media_type = "application/json; charset=utf-8"


# ---------- модели запросов ----------
class CriterionIn(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def normalize_scale(cls, data):
        if not isinstance(data, dict):
            return data
        data = {**data}
        if "description" in data and "question" not in data:
            data["question"] = data["description"]
        if "evaluation_type" not in data:
            return data
        data.setdefault("section", "Качество")
        if data.get("allow_na"):
            data.setdefault("na_condition", "Критерий неприменим к обстоятельствам диалога; объясните причину.")
        if data["evaluation_type"] not in ("binary", "scale_10", "scale_20"):
            raise ValueError("evaluation_type: binary | scale_10 | scale_20")
        normalized = normalize_criterion(data)
        # Persist the established contract so the editor and historical snapshots stay compatible.
        normalized.pop("evaluation_type", None)
        return normalized

    id: str = Field(min_length=1)
    section: str = ""
    title: str = ""
    question: str = ""
    type: Literal["yesno", "scale"] = "yesno"
    weight: Number = Field(default=0, ge=0, allow_inf_nan=False)
    allow_na: bool = False
    na_condition: str = ""
    scale_steps: list[Number] = []
    scale_labels: dict[str, str] = {}
    is_flag: bool = False


class ChecklistIn(BaseModel):
    name: str = Field(min_length=1)
    description: str = ""
    criteria: list[CriterionIn]
    family_id: str | None = None
    based_on: str | None = None
    activate: bool = True


class EvaluationIn(BaseModel):
    conversation_id: str
    checklist_id: str | None = None


class BatchIn(BaseModel):
    checklist_id: str | None = None
    conversation_ids: list[str] | None = None
    all: bool = False
    only_missing: bool = False


class AppealIn(BaseModel):
    evaluation_item_id: str | None = None
    conversation_id: str | None = None
    criterion_id: str | None = None
    comment: str = ""


class ResolveIn(BaseModel):
    new_answer: Union[str, Number]
    reason: str = ""


class ImportIn(BaseModel):
    group_id: str = Field(min_length=1, max_length=128)


FIELD_RU = {"missing": "обязательное поле", "string_too_short": "не может быть пустым", "literal_error": "недопустимое значение"}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    if not logging.getLogger().handlers:
        logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db = Database(settings.db_file)
    db.migrate()
    jobs = JobManager()
    llm_lock = threading.Lock()
    llm_holder: dict[str, LLMClient] = {}

    def llm() -> LLMClient:
        with llm_lock:
            if "c" not in llm_holder:
                llm_holder["c"] = make_client(settings)
            return llm_holder["c"]

    app = FastAPI(title="CQA API", version="1.0", default_response_class=UTF8JSONResponse)
    app.state.settings, app.state.db, app.state.jobs = settings, db, jobs
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
                       allow_methods=["*"], allow_headers=["*"], allow_credentials=True)

    @app.exception_handler(ApiError)
    async def _api_error(_: Request, e: ApiError):
        return UTF8JSONResponse({"detail": e.message}, status_code=e.status)

    @app.exception_handler(LLMError)
    async def _llm_error(_: Request, e: LLMError):
        return UTF8JSONResponse({"detail": f"Ошибка модели: {e}"}, status_code=502)

    @app.exception_handler(OrganizerError)
    async def _org_error(_: Request, e: OrganizerError):
        return UTF8JSONResponse({"detail": str(e)}, status_code=502)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        parts = []
        for err in e.errors():
            loc = ".".join(str(x) for x in err.get("loc", []) if x != "body")
            parts.append(f"{loc or 'тело'}: {FIELD_RU.get(err.get('type'), err.get('msg'))}")
        return UTF8JSONResponse({"detail": "Некорректный запрос — " + "; ".join(parts)}, status_code=400)

    api = APIRouter(prefix="/api")

    @api.get("/fetch-dataset")
    def fetch_saved_dataset(group_id: str = Query(default="DEV", min_length=1, max_length=128)):
        group_id = group_id.strip()
        if not group_id:
            raise ApiError(400, "group_id не может быть пустым")
        data = fetch_dataset(settings.organizer_api_url, group_id)
        save_dataset(settings.dataset_file, data)
        return data

    @api.get("/dialogues")
    def saved_dialogues():
        return read_dataset(settings.dataset_file)["records"]

    # --- диалоги ---
    @api.get("/conversations")
    def list_conversations(group_id: str | None = None):
        return db.list_conversations(group_id or None)

    @api.get("/conversations/{conversation_id}")
    def get_conversation(conversation_id: str):
        c = db.get_conversation(conversation_id)
        if not c:
            raise ApiError(404, f"Диалог «{conversation_id}» не найден")
        return c

    @api.post("/datasets/import")
    def import_dataset(body: ImportIn):
        return services.import_dataset(db, settings, body.group_id.strip())

    # --- чек-листы ---
    @api.get("/checklists")
    def list_checklists():
        return db.list_checklists()

    @api.post("/checklists")
    def save_checklist(body: ChecklistIn):
        criteria = [c.model_dump() for c in body.criteria]
        errors = validate_checklist(criteria)
        if errors:
            raise ApiError(400, " ".join(errors))
        return db.create_checklist_version(name=body.name.strip(), description=body.description, criteria=criteria,
                                           family_id=body.family_id, based_on=body.based_on, activate=body.activate)

    @api.post("/checklists/{checklist_id}/activate")
    def activate_checklist(checklist_id: str):
        cl = db.activate_checklist(checklist_id)
        if not cl:
            raise ApiError(404, f"Чек-лист «{checklist_id}» не найден")
        return cl

    # --- оценки ---
    @api.post("/evaluations")
    def run_evaluation(body: EvaluationIn):
        return services.run_evaluation(db, settings, llm(), body.conversation_id, body.checklist_id)

    @api.get("/evaluations")
    def list_evaluations(group_id: str | None = None, latest: int = 1):
        return [services.evaluation_out(e) for e in db.list_latest_evaluations(group_id or None)]

    @api.get("/evaluations/latest")
    def latest_evaluation(conversation_id: str, checklist_id: str | None = None):
        ev = db.latest_evaluation(conversation_id, checklist_id or None)
        if not ev:
            raise ApiError(404, "Оценки нет")
        return services.evaluation_out(ev)

    @api.post("/evaluations/batch")
    def batch(body: BatchIn):
        if body.conversation_ids:
            ids = list(dict.fromkeys(body.conversation_ids))
        elif body.all:
            ids = [c["conversation_id"] for c in db.list_conversations()]
        else:
            raise ApiError(400, "Укажите conversation_ids или all: true")
        if body.only_missing:
            done = {e["conversation_id"] for e in db.list_latest_evaluations()}
            ids = [i for i in ids if i not in done]
        cl = db.get_checklist(body.checklist_id) if body.checklist_id else db.active_checklist()
        if not cl:
            raise ApiError(404, "Чек-лист не найден")
        client = llm()  # ошибки конфигурации модели — сразу, до запуска фона
        job_id = jobs.start(ids, lambda cid: services.run_evaluation(db, settings, client, cid, cl["id"]), settings.eval_concurrency)
        return {"job_id": job_id, "total": len(ids), "checklist_id": cl["id"]}

    @api.get("/evaluations/{evaluation_id}")
    def get_evaluation(evaluation_id: str):
        return services.get_evaluation(db, evaluation_id)

    @api.get("/jobs/{job_id}")
    def get_job(job_id: str):
        j = jobs.get(job_id)
        if not j:
            raise ApiError(404, f"Задача «{job_id}» не найдена")
        return j

    # --- апелляции ---
    @api.get("/appeals")
    def list_appeals():
        return [services.appeal_out(a) for a in db.list_appeals()]

    @api.post("/appeals")
    def create_appeal(body: AppealIn):
        return services.create_appeal(db, evaluation_item_id=body.evaluation_item_id, conversation_id=body.conversation_id,
                                      criterion_id=body.criterion_id, comment=body.comment)

    @api.post("/appeals/{appeal_id}/resolve")
    def resolve_appeal(appeal_id: str, body: ResolveIn):
        return services.resolve_appeal(db, appeal_id, body.new_answer, body.reason)

    @api.get("/health")
    def health():
        return {"ok": True, "llm_provider": settings.llm_provider, "llm_model": settings.llm_model,
                "organizer_api": bool(settings.organizer_api_url)}

    app.include_router(api)

    # Фронтенд с того же origin: config.local.js переключает его с mock на этот API.
    @app.get("/config.local.js", include_in_schema=False)
    def config_local():
        js = "window.CQA_CONFIG = Object.assign({ API_BASE: location.origin + '/api', USE_MOCK: false }, window.CQA_CONFIG || {});\n"
        return Response(js, media_type="application/javascript", headers={"Cache-Control": "no-store"})

    front = Path(settings.frontend_dir)
    if front.is_dir():
        app.mount("/", StaticFiles(directory=str(front), html=True), name="frontend")
    return app


app = create_app()
