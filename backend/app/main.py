from __future__ import annotations

from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import Settings
from app.errors import (
    AIConfigurationError,
    AIOutputError,
    AIProviderError,
    AIRateLimitError,
    AITimeoutError,
    CallConflict,
    CallNotFound,
    DatabaseUnavailable,
    RepositoryError,
)
from app.repositories.base import CallRepository
from app.repositories.factory import create_repository
from app.schemas import (
    CallCreate,
    CallDetailResponse,
    CallListResponse,
    CallResponse,
    CloseCallRequest,
    StageDefinition,
    StageResultResponse,
    StageSaveRequest,
    SuggestionRequest,
    SuggestionResponse,
)
from app.services.ai import AIService


def _problem(status: int, code: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, "code": code})


def create_app(
    settings: Settings | None = None,
    repository: CallRepository | None = None,
    ai_service: AIService | None = None,
) -> FastAPI:
    app_settings = settings or Settings.from_env()
    call_repository = repository or create_repository(app_settings)
    call_repository.initialize()
    suggestion_service = ai_service or AIService(app_settings)

    app = FastAPI(title="CallGuide API", version="1.0.0", description="A stage-based cold-call companion API.")
    app.state.settings = app_settings
    app.state.repository = call_repository
    app.state.ai_service = suggestion_service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(app_settings.frontend_origins),
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(CallNotFound)
    async def call_not_found_handler(_: Request, __: CallNotFound):
        return _problem(404, "CALL_NOT_FOUND", "This call could not be found.")

    @app.exception_handler(CallConflict)
    async def call_conflict_handler(_: Request, __: CallConflict):
        return _problem(409, "CALL_ALREADY_COMPLETED", "This call is complete and cannot be edited.")

    @app.exception_handler(DatabaseUnavailable)
    async def database_unavailable_handler(_: Request, __: DatabaseUnavailable):
        return _problem(503, "DATABASE_UNAVAILABLE", "The database could not complete this request. No success was recorded; please retry.")

    @app.exception_handler(RepositoryError)
    async def repository_error_handler(_: Request, __: RepositoryError):
        return _problem(503, "DATABASE_UNAVAILABLE", "The database could not complete this request. No success was recorded; please retry.")

    @app.exception_handler(AIConfigurationError)
    async def ai_configuration_handler(_: Request, __: AIConfigurationError):
        return _problem(503, "AI_NOT_CONFIGURED", "AI suggestions are not configured on this backend. Set GEMINI_API_KEY to enable them.")

    @app.exception_handler(AIRateLimitError)
    async def ai_rate_limit_handler(_: Request, __: AIRateLimitError):
        return _problem(429, "AI_RATE_LIMITED", "The AI provider is rate-limited. Try again shortly; the call can continue without a suggestion.")

    @app.exception_handler(AITimeoutError)
    async def ai_timeout_handler(_: Request, __: AITimeoutError):
        return _problem(504, "AI_TIMEOUT", "The AI request timed out. The call can continue without a suggestion.")

    @app.exception_handler(AIOutputError)
    async def ai_output_handler(_: Request, __: AIOutputError):
        return _problem(502, "AI_INVALID_OUTPUT", "The AI provider returned an unreadable suggestion. Please try again.")

    @app.exception_handler(AIProviderError)
    async def ai_provider_handler(_: Request, __: AIProviderError):
        return _problem(502, "AI_PROVIDER_ERROR", "The AI provider could not complete that suggestion. Please try again.")

    def get_repository(request: Request) -> CallRepository:
        return request.app.state.repository

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/api/stages", response_model=list[StageDefinition])
    def stages(repo: CallRepository = Depends(get_repository)):
        return repo.list_stages()

    @app.post("/api/calls", response_model=CallResponse, status_code=201)
    def create_call(payload: CallCreate, repo: CallRepository = Depends(get_repository)):
        return repo.create_call(payload.prospect_name, payload.company_name)

    @app.put("/api/calls/{call_id}/stages/{stage_number}", response_model=StageResultResponse)
    def save_stage(
        call_id: UUID,
        payload: StageSaveRequest,
        stage_number: int = Path(ge=1, le=8),
        repo: CallRepository = Depends(get_repository),
    ):
        if payload.advance_to is not None and not stage_number <= payload.advance_to <= stage_number + 1:
            raise HTTPException(status_code=422, detail="A stage can stay in place or advance only to the next stage.")
        stage = next((item for item in repo.list_stages() if item["stage_number"] == stage_number), None)
        if stage is None:
            raise HTTPException(status_code=503, detail="Stage guidance is unavailable. Please try again later.")
        if payload.selected_outcome is not None and payload.selected_outcome not in stage["outcome_options"]:
            raise HTTPException(status_code=422, detail="Choose an outcome available for this stage.")
        return repo.save_stage(
            str(call_id), stage_number, payload.selected_outcome, payload.prospect_words, payload.advance_to
        )

    @app.post("/api/calls/{call_id}/close", response_model=CallResponse)
    def close_call(call_id: UUID, payload: CloseCallRequest, repo: CallRepository = Depends(get_repository)):
        next_step_at = payload.next_step_at.isoformat() if payload.next_step_at else None
        return repo.close_call(str(call_id), payload.final_outcome, payload.next_step, next_step_at)

    @app.get("/api/calls", response_model=CallListResponse)
    def list_calls(
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=25, ge=1, le=100),
        search: str | None = Query(default=None, max_length=160),
        status: Literal["in_progress", "completed"] | None = None,
        outcome: Literal["meeting_booked", "callback_agreed", "information_sent", "not_interested", "no_next_step", "other"] | None = None,
        repo: CallRepository = Depends(get_repository),
    ):
        calls = repo.list_calls()
        if search and search.strip():
            term = search.strip().casefold()
            calls = [
                call for call in calls
                if term in f"{call.get('prospect_name') or ''} {call.get('company_name') or ''}".casefold()
            ]
        if status:
            calls = [call for call in calls if call["status"] == status]
        if outcome:
            calls = [call for call in calls if call.get("final_outcome") == outcome]
        total = len(calls)
        offset = (page - 1) * page_size
        return {"items": calls[offset:offset + page_size], "total": total, "page": page, "page_size": page_size}

    @app.get("/api/calls/{call_id}", response_model=CallDetailResponse)
    def get_call(call_id: UUID, repo: CallRepository = Depends(get_repository)):
        call = repo.get_call(str(call_id))
        if call is None:
            raise CallNotFound()
        return call

    @app.post("/api/ai/suggest-response", response_model=SuggestionResponse)
    async def suggest_response(
        payload: SuggestionRequest,
        request: Request,
        repo: CallRepository = Depends(get_repository),
    ):
        stage = next((item for item in repo.list_stages() if item["stage_number"] == payload.stage_number), None)
        if stage is None:
            raise HTTPException(status_code=503, detail="Stage guidance is unavailable. Please try again later.")
        return await request.app.state.ai_service.suggest(stage, payload)

    return app


app = create_app()
