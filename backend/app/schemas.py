from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

FinalOutcome = Literal[
    "meeting_booked",
    "callback_agreed",
    "information_sent",
    "not_interested",
    "no_next_step",
    "other",
]
CallStatus = Literal["in_progress", "completed"]


class CallCreate(BaseModel):
    prospect_name: str | None = Field(default=None, max_length=160)
    company_name: str | None = Field(default=None, max_length=160)

    @field_validator("prospect_name", "company_name")
    @classmethod
    def clean_optional_text(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else None
        return cleaned or None


class StageDefinition(BaseModel):
    stage_number: int = Field(ge=1, le=8)
    name: str
    purpose: str
    talk_track: str
    response_patterns: list[str]
    outcome_options: list[str]


class StageSaveRequest(BaseModel):
    selected_outcome: str | None = Field(default=None, max_length=120)
    prospect_words: str = Field(default="", max_length=5000)
    advance_to: int | None = Field(default=None, ge=1, le=8)


class StageResultResponse(BaseModel):
    id: UUID
    call_id: UUID
    stage_number: int = Field(ge=1, le=8)
    selected_outcome: str | None
    prospect_words: str
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CallResponse(BaseModel):
    id: UUID
    prospect_name: str | None
    company_name: str | None
    status: CallStatus
    current_stage: int = Field(ge=1, le=8)
    furthest_stage_reached: int = Field(ge=1, le=8)
    final_outcome: FinalOutcome | None
    next_step: str | None
    next_step_at: datetime | None
    started_at: datetime
    ended_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CallDetailResponse(CallResponse):
    stage_results: list[StageResultResponse]


class CallListResponse(BaseModel):
    items: list[CallResponse]
    total: int
    page: int
    page_size: int


class CloseCallRequest(BaseModel):
    final_outcome: FinalOutcome
    next_step: str | None = Field(default=None, max_length=1000)
    next_step_at: datetime | None = None

    @field_validator("next_step")
    @classmethod
    def clean_next_step(cls, value: str | None) -> str | None:
        cleaned = value.strip() if value else None
        return cleaned or None

    @field_validator("next_step_at")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError("next_step_at must include a timezone")
        return value


class SuggestionRequest(BaseModel):
    stage_number: int = Field(ge=1, le=8)
    prospect_words: str = Field(min_length=1, max_length=5000)
    selected_outcome: str | None = Field(default=None, max_length=120)
    conversation_context: str | None = Field(default=None, max_length=2000)

    @field_validator("prospect_words")
    @classmethod
    def require_nonblank_words(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("prospect_words must not be blank")
        return value


class SuggestionResponse(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    suggested_response: str = Field(min_length=1, max_length=500)
    follow_up_question: str = Field(max_length=300)
    reasoning: str = Field(max_length=300)
    next_stage_hint: str = Field(max_length=300)
