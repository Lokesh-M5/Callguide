from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import AIProviderError, DatabaseUnavailable
from app.main import create_app
from app.repositories.sqlite import SQLiteCallRepository
from app.services.ai import AIService


def settings_for(path: str, api_key: str = "") -> Settings:
    return Settings(
        database_path=path,
        supabase_url="",
        supabase_service_role_key="",
        gemini_api_key=api_key,
        llm_model="gemini-test-model",
        frontend_origins=("http://localhost:5173",),
    )


def build_client(tmp_path, ai_service=None, repository=None) -> TestClient:
    settings = settings_for(str(tmp_path / "calls.sqlite"), api_key="test-key" if ai_service else "")
    repo = repository or SQLiteCallRepository(settings.database_path)
    app = create_app(settings=settings, repository=repo, ai_service=ai_service or AIService(settings))
    return TestClient(app)


@pytest.fixture
def client(tmp_path):
    with build_client(tmp_path) as test_client:
        yield test_client


def create_call(client: TestClient, **payload):
    response = client.post("/api/calls", json=payload)
    assert response.status_code == 201
    return response.json()


def test_health_does_not_depend_on_database_or_paid_service(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_create_call_starts_at_stage_one(client):
    call = create_call(client, prospect_name="  Ananya Rao  ", company_name="Meridian")
    assert call["prospect_name"] == "Ananya Rao"
    assert call["company_name"] == "Meridian"
    assert call["status"] == "in_progress"
    assert call["current_stage"] == 1
    assert call["furthest_stage_reached"] == 1
    assert call["ended_at"] is None


def test_stages_include_a_prominent_verbatim_need_stage(client):
    response = client.get("/api/stages")
    assert response.status_code == 200
    stages = response.json()
    assert len(stages) == 8
    stage_five = stages[4]
    assert stage_five["stage_number"] == 5
    assert stage_five["name"] == "Their Need, in Their Words"
    assert "No immediate need" in stage_five["outcome_options"]


@pytest.mark.parametrize("stage_number", [0, 9])
def test_invalid_stage_number_is_rejected(client, stage_number):
    call = create_call(client)
    response = client.put(f"/api/calls/{call['id']}/stages/{stage_number}", json={"prospect_words": "words"})
    assert response.status_code == 422


def test_stage_outcome_must_belong_to_that_stage(client):
    call = create_call(client)
    response = client.put(
        f"/api/calls/{call['id']}/stages/1",
        json={"selected_outcome": "Meeting booked", "prospect_words": "Exact words"},
    )
    assert response.status_code == 422


def test_save_stage_preserves_exact_words_and_returns_saved_result(client):
    call = create_call(client)
    exact_words = "We’re stretched — ‘all hands’ until the second shift is staffed.\nThat’s the honest answer."
    response = client.put(
        f"/api/calls/{call['id']}/stages/1",
        json={"selected_outcome": "Reached the prospect", "prospect_words": exact_words, "advance_to": 2},
    )
    assert response.status_code == 200
    assert response.json()["prospect_words"] == exact_words
    detail = client.get(f"/api/calls/{call['id']}").json()
    assert detail["stage_results"][0]["prospect_words"] == exact_words


def test_updating_stage_updates_existing_row_instead_of_duplicating(client):
    call = create_call(client)
    url = f"/api/calls/{call['id']}/stages/1"
    first = client.put(url, json={"selected_outcome": "Reached the prospect", "prospect_words": "First wording"})
    second = client.put(url, json={"selected_outcome": "Other", "prospect_words": "Second wording"})
    assert first.status_code == second.status_code == 200
    detail = client.get(f"/api/calls/{call['id']}").json()
    assert len(detail["stage_results"]) == 1
    assert detail["stage_results"][0]["id"] == first.json()["id"]
    assert detail["stage_results"][0]["prospect_words"] == "Second wording"


def test_furthest_stage_does_not_drop_when_current_stage_moves_back(client):
    call = create_call(client)
    for stage_number in range(1, 4):
        response = client.put(
            f"/api/calls/{call['id']}/stages/{stage_number}",
            json={"prospect_words": f"Stage {stage_number}", "advance_to": stage_number + 1},
        )
        assert response.status_code == 200
    back = client.put(f"/api/calls/{call['id']}/stages/2", json={"prospect_words": "Revisited", "advance_to": 2})
    assert back.status_code == 200
    updated = client.get(f"/api/calls/{call['id']}").json()
    assert updated["current_stage"] == 2
    assert updated["furthest_stage_reached"] == 4


def test_stage_cannot_skip_ahead_more_than_one_step(client):
    call = create_call(client)
    response = client.put(f"/api/calls/{call['id']}/stages/1", json={"advance_to": 4})
    assert response.status_code == 422


def test_stage_cannot_move_current_stage_back_through_save(client):
    call = create_call(client)
    response = client.put(f"/api/calls/{call['id']}/stages/4", json={"advance_to": 3})
    assert response.status_code == 422


def test_early_close_keeps_stage_and_callback_outcome_distinct(client):
    call = create_call(client)
    for stage_number in range(1, 3):
        client.put(f"/api/calls/{call['id']}/stages/{stage_number}", json={"prospect_words": f"Stage {stage_number}", "advance_to": stage_number + 1})
    client.put(f"/api/calls/{call['id']}/stages/3", json={"prospect_words": "Stage 3", "advance_to": 3})
    next_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    response = client.post(
        f"/api/calls/{call['id']}/close",
        json={"final_outcome": "callback_agreed", "next_step": "Call back tomorrow afternoon", "next_step_at": next_at},
    )
    assert response.status_code == 200
    ended = response.json()
    assert ended["status"] == "completed"
    assert ended["furthest_stage_reached"] == 3
    assert ended["final_outcome"] == "callback_agreed"
    assert ended["next_step"] == "Call back tomorrow afternoon"
    assert ended["ended_at"] is not None


def test_close_supports_unsuccessful_outcome_without_next_step(client):
    call = create_call(client)
    response = client.post(f"/api/calls/{call['id']}/close", json={"final_outcome": "not_interested"})
    assert response.status_code == 200
    assert response.json()["final_outcome"] == "not_interested"
    assert response.json()["next_step"] is None


def test_close_is_idempotent_for_same_payload_but_completed_call_is_read_only(client):
    call = create_call(client)
    payload = {"final_outcome": "no_next_step"}
    first = client.post(f"/api/calls/{call['id']}/close", json=payload)
    again = client.post(f"/api/calls/{call['id']}/close", json=payload)
    update = client.put(f"/api/calls/{call['id']}/stages/1", json={"prospect_words": "Must not be saved"})
    assert first.status_code == again.status_code == 200
    assert update.status_code == 409
    assert client.get(f"/api/calls/{call['id']}").json()["stage_results"] == []


def test_nonexistent_call_returns_404(client):
    missing = "ec3d5d7b-b4b3-4eed-a850-b1038a7e1c21"
    assert client.get(f"/api/calls/{missing}").status_code == 404
    assert client.put(f"/api/calls/{missing}/stages/1", json={}).status_code == 404
    assert client.post(f"/api/calls/{missing}/close", json={"final_outcome": "other"}).status_code == 404


def test_history_is_newest_first_and_filters_apply(client):
    older = create_call(client, prospect_name="Older Person", company_name="Old Co")
    time.sleep(0.003)
    newer = create_call(client, prospect_name="Newer Person", company_name="New Co")
    client.post(f"/api/calls/{older['id']}/close", json={"final_outcome": "callback_agreed"})
    history = client.get("/api/calls?page=1&page_size=10").json()
    assert history["total"] == 2
    assert history["items"][0]["id"] == newer["id"]
    filtered = client.get("/api/calls?status=completed&outcome=callback_agreed").json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["id"] == older["id"]
    searched = client.get("/api/calls?search=newer").json()
    assert searched["total"] == 1
    assert searched["items"][0]["id"] == newer["id"]


class FailingAI:
    async def suggest(self, *_):
        raise AIProviderError()


def suggestion_body():
    return {"stage_number": 5, "prospect_words": "We want to grow, but the team is stretched.", "selected_outcome": "Described a problem"}


def test_missing_ai_key_is_a_clear_nonfatal_503(tmp_path):
    with build_client(tmp_path) as test_client:
        response = test_client.post("/api/ai/suggest-response", json=suggestion_body())
    assert response.status_code == 503
    assert response.json()["code"] == "AI_NOT_CONFIGURED"
    assert "GEMINI_API_KEY" in response.json()["detail"]


def test_ai_provider_failure_is_sanitized(tmp_path):
    with build_client(tmp_path, ai_service=FailingAI()) as test_client:
        response = test_client.post("/api/ai/suggest-response", json=suggestion_body())
    assert response.status_code == 502
    assert response.json()["code"] == "AI_PROVIDER_ERROR"
    assert "provider" in response.json()["detail"].lower()
    assert "secret" not in response.text.lower()


class FakeResponse:
    def __init__(self, status_code=200, envelope=None):
        self.status_code = status_code
        self.envelope = envelope or {"candidates": [{"content": {"parts": [{"text": "not valid json"}]}}]}

    def json(self):
        return self.envelope


class FakeAsyncClient:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


def test_malformed_ai_output_is_rejected_without_leaking_provider_data(monkeypatch, tmp_path):
    settings = settings_for(str(tmp_path / "ai.sqlite"), api_key="test-only-key")
    repo = SQLiteCallRepository(settings.database_path)
    ai = AIService(settings)
    monkeypatch.setattr("app.services.ai.httpx.AsyncClient", lambda **_: FakeAsyncClient(FakeResponse()))
    with build_client(tmp_path, ai_service=ai, repository=repo) as test_client:
        response = test_client.post("/api/ai/suggest-response", json=suggestion_body())
    assert response.status_code == 502
    assert response.json()["code"] == "AI_INVALID_OUTPUT"
    assert "not valid json" not in response.text


def test_database_failure_does_not_return_fake_success(tmp_path):
    settings = settings_for(str(tmp_path / "broken.sqlite"))

    class BrokenRepository(SQLiteCallRepository):
        def create_call(self, *_):
            raise DatabaseUnavailable()

    repository = BrokenRepository(settings.database_path)
    with build_client(tmp_path, repository=repository) as test_client:
        response = test_client.post("/api/calls", json={"prospect_name": "Not saved"})
    assert response.status_code == 503
    assert response.json()["code"] == "DATABASE_UNAVAILABLE"
