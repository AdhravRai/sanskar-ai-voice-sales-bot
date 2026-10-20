
import json
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = Path(os.getenv("DATA_DIR", str(BASE_DIR / "data")))
RECORDINGS_DIR = DATA_DIR / "recordings"
DB_PATH = DATA_DIR / "sales_calls.db"

DATA_DIR.mkdir(parents=True, exist_ok=True)
RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)


def get_connection():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS sales_calls (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transcript TEXT NOT NULL,
                duration_seconds INTEGER NOT NULL DEFAULT 0,
                consent INTEGER NOT NULL DEFAULT 0,
                recording_path TEXT,
                summary TEXT,
                customer_requirements TEXT,
                objections TEXT,
                next_steps TEXT,
                sales_status TEXT NOT NULL DEFAULT 'Follow-up Required',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.commit()


def create_call(
    transcript,
    duration_seconds,
    consent,
    recording_path,
    analysis,
):
    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO sales_calls (
                transcript,
                duration_seconds,
                consent,
                recording_path,
                summary,
                customer_requirements,
                objections,
                next_steps,
                sales_status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                json.dumps(transcript),
                duration_seconds,
                int(consent),
                recording_path,
                analysis.get("summary", ""),
                analysis.get("customer_requirements", ""),
                analysis.get("objections", ""),
                analysis.get("next_steps", ""),
                analysis.get("sales_status", "Follow-up Required"),
            ),
        )
        connection.commit()
        return cursor.lastrowid


def get_all_calls():
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT * FROM sales_calls
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()
        return [dict(row) for row in rows]


def get_call(call_id):
    with get_connection() as connection:
        row = connection.execute(
            "SELECT * FROM sales_calls WHERE id = ?",
            (call_id,),
        ).fetchone()
        return dict(row) if row else None
