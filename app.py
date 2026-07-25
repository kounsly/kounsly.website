"""Kounsly API — search over the real catalogue, and a grounded assistant.

The catalogue is a read-only SQLite file built by kounsly-pipeline and shipped
inside the image, so search costs nothing to serve and a data rebuild is an
ordinary deploy.

The assistant answers **only** from one programme's stored fields. It is not a
general chatbot: an admissions answer that sounds right and is wrong costs a
user a year, and unbiased-and-sourced is the whole product. When a fact is not
in our data it says so and points at the official page.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from collections import defaultdict, deque
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("KOUNSLY_DB", ROOT / "kounsly.db"))
INDEX = ROOT / "index.html"

CHAT_MODEL = os.getenv("KOUNSLY_CHAT_MODEL", "gemini-3.6-flash")
GCP_PROJECT = os.getenv("GCP_PROJECT", "kounsly")
GCP_LOCATION = os.getenv("GCP_LOCATION", "global")

# Free-tier guardrail. The assistant spends real money per call, so an open
# endpoint needs a ceiling before it needs anything else.
ASK_LIMIT_PER_HOUR = int(os.getenv("KOUNSLY_ASK_LIMIT", "20"))
_ask_log: dict[str, deque[float]] = defaultdict(deque)

app = FastAPI(title="Kounsly", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

# Every column is prefixed with the table alias: programs_fts carries columns of
# the same names, so bare `name` is ambiguous the moment a text query joins it.
CARD_COLUMNS = [
    "uid", "name", "university", "city", "country", "degree_level", "degree_title",
    "subject", "area", "languages", "english_only", "duration_months", "duration_raw",
    "start_terms", "is_online", "tuition_free", "tuition_eur_year", "tuition_raw",
    "semester_fee_raw", "cost_of_living_eur_month", "ielts", "toefl_ibt",
    "english_cefr", "deadlines", "source_url", "application_url", "checked_at",
]
CARD_FIELDS = ", ".join(f"p.{c}" for c in CARD_COLUMNS)

SORTS = {
    # "Best match" with no search text is really "show your best records first":
    # a programme whose deadline, requirements and costs are all known beats one
    # that says "not listed" four times, even though both are equally relevant.
    "match": "rank_score ASC, p.quality DESC",
    "tuition": "tuition_eur_year IS NULL, tuition_eur_year ASC, p.quality DESC",
    "deadline": "next_deadline IS NULL, next_deadline ASC",
    "ielts": "ielts IS NULL, ielts ASC",
}


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    out = dict(row)
    for key in ("languages", "deadlines"):
        if isinstance(out.get(key), str):
            out[key] = json.loads(out[key])
    return out


# Words that carry no signal in a programme catalogue — every second query has
# them, and matching on them is what turns "data science" into 800 hits.
STOPWORDS = {
    "the", "and", "for", "with", "any", "all", "which", "что", "как",
    "cheap", "free", "affordable", "master", "masters", "bachelor", "phd",
    "degree", "program", "programme", "study", "studies", "english", "taught",
    "магістр", "бакалавр", "дешевий", "безкоштовно", "англійською", "програма",
}


def fts_terms(raw: str) -> list[str]:
    """Turn free user text into safe FTS5 prefix tokens.

    Users type sentences ("cheap data science master in English"), not FTS
    syntax, and stray quotes or operators would otherwise be a syntax error.
    Filter/level words are dropped here because the filters already express
    them — leaving them in makes every query match half the catalogue.
    """
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in raw.lower())
    words = [w for w in cleaned.split() if len(w) > 2 and w not in STOPWORDS]
    return [f'"{w}"*' for w in words[:8]]


@app.get("/api/search")
def search(
    q: str = "",
    country: str = "",
    level: str = "",
    area: str = "",
    subject: str = "",
    max_tuition: Optional[float] = None,
    free_only: bool = False,
    english_only: bool = False,
    sort: str = "match",
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=60),
) -> dict[str, Any]:
    today = date.today()
    today_mmdd = today.month * 100 + today.day

    where, params = ["1=1"], {}
    if country:
        where.append("p.country = :country")
        params["country"] = country.upper()
    if level:
        where.append("p.degree_level = :level")
        params["level"] = level
    if area:
        where.append("p.area = :area")
        params["area"] = area
    if subject:
        where.append("p.subject = :subject")
        params["subject"] = subject
    if free_only:
        where.append("p.tuition_free = 1")
    if english_only:
        where.append("p.english_only = 1")
    if max_tuition is not None:
        # A programme with unknown tuition is not evidence of being affordable,
        # so it does not survive a budget filter.
        where.append("p.tuition_eur_year IS NOT NULL AND p.tuition_eur_year <= :max_tuition")
        params["max_tuition"] = max_tuition

    terms = fts_terms(q) if q.strip() else []
    join, rank = "", "0"
    if terms:
        join = "JOIN programs_fts f ON f.rowid = p.rowid"
        where.append("programs_fts MATCH :term")
        rank = "f.rank"

    sort_sql = SORTS.get(sort, SORTS["match"])
    sql = f"""
        SELECT {CARD_FIELDS},
               {rank} AS rank_score,
               (SELECT MIN((d.mmdd - :today + 10000) % 10000)
                  FROM program_deadlines d WHERE d.uid = p.uid) AS next_deadline
        FROM programs p {join}
        WHERE {' AND '.join(where)}
        ORDER BY {sort_sql}
        LIMIT :limit OFFSET :offset
    """
    count_sql = f"SELECT COUNT(*) FROM programs p {join} WHERE {' AND '.join(where)}"

    conn = db()
    try:
        # All words first; fall back to any word only if that finds nothing. AND
        # keeps "data science" meaning data science, OR keeps a typo or an
        # unusual phrasing from returning an empty page.
        attempts = [" AND ".join(terms)] if terms else [None]
        if len(terms) > 1:
            attempts.append(" OR ".join(terms))

        total, rows, matched_all = 0, [], True
        for i, term in enumerate(attempts):
            params_try = {**params, "term": term} if term else params
            total = conn.execute(count_sql, params_try).fetchone()[0]
            if total or i == len(attempts) - 1:
                rows = conn.execute(sql, {**params_try, "today": today_mmdd,
                                          "limit": per_page,
                                          "offset": (page - 1) * per_page}).fetchall()
                matched_all = i == 0
                break
    except sqlite3.OperationalError as e:
        raise HTTPException(400, f"bad query: {e}") from e
    finally:
        conn.close()

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "broadened": bool(terms) and not matched_all,
        "items": [row_to_dict(r) for r in rows],
    }


@app.get("/api/facets")
def facets() -> dict[str, Any]:
    conn = db()
    try:
        def counts(column: str) -> list[dict[str, Any]]:
            return [
                {"value": v, "count": n}
                for v, n in conn.execute(
                    f"SELECT {column}, COUNT(*) FROM programs WHERE {column} IS NOT NULL "
                    f"GROUP BY {column} ORDER BY COUNT(*) DESC"
                )
            ]

        return {
            "countries": counts("country"),
            "levels": counts("degree_level"),
            "areas": counts("area"),
            # Long tail truncated: 249 subjects is a catalogue, not a dropdown.
            "subjects": counts("subject")[:80],
            "total": conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0],
            "free": conn.execute("SELECT COUNT(*) FROM programs WHERE tuition_free = 1").fetchone()[0],
        }
    finally:
        conn.close()


@app.get("/api/program/{uid}")
def program(uid: str) -> dict[str, Any]:
    conn = db()
    try:
        row = conn.execute("SELECT * FROM programs WHERE uid = ?", (uid,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "no such programme")
    return row_to_dict(row)


# ---------- grounded assistant ----------

class Ask(BaseModel):
    uid: str
    question: str = Field(max_length=600)
    selection: Optional[str] = Field(None, max_length=2000)
    lang: str = "uk"


SYSTEM = """You are Kounsly's admissions assistant. You answer about ONE study programme,
using ONLY the programme data given to you.

