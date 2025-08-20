from __future__ import annotations

import os
import sqlite3
import time
from contextlib import contextmanager
from typing import Tuple

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel


DB_PATH = os.environ.get("POSTURE_DB", os.path.join(os.path.dirname(__file__), "posture.db"))


@contextmanager
def db_conn():
    conn = sqlite3.connect(DB_PATH)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY,
                ts INTEGER NOT NULL,
                label TEXT NOT NULL CHECK(label IN ('good','slouched'))
            );
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            """
        )
        # Default: no consent
        cur.execute("INSERT OR IGNORE INTO settings(key, value) VALUES('consent','false')")


class ConsentBody(BaseModel):
    consent: bool


app = FastAPI(default_response_class=ORJSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,
    allow_headers=["*"],
)


# All classification moved to client-side TFJS to avoid Python wheel issues and keep frames local


def get_consent() -> bool:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key='consent'")
        row = cur.fetchone()
        return (row[0] == 'true') if row else False


def set_consent(value: bool) -> None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO settings(key, value) VALUES('consent', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("true" if value else "false",))


def store_event_if_allowed(label: str, allow: bool) -> None:
    if not allow:
        return
    if label not in ("good", "slouched"):
        return
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO events(ts, label) VALUES(?, ?)", (int(time.time()), label))


def aggregate_summary(period: str) -> Tuple[float, int]:
    now = int(time.time())
    if period == "weekly":
        since = now - 7 * 24 * 3600
    else:
        since = now - 24 * 3600
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT label, COUNT(*) FROM events WHERE ts >= ? GROUP BY label", (since,))
        counts = {row[0]: row[1] for row in cur.fetchall()}
        total = sum(counts.values())
        if total == 0:
            return 0.0, 0
        upright_ratio = counts.get("good", 0) / total
        return float(upright_ratio), int(total)


@app.on_event("startup")
def _startup():
    init_db()


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/consent")
def get_consent_route():
    return {"consent": get_consent()}


@app.post("/api/consent")
def set_consent_route(body: ConsentBody):
    set_consent(body.consent)
    return {"consent": get_consent()}


class TrackBody(BaseModel):
    label: str
    confidence: float | None = None


@app.post("/api/track")
def track(body: TrackBody):
    consent = get_consent()
    if not consent:
        return {"stored": False}
    if body.label not in ("good", "slouched"):
        return {"stored": False}
    store_event_if_allowed(body.label, allow=True)
    return {"stored": True}


@app.get("/api/summary")
def summary(period: str = Query(default="daily", pattern="^(daily|weekly)$")):
    consent = get_consent()
    if not consent:
        return {"uprightRatio": 0.0, "totalEvents": 0}
    ratio, total = aggregate_summary(period)
    return {"uprightRatio": ratio, "totalEvents": total}

