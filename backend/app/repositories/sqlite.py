from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path
from uuid import uuid4

from app.domain.stages import STAGES
from app.errors import CallConflict, CallNotFound


def sqlite_errors_as_repository_errors(method):
    @wraps(method)
    def guarded(*args, **kwargs):
        try:
            return method(*args, **kwargs)
        except sqlite3.Error as error:
            from app.errors import DatabaseUnavailable
            raise DatabaseUnavailable() from error
    return guarded

SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS call_stages (
    id TEXT PRIMARY KEY,
    stage_number INTEGER NOT NULL UNIQUE CHECK(stage_number BETWEEN 1 AND 8),
    name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    talk_track TEXT NOT NULL,
    response_patterns TEXT NOT NULL,
    outcome_options TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    prospect_name TEXT,
    company_name TEXT,
    status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
    current_stage INTEGER NOT NULL DEFAULT 1 CHECK(current_stage BETWEEN 1 AND 8),
    furthest_stage_reached INTEGER NOT NULL DEFAULT 1 CHECK(furthest_stage_reached BETWEEN 1 AND 8),
    final_outcome TEXT CHECK(final_outcome IS NULL OR final_outcome IN ('meeting_booked','callback_agreed','information_sent','not_interested','no_next_step','other')),
    next_step TEXT,
    next_step_at TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS call_stage_results (
    id TEXT PRIMARY KEY,
    call_id TEXT NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    stage_number INTEGER NOT NULL CHECK(stage_number BETWEEN 1 AND 8),
    selected_outcome TEXT,
    prospect_words TEXT NOT NULL DEFAULT '',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(call_id, stage_number)
);
CREATE INDEX IF NOT EXISTS calls_started_at_idx ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS calls_status_idx ON calls(status);
CREATE INDEX IF NOT EXISTS call_stage_results_call_idx ON call_stage_results(call_id, stage_number);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteCallRepository:
    """Persistent local store used when Supabase is not configured."""

    def __init__(self, database_path: str):
        self.database_path = database_path
        self._initialized = False
        self._lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10, check_same_thread=False)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @contextmanager
    def _connection(self):
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    @sqlite_errors_as_repository_errors
    def initialize(self) -> None:
        with self._lock:
            if self._initialized:
                return
            if self.database_path != ":memory:":
                Path(self.database_path).parent.mkdir(parents=True, exist_ok=True)
            with self._connection() as connection:
                connection.executescript(SCHEMA)
                now = utc_now()
                for stage in STAGES:
                    connection.execute(
                        """INSERT INTO call_stages
                        (id, stage_number, name, purpose, talk_track, response_patterns, outcome_options, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(stage_number) DO UPDATE SET
                            name=excluded.name,
                            purpose=excluded.purpose,
                            talk_track=excluded.talk_track,
                            response_patterns=excluded.response_patterns,
                            outcome_options=excluded.outcome_options,
                            updated_at=excluded.updated_at""",
                        (
                            str(uuid4()), stage["stage_number"], stage["name"], stage["purpose"], stage["talk_track"],
                            json.dumps(stage["response_patterns"], ensure_ascii=False),
                            json.dumps(stage["outcome_options"], ensure_ascii=False), now, now,
                        ),
                    )
            self._initialized = True

    @sqlite_errors_as_repository_errors
    def list_stages(self) -> list[dict]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM call_stages ORDER BY stage_number").fetchall()
        return [self._stage_dict(row) for row in rows]

    @staticmethod
    def _stage_dict(row: sqlite3.Row) -> dict:
        value = dict(row)
        value["response_patterns"] = json.loads(value["response_patterns"])
        value["outcome_options"] = json.loads(value["outcome_options"])
        return value

    @staticmethod
    def _call_dict(row: sqlite3.Row) -> dict:
        return dict(row)

    @staticmethod
    def _result_dict(row: sqlite3.Row) -> dict:
        return dict(row)

    @sqlite_errors_as_repository_errors
    def create_call(self, prospect_name: str | None, company_name: str | None) -> dict:
        call_id = str(uuid4())
        now = utc_now()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO calls
                (id, prospect_name, company_name, status, current_stage, furthest_stage_reached,
                 final_outcome, next_step, next_step_at, started_at, ended_at, created_at, updated_at)
                VALUES (?, ?, ?, 'in_progress', 1, 1, NULL, NULL, NULL, ?, NULL, ?, ?)""",
                (call_id, prospect_name, company_name, now, now, now),
            )
            row = connection.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
        return self._call_dict(row)

    @sqlite_errors_as_repository_errors
    def save_stage(
        self,
        call_id: str,
        stage_number: int,
        selected_outcome: str | None,
        prospect_words: str,
        advance_to: int | None,
    ) -> dict:
        now = utc_now()
        current_stage = advance_to if advance_to is not None else stage_number
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            call = connection.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
            if call is None:
                raise CallNotFound()
            if call["status"] != "in_progress":
                raise CallConflict()
            furthest = max(int(call["furthest_stage_reached"]), stage_number, current_stage)
            connection.execute(
                """INSERT INTO call_stage_results
                (id, call_id, stage_number, selected_outcome, prospect_words, completed_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(call_id, stage_number) DO UPDATE SET
                    selected_outcome=excluded.selected_outcome,
                    prospect_words=excluded.prospect_words,
                    completed_at=excluded.completed_at,
                    updated_at=excluded.updated_at""",
                (str(uuid4()), call_id, stage_number, selected_outcome, prospect_words, now, now, now),
            )
            connection.execute(
                "UPDATE calls SET current_stage=?, furthest_stage_reached=?, updated_at=? WHERE id=?",
                (current_stage, furthest, now, call_id),
            )
            row = connection.execute(
                "SELECT * FROM call_stage_results WHERE call_id=? AND stage_number=?", (call_id, stage_number)
            ).fetchone()
        return self._result_dict(row)

    @sqlite_errors_as_repository_errors
    def close_call(
        self,
        call_id: str,
        final_outcome: str,
        next_step: str | None,
        next_step_at: str | None,
    ) -> dict:
        now = utc_now()
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
            if row is None:
                raise CallNotFound()
            if row["status"] == "completed":
                same_request = (
                    row["final_outcome"] == final_outcome
                    and row["next_step"] == next_step
                    and row["next_step_at"] == next_step_at
                )
                if same_request:
                    return self._call_dict(row)
                raise CallConflict()
            connection.execute(
                """UPDATE calls SET status='completed', final_outcome=?, next_step=?, next_step_at=?,
                   ended_at=?, updated_at=? WHERE id=? AND status='in_progress'""",
                (final_outcome, next_step, next_step_at, now, now, call_id),
            )
            result = connection.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
        return self._call_dict(result)

    @sqlite_errors_as_repository_errors
    def list_calls(self) -> list[dict]:
        with self._connection() as connection:
            rows = connection.execute("SELECT * FROM calls ORDER BY started_at DESC, created_at DESC").fetchall()
        return [self._call_dict(row) for row in rows]

    @sqlite_errors_as_repository_errors
    def get_call(self, call_id: str) -> dict | None:
        with self._connection() as connection:
            call = connection.execute("SELECT * FROM calls WHERE id = ?", (call_id,)).fetchone()
            if call is None:
                return None
            results = connection.execute(
                "SELECT * FROM call_stage_results WHERE call_id = ? ORDER BY stage_number", (call_id,)
            ).fetchall()
        return {**self._call_dict(call), "stage_results": [self._result_dict(row) for row in results]}