RULES
- Never invent, infer or recall facts from elsewhere. The data below is your only source.
- If the answer is not in the data, say plainly that the official page does not state it,
  and point the user to the official page link. Do not guess.
- Be concrete and short: 2-5 sentences, or a tight list. Quote figures exactly as stated.
- Money: distinguish tuition from the semester contribution and from living costs.
- Answer in {language}.
- If the user asks about their personal eligibility, answer with what the stated
  requirements are, and be explicit that only the university can confirm a decision.
"""

CONTEXT_FIELDS = [
    ("Programme", "name"), ("Degree", "degree_title"), ("Level", "degree_level"),
    ("University", "university"), ("City", "city"), ("Country", "country"),
    ("Subject", "subject"), ("Teaching languages", "languages"),
    ("Duration", "duration_raw"), ("Starts", "start_terms"),
    ("Tuition per year (EUR)", "tuition_eur_year"), ("Tuition as stated", "tuition_raw"),
    ("Semester contribution", "semester_fee_raw"),
    ("Cost of living (EUR/month)", "cost_of_living_eur_month"),
    ("Funding / scholarships", "scholarships_raw"),
    ("IELTS", "ielts"), ("TOEFL iBT", "toefl_ibt"), ("English CEFR", "english_cefr"),
    ("Language requirements as stated", "language_requirement_raw"),
    ("Academic admission requirements", "admission_requirements_raw"),
    ("Application deadline as stated", "application_deadline_raw"),
    ("Apply at", "application_url"), ("Official page", "source_url"),
    ("Support for international students", "support_international"),
    ("Description", "description"), ("Last checked", "checked_at"),
]


def build_context(row: dict[str, Any]) -> str:
    lines = []
    for label, key in CONTEXT_FIELDS:
        value = row.get(key)
        if value in (None, "", [], 0.0) and not (key == "tuition_eur_year" and value == 0.0):
            continue
        if isinstance(value, list):
            value = ", ".join(map(str, value))
        lines.append(f"{label}: {value}")
    return "\n".join(lines)


def rate_limited(ip: str) -> bool:
    now = time.time()
    log = _ask_log[ip]
    while log and now - log[0] > 3600:
        log.popleft()
    if len(log) >= ASK_LIMIT_PER_HOUR:
        return True
    log.append(now)
    return False


_clients = threading.local()
_client_refs: list[Any] = []   # strong refs: see below


def gemini_client():
    """Vertex AI when credentials allow it (that is what spends the Cloud
    credits); an AI Studio key otherwise, which is what a server without ADC
    has. Imported lazily so search keeps working if the SDK is unavailable.

    One client per thread, held alive for the process lifetime. Both halves
    matter: a client shared across threads ends up closed mid-run, and letting
    a client be garbage-collected closes transport that later calls still need
    — either way every subsequent request fails with "Cannot send a request, as
    the client has been closed".
    """
    from google import genai

    existing = getattr(_clients, "c", None)
    if existing is None:
        if key := os.getenv("GEMINI_API_KEY"):
            existing = genai.Client(api_key=key)
        else:
            existing = genai.Client(vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION)
        _clients.c = existing
        _client_refs.append(existing)
    return existing


@app.post("/api/ask")
def ask(body: Ask, request: Request) -> JSONResponse:
    ip = (request.headers.get("x-forwarded-for") or request.client.host or "?").split(",")[0].strip()
    if rate_limited(ip):
        return JSONResponse({"error": "rate_limited", "limit_per_hour": ASK_LIMIT_PER_HOUR}, status_code=429)

    conn = db()
    try:
        row = conn.execute("SELECT * FROM programs WHERE uid = ?", (body.uid,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(404, "no such programme")

    language = {"uk": "Ukrainian", "en": "English"}.get(body.lang, "English")
    parts = [SYSTEM.format(language=language), "PROGRAMME DATA:", build_context(row_to_dict(row))]
    if body.selection:
        parts.append(f'The user highlighted this text on the page:\n"""{body.selection}"""')
    parts.append(f"USER QUESTION: {body.question}")

    try:
        from google.genai import types

        resp = gemini_client().models.generate_content(
            model=CHAT_MODEL,
            contents="\n\n".join(parts),
            config=types.GenerateContentConfig(
                temperature=0.2,
                max_output_tokens=800,
                # Thinking is billed as output and, on 3.x, silently eats the
                # output budget: a 700-token cap left 23 tokens for the answer
                # and returned a sentence cut in half. This task is "read the
                # given fields and say what they state", so thinking buys
                # nothing and costs ~10x per answer.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        answer = (resp.text or "").strip()
    except Exception as e:  # noqa: BLE001 — surface a usable message, never a stack trace
        return JSONResponse({"error": "assistant_unavailable", "detail": str(e)[:200]}, status_code=503)

    usage = getattr(resp, "usage_metadata", None)
    return JSONResponse({
        "answer": answer or "Не змогла сформувати відповідь. Спробуй перефразувати питання.",
        "tokens": {
            "in": getattr(usage, "prompt_token_count", 0) or 0,
            "out": getattr(usage, "candidates_token_count", 0) or 0,
        },
    })


@app.get("/api/health")
def health() -> dict[str, Any]:
    conn = db()
    try:
        n = conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    finally:
        conn.close()
    return {"ok": True, "programmes": n, "db": DB_PATH.name}


@app.get("/")
def index() -> FileResponse:
    # no-store: the page shipped stale once already and cost hours of confusion
    return FileResponse(INDEX, headers={"Cache-Control": "no-store"})
