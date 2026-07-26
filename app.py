"""Kounsly API — search over the real catalogue, and a grounded assistant.

The catalogue is a read-only SQLite file built by kounsly-pipeline, mounted from
the host and opened per request, so search costs nothing to serve. It travelled
inside the image until five countries made it 78 MB — see the Dockerfile for
why that had to stop.

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
# In production this is a read-only bind mount from the host (/data/kounsly),
# because the catalogue outgrew being committed to git. Locally it is the file
# the pipeline writes next to this one, so `uvicorn app:app` still just works.
DB_PATH = Path(os.getenv("KOUNSLY_DB", ROOT / "kounsly.db"))
INDEX = ROOT / "index.html"

if not DB_PATH.exists():
    # Said once, loudly, at startup. Without this the first symptom is a
    # sqlite "unable to open database file" on every request, which reads like
    # a code bug rather than a missing mount.
    print(f"FATAL: no catalogue at {DB_PATH}. In production this is the host "
          f"mount; check the volume and KOUNSLY_DB.", flush=True)

CHAT_MODEL = os.getenv("KOUNSLY_CHAT_MODEL", "gemini-3.6-flash")
GCP_PROJECT = os.getenv("GCP_PROJECT", "kounsly")
GCP_LOCATION = os.getenv("GCP_LOCATION", "global")

# Free-tier guardrail. The assistant spends real money per call, so an open
# endpoint needs a ceiling before it needs anything else.
ASK_LIMIT_PER_HOUR = int(os.getenv("KOUNSLY_ASK_LIMIT", "20"))
_ask_log: dict[str, deque[float]] = defaultdict(deque)

app = FastAPI(title="Kounsly", docs_url=None, redoc_url=None)


class NoStoreStatic(StaticFiles):
    """Serve app.js/app.css uncached.

    The page is already no-store; leaving its scripts cacheable means a deploy
    ships new markup against last week's JavaScript, which looks like a bug in
    the feature rather than a stale file. These are tens of kilobytes — when
    there is traffic worth optimising for, switch to hashed filenames.
    """

    def is_not_modified(self, *args, **kwargs) -> bool:  # noqa: D102
        return False

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store"
        return response


app.mount("/static", NoStoreStatic(directory=ROOT / "static"), name="static")

# Every column is prefixed with the table alias: programs_fts carries columns of
# the same names, so bare `name` is ambiguous the moment a text query joins it.
CARD_COLUMNS = [
    "uid", "name", "university", "city", "country", "degree_level", "degree_title",
    "subject", "area", "languages", "english_only", "duration_months", "duration_raw",
    "ects", "start_terms", "is_online", "tuition_free", "tuition_eur_year", "tuition_raw",
    "semester_fee_raw", "cost_of_living_eur_month", "ielts", "toefl_ibt",
    "english_cefr", "deadlines", "source_url", "application_url", "checked_at",
    "quality",   # used as a tie-breaker in ranking, so it has to come back with the row
]
CARD_FIELDS = ", ".join(f"p.{c}" for c in CARD_COLUMNS)

EMBED_MODEL = os.getenv("KOUNSLY_EMBED_MODEL", "gemini-embedding-2")
PARSE_MODEL = os.getenv("KOUNSLY_PARSE_MODEL", "gemini-3.5-flash-lite")
EMBED_DIM = 768

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
    for key in ("languages", "deadlines", "extras"):
        if isinstance(out.get(key), str):
            try:
                out[key] = json.loads(out[key])
            except json.JSONDecodeError:
                out[key] = None
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


"""--------------- semantic layer ---------------

Two AI touches on a search, both small and both cached:

