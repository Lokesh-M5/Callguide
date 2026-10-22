from __future__ import annotations

from datetime import datetime, timezone

import httpx
from postgrest.exceptions import APIError
from supabase import create_client

from app.errors import CallConflict, CallNotFound, DatabaseUnavailable


def _data(response) -> list | dict | None:
    return getattr(response, "data", None)


def _first(value) -> dict | None:
    if isinstance(value, list):
        return value[0] if value else None
    return value if isinstance(value, dict) else None


def _rpc_error(error: APIError):
    message = str(getattr(error, "message", ""))
    if "CALL_NOT_FOUND" in message:
        raise CallNotFound() from error
    if "CALL_ALREADY_COMPLETED" in message:
        raise CallConflict() from error
    raise DatabaseUnavailable() from error


class SupabaseCallRepository:
    """Server-side Supabase adapter. The service-role key never leaves this process."""

    def __init__(self, url: str, service_role_key: str):
        self.client = create_client(url, service_role_key)

    def initialize(self) -> None:
        # Supabase is provisioned by the committed schema and seed SQL scripts.
        return None

    def list_stages(self) -> list[dict]:
        try:
            data = _data(self.client.table("call_stages").select("*").order("stage_number").execute()) or []
            for stage in data:
                if isinstance(stage.get("response_patterns"), str):
                    import json
                    stage["response_patterns"] = json.loads(stage["response_patterns"])
                if isinstance(stage.get("outcome_options"), str):
                    import json
                    stage["outcome_options"] = json.loads(stage["outcome_options"])
            return data
        except (APIError, httpx.HTTPError) as error:
            raise DatabaseUnavailable() from error

    def create_call(self, prospect_name: str | None, company_name: str | None) -> dict:
        payload = {
            "prospect_name": prospect_name,
            "company_name": company_name,
            "status": "in_progress",
            "current_stage": 1,
            "furthest_stage_reached": 1,
        }
        try:
            row = _first(_data(self.client.table("calls").insert(payload).select("*").execute()))
            if row is None:
                raise DatabaseUnavailable()
            return row
        except (APIError, httpx.HTTPError) as error:
            raise DatabaseUnavailable() from error

    def save_stage(self, call_id: str, stage_number: int, selected_outcome: str | None, prospect_words: str, advance_to: int | None) -> dict:
        try:
            data = _data(self.client.rpc("save_call_stage", {
                "p_call_id": call_id,
                "p_stage_number": stage_number,
                "p_selected_outcome": selected_outcome,
                "p_prospect_words": prospect_words,
                "p_advance_to": advance_to,
            }).execute())
            result = _first(data)
            if result is None:
                raise DatabaseUnavailable()
            return result
        except APIError as error:
            _rpc_error(error)
        except httpx.HTTPError as error:
            raise DatabaseUnavailable() from error

    def close_call(self, call_id: str, final_outcome: str, next_step: str | None, next_step_at: str | None) -> dict:
        try:
            data = _data(self.client.rpc("close_call", {
                "p_call_id": call_id,
                "p_final_outcome": final_outcome,
                "p_next_step": next_step,
                "p_next_step_at": next_step_at,
            }).execute())
            row = _first(data)
            if row is None:
                raise DatabaseUnavailable()
            return row
        except APIError as error:
            _rpc_error(error)
        except httpx.HTTPError as error:
            raise DatabaseUnavailable() from error

    def list_calls(self) -> list[dict]:
        try:
            return _data(self.client.table("calls").select("*").order("started_at", desc=True).limit(5000).execute()) or []
        except (APIError, httpx.HTTPError) as error:
            raise DatabaseUnavailable() from error

    def get_call(self, call_id: str) -> dict | None:
        try:
            call = _first(_data(self.client.table("calls").select("*").eq("id", call_id).limit(1).execute()))
            if call is None:
                return None
            results = _data(
                self.client.table("call_stage_results").select("*").eq("call_id", call_id).order("stage_number").execute()
            ) or []
            return {**call, "stage_results": results}
        except (APIError, httpx.HTTPError) as error:
            raise DatabaseUnavailable() from error