1. The phrase a person types is turned into filters ("cheap master's in ML in
   Germany" -> level=master, country=DE, tuition ceiling) plus the part that is
   really about *subject matter*. Fast model, and identical queries are answered
   from memory.
2. That subject part is embedded and compared against the catalogue's vectors,
   so a programme matches on meaning rather than on sharing tokens.

Filters the user set by hand always win over anything the model inferred — the
dropdowns are an instruction, the sentence is a guess.
"""

_vectors: Any = None          # numpy matrix, L2-normalised rows
_vector_uids: list[str] = []
_vector_pos: dict[str, int] = {}
_parse_cache: dict[str, dict] = {}
_query_vec_cache: dict[str, Any] = {}


def load_vectors() -> None:
    global _vectors, _vector_uids, _vector_pos
    if _vectors is not None:
        return
    try:
        import numpy as np
    except ImportError:
        print("numpy missing — semantic search disabled, text search unaffected")
        _vectors = False
        return

    conn = db()
    try:
        rows = conn.execute("SELECT uid, vec FROM program_vectors").fetchall()
    except sqlite3.OperationalError:
        rows = []          # database built before vectors existed
    finally:
        conn.close()

    if not rows:
        _vectors = False
        return

    matrix = np.frombuffer(b"".join(r["vec"] for r in rows), dtype="<f4").reshape(len(rows), EMBED_DIM)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    _vectors = matrix / np.maximum(norms, 1e-9)
    _vector_uids = [r["uid"] for r in rows]
    _vector_pos = {uid: i for i, uid in enumerate(_vector_uids)}
    print(f"semantic search ready: {len(rows)} vectors x {EMBED_DIM}")


class ParsedQuery(BaseModel):
    subject: Optional[str] = Field(
        None, description="Only the field of study / topic, in English, 1-6 words. "
        "Null if the query names no subject.")
    level: Optional[str] = Field(None, description="bachelor, master or phd if stated; else null")
    country: Optional[str] = Field(None, description="ISO-3166 alpha-2 if a country is named; else null")
    free_only: Optional[bool] = Field(None, description="true only if they ask for free / no tuition")
    max_tuition_eur_year: Optional[float] = Field(
        None, description="A stated budget ceiling per year in EUR. Null unless a number is given.")
    max_ielts: Optional[float] = Field(
        None, description="Set only when they ask for a low or no English-test requirement, e.g. 6.0. Else null.")


PARSE_PROMPT = """Turn a study-abroad search phrase into filters. The user may write in
Ukrainian, English or a mix.

RULES
- Extract only what the phrase actually says. Do not invent a country, level or budget.
- `subject` is the topic only, translated to English, with no filter words: from
  "дешевий магістр з машинного навчання в Німеччині" -> subject "machine learning".
- "дешевий"/"cheap" alone is not a number: leave max_tuition_eur_year null and do not
  set free_only unless they say free / без плати / no tuition / безкоштовно.
- "без високого IELTS", "низький IELTS", "without IELTS" -> max_ielts 6.0.

PHRASE: {q}"""


def parse_query(q: str) -> dict[str, Any]:
    """Model-extracted filters, or {} when the assistant has no credentials."""
    key = q.strip().lower()
    if key in _parse_cache:
        return _parse_cache[key]
    if not assistant_available():
        return {}

    try:
        from google.genai import types

        resp = gemini_client().models.generate_content(
            model=PARSE_MODEL,
            contents=PARSE_PROMPT.format(q=q[:400]),
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=ParsedQuery,
                temperature=0,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        parsed = resp.parsed.model_dump() if resp.parsed else {}
    except Exception as e:  # noqa: BLE001 — a failed parse degrades to plain text search
        print(f"query parse failed: {str(e)[:160]}")
        parsed = {}

    if len(_parse_cache) > 2000:
        _parse_cache.clear()
    _parse_cache[key] = parsed
    return parsed


def query_vector(text: str):
    """Embedding of the subject part of a query, cached per string."""
    key = text.strip().lower()
    if key in _query_vec_cache:
        return _query_vec_cache[key]
    if _vectors is False or not assistant_available():
        return None

    try:
        import numpy as np
        from google.genai import types

        resp = gemini_client().models.embed_content(
            model=EMBED_MODEL,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=EMBED_DIM),
        )
        vec = np.array(resp.embeddings[0].values, dtype="float32")
        vec /= max(float(np.linalg.norm(vec)), 1e-9)
    except Exception as e:  # noqa: BLE001
        print(f"query embedding failed: {str(e)[:160]}")
        return None

    if len(_query_vec_cache) > 1000:
        _query_vec_cache.clear()
    _query_vec_cache[key] = vec
    return vec


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
    ai: bool = True,
) -> dict[str, Any]:
    load_vectors()
    today_mmdd = date.today().month * 100 + date.today().day

    # A typed phrase becomes filters + a subject to match on meaning. One word is
    # not worth a model call: it is already a good text query on its own.
    interpreted: dict[str, Any] = {}
    if ai and q.strip():
        # Single words go through the parse too: "медицина" needs translating to
        # "medicine" before it can match an English catalogue, and the call is
        # cached per phrase, so popular one-word queries cost nothing after the
        # first visitor.
        interpreted = parse_query(q) or {}

    def inferred(key):
        """Model guesses only fill gaps — an explicit filter is never overridden."""
        value = interpreted.get(key)
        return value if value not in (None, "", False) else None

    where, params = ["1=1"], {}
    country = country or (inferred("country") or "")
    level = level or (inferred("level") or "")
    if max_tuition is None:
        max_tuition = inferred("max_tuition_eur_year")
    free_only = free_only or bool(inferred("free_only"))
    max_ielts = inferred("max_ielts")

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
    if max_ielts is not None:
        where.append("p.ielts IS NOT NULL AND p.ielts <= :max_ielts")
        params["max_ielts"] = max_ielts

    vec = query_vector(interpreted.get("subject") or q) if q.strip() else None

    if vec is not None:
        return semantic_search(where, params, vec, today_mmdd, sort, page, per_page, interpreted)
    return text_search(where, params, q, today_mmdd, sort, page, per_page, interpreted)


def _base_sql(where: list[str], join: str, rank: str, order: str) -> str:
    return f"""
        SELECT {CARD_FIELDS},
               {rank} AS rank_score,
               (SELECT MIN((d.mmdd - :today + 10000) % 10000)
                  FROM program_deadlines d WHERE d.uid = p.uid) AS next_deadline
        FROM programs p {join}
        WHERE {' AND '.join(where)}
        {order}
    """


def semantic_search(where, params, vec, today_mmdd, sort, page, per_page, interpreted):
    """Rank the filtered set by meaning, then page in Python.

    Scoring all matches in memory is fine at catalogue scale — a few thousand
    dot products of 768 floats — and it keeps ranking in one place instead of
    splitting it between SQL and here.
    """
    import numpy as np

    conn = db()
    try:
        rows = conn.execute(_base_sql(where, "", "0", ""), {**params, "today": today_mmdd}).fetchall()
    except sqlite3.OperationalError as e:
        raise HTTPException(400, f"bad query: {e}") from e
    finally:
        conn.close()

    positions = [(i, _vector_pos[r["uid"]]) for i, r in enumerate(rows) if r["uid"] in _vector_pos]
    scored: list[tuple[float, sqlite3.Row]] = []
    if positions:
        idx = np.fromiter((p for _, p in positions), dtype=np.int64, count=len(positions))
        sims = _vectors[idx] @ vec
        for (row_i, _), sim in zip(positions, sims):
            row = rows[row_i]
            # A small nudge for completeness, so two similarly relevant
            # programmes are ordered by which one a user can act on. Kept well
            # below the relevance window so it breaks ties, not rankings.
            scored.append((float(sim) + 0.004 * (row["quality"] or 0), row))
    # Rows without a vector (a fresh source, not yet embedded) rank last rather
    # than disappearing from results.
    scored += [(-1.0, r) for r in rows if r["uid"] not in _vector_pos]

    if sort == "tuition":
        scored.sort(key=lambda s: (s[1]["tuition_eur_year"] is None, s[1]["tuition_eur_year"] or 0, -s[0]))
    elif sort == "deadline":
        scored.sort(key=lambda s: (s[1]["next_deadline"] is None, s[1]["next_deadline"] or 0, -s[0]))
    elif sort == "ielts":
        scored.sort(key=lambda s: (s[1]["ielts"] is None, s[1]["ielts"] or 0, -s[0]))
    else:
        scored.sort(key=lambda s: -s[0])

    # Similarity scores sit in a narrow band (best ~0.75, median ~0.60), so cut
    # relative to the best match rather than at an absolute value. Without this
    # the count reads "1,716 programmes" for a query about one subject, which is
    # true of the filter but useless as an answer.
    in_filter = len(scored)
    if scored and scored[0][0] > 0:
        floor = scored[0][0] - 0.07
        keep = max(24, sum(1 for s, _ in scored if s >= floor))
        scored = scored[:min(keep, 300)]

    start = (page - 1) * per_page
    return {
        "total": len(scored),
        "total_in_filter": in_filter,
        "page": page,
        "per_page": per_page,
        "broadened": False,
        "semantic": True,
        "interpreted": interpreted,
        "items": [row_to_dict(r) for _, r in scored[start:start + per_page]],
    }


def text_search(where, params, q, today_mmdd, sort, page, per_page, interpreted):
    """Fallback when there are no vectors or no credentials: FTS5 as before."""
    terms = fts_terms(q) if q.strip() else []
    join, rank = "", "0"
    if terms:
        join = "JOIN programs_fts f ON f.rowid = p.rowid"
        where = where + ["programs_fts MATCH :term"]
        rank = "f.rank"

    order = f"ORDER BY {SORTS.get(sort, SORTS['match'])} LIMIT :limit OFFSET :offset"
    sql = _base_sql(where, join, rank, order)
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
        "semantic": False,
        "interpreted": interpreted,
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

class Profile(BaseModel):
    citizenship: Optional[str] = None      # UA | EU | OTHER
    status: Optional[str] = None           # none | protection
    education: Optional[str] = None        # school | bachelor | master
    ielts: Optional[str] = None
    toefl: Optional[str] = None


class Ask(BaseModel):
    uid: str
    question: str = Field(max_length=600)
    selection: Optional[str] = Field(None, max_length=2000)
    lang: str = "uk"
    profile: Optional[Profile] = None


SYSTEM = """You are Kounsly's admissions assistant. You answer about ONE study programme,
using ONLY the programme data given to you.

RULES
- Never invent, infer or recall facts from elsewhere. The data below is your only source.
- If the answer is not in the data, say plainly that the official page does not state it,
  and point the user to the official page link. Do not guess.
- Be concrete and short: 2-5 sentences, or a tight list. Quote figures exactly as stated.
- Money: distinguish tuition from the semester contribution and from living costs.
- Answer in {language}. When that is Ukrainian, write natural literary Ukrainian —
  no Russian words or calques slipping in ("таким образом", "такі как", "витрати
  на проживання" is fine but "проживання" not "жильё"). Financial and admissions
  terms in Ukrainian, with the original English term in brackets on first use if
  it helps the reader recognise it on the university's page.
- If the user asks about their personal eligibility, answer with what the stated
  requirements are, and be explicit that only the university can confirm a decision.

ABOUT THE READER
- You may be given their citizenship, status, education and test scores. Use them
  only to pick which stated fact applies and to compare numbers: "the page asks
  IELTS 6.5, you have 6.0, that is 0.5 short".
- Their citizenship decides which stated deadline is theirs. Say which date is
  theirs and why.
- Refugee or temporary-protection status: NEVER state what it changes. Fees and
  admission rules for protected status differ by country and are not on this
  page. Say that the page does not cover it and that they must ask the
  university, and point at the official link. Guessing here would be the single
  most damaging thing you could do.
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


UK_COLUMN = {
    "description": "description_uk",
    "admission_requirements_raw": "admission_requirements_uk",
    "language_requirement_raw": "language_requirement_uk",
    "scholarships_raw": "scholarships_uk",
    "semester_fee_raw": "semester_fee_uk",
    "cost_of_living_raw": "cost_of_living_uk",
    "support_international": "support_international_uk",
    "application_deadline_raw": "application_deadline_uk",
}


def build_context(row: dict[str, Any], lang: str = "en") -> str:
    lines = []
    for label, key in CONTEXT_FIELDS:
        # Hand it the Ukrainian text when answering in Ukrainian: it quotes the
        # same wording the reader sees on the page, and translates nothing twice.
        if lang == "uk" and UK_COLUMN.get(key) and row.get(UK_COLUMN[key]):
            key = UK_COLUMN[key]
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
        if creds := service_account_credentials():
            existing = genai.Client(vertexai=True, project=GCP_PROJECT,
                                    location=GCP_LOCATION, credentials=creds)
        elif key := os.getenv("GEMINI_API_KEY"):
            existing = genai.Client(api_key=key)
        else:
            existing = genai.Client(vertexai=True, project=GCP_PROJECT, location=GCP_LOCATION)
        _clients.c = existing
        _client_refs.append(existing)
    return existing


def service_account_credentials():
    """Credentials from a service-account JSON passed as an env var.

    The container has no gcloud and no metadata server, so ADC is not available
    in production. Taking the key as a variable rather than a mounted file keeps
    the deploy a single Coolify setting with nothing to copy onto the host.
    """
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        return None
    try:
        from google.oauth2 import service_account

        raw = raw.strip()
        if not raw.startswith("{"):
            # Also accept base64, which survives pasting into a settings UI that
            # would otherwise mangle a multi-line JSON blob.
            import base64

            raw = base64.b64decode(raw).decode("utf-8")
        return service_account.Credentials.from_service_account_info(
            json.loads(raw), scopes=["https://www.googleapis.com/auth/cloud-platform"]
        )
    except Exception as e:  # noqa: BLE001 — a malformed key must not take search down
        print(f"GOOGLE_SERVICE_ACCOUNT_JSON present but unusable: {str(e)[:200]}")
        return None


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

    if not assistant_available():
        # Fail fast and clearly. Falling through would call google.auth.default(),
        # which blocks on metadata-server discovery for tens of seconds.
        return JSONResponse({"error": "assistant_unavailable", "detail": "no credentials configured"},
                            status_code=503)

    language = {"uk": "Ukrainian", "en": "English"}.get(body.lang, "English")
    parts = [SYSTEM.format(language=language), "PROGRAMME DATA:",
             build_context(row_to_dict(row), body.lang)]
    if body.profile:
        told = {k: v for k, v in body.profile.model_dump().items() if v}
        if told:
            parts.append("READER PROFILE: " + ", ".join(f"{k}={v}" for k, v in told.items()))
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


ADC_FILE = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"


def assistant_available() -> bool:
    """Whether /api/ask has credentials at all — decided without any network call.

    Never call google.auth.default() here. Off GCP it probes the metadata server
    at 169.254.169.254 and blocks until that times out, which hung /api/health,
    failed the container health check, and made Coolify mark the deploy failed
    while the app itself was fine.
    """
    return bool(
        os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        or ADC_FILE.exists()
    )


@app.get("/api/health")
def health() -> dict[str, Any]:
    conn = db()
    try:
        n = conn.execute("SELECT COUNT(*) FROM programs").fetchone()[0]
    finally:
        conn.close()
    return {"ok": True, "programmes": n, "db": DB_PATH.name, "assistant": assistant_available()}


@app.get("/")
def index() -> FileResponse:
    # no-store: the page shipped stale once already and cost hours of confusion
    return FileResponse(INDEX, headers={"Cache-Control": "no-store"})
