"""Kounsly API — search over the real catalogue, and a grounded assistant.

The catalogue lives in Postgres with pgvector, built by kounsly-pipeline and
loaded with publish_pg.py. It was a SQLite file until the search stopped
scaling: every vector held in memory at startup, every query scored row by row
in Python. Ranking still happens here — the relevance window, the nudge for
completeness — but the candidates to rank come from an index.

The assistant answers **only** from one programme's stored fields. It is not a
general chatbot: an admissions answer that sounds right and is wrong costs a
user a year, and unbiased-and-sourced is the whole product. When a fact is not
in our data it says so and points at the official page.
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
from collections import defaultdict, deque
from datetime import date
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import auth

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"

# Absolute URLs, for the two files that cannot use relative ones: a sitemap
# entry and the Sitemap: line in robots.txt are both defined as absolute, and a
# crawler reading a relative one throws the file away.
SITE_ORIGIN = os.getenv("KOUNSLY_ORIGIN", "https://kounsly.com").rstrip("/")

# The catalogue lives in Postgres with pgvector. It was a SQLite file until the
# catalogue reached a size where the old search — every vector in a numpy matrix
# at startup, every query scored row by row in Python — stopped being cheap.
# Ranking still happens here; finding the candidates to rank happens in an index.
PG_DSN = os.getenv("KOUNSLY_PG", "postgresql://kounsly@127.0.0.1:15433/kounsly")

# Let the vector index keep looking when a filter is narrow. Without this an
# HNSW scan returns its first ef_search neighbours and *then* applies WHERE, so
# "data science in Denmark" can come back with three results out of a catalogue
# that holds thirty. pgvector 0.8 added iterative scans for exactly this.
PG_OPTIONS = "-c hnsw.iterative_scan=relaxed_order -c hnsw.ef_search=120"

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


@app.on_event("startup")
def migrate_user_db() -> None:
    """Bring the account schema up to what this code selects, before serving.

    Here rather than in a runbook because a runbook step is one a deploy can
    skip, and skipping this one broke every signed-in reader while leaving the
    catalogue looking perfectly healthy — see auth.apply_migrations. The call
    never raises: search must not stop working because the user database is
    behind or unreachable.
    """
    try:
        auth.apply_migrations()
    except Exception as e:  # noqa: BLE001
        print(f"migrations skipped: {str(e)[:200]}")

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

_pool: Any = None
_pool_lock = threading.Lock()


def pool():
    """Connections to the catalogue, opened on first use.

    Small on purpose: every query here is indexed and returns at most a page, so
    the work is short and a handful of connections serve far more concurrency
    than a search backend of this size will see.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                from psycopg.rows import dict_row
                from psycopg_pool import ConnectionPool

                _pool = ConnectionPool(
                    PG_DSN, min_size=1, max_size=8, timeout=10, max_idle=300,
                    kwargs={"row_factory": dict_row, "prepare_threshold": None,
                            "connect_timeout": 8, "options": PG_OPTIONS},
                    open=True, check=ConnectionPool.check_connection,
                )
    return _pool


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else []


def row_to_dict(row: dict[str, Any]) -> dict[str, Any]:
    """Postgres hands back native types for most columns; these three are still
    JSON text, because they are documents rather than fields."""
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
    """Turn free user text into safe prefix tokens for a tsquery.

    Users type sentences ("cheap data science master in English"), not query
    syntax, and stray quotes or operators would otherwise be a syntax error.
    Filter/level words are dropped here because the filters already express
    them — leaving them in makes every query match half the catalogue.
    """
    cleaned = "".join(c if c.isalnum() or c.isspace() else " " for c in raw.lower())
    words = [w for w in cleaned.split() if len(w) > 2 and w not in STOPWORDS]
    return [f"{w}:*" for w in words[:8]]


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

_parse_cache: dict[str, dict] = {}
_query_vec_cache: dict[str, Any] = {}

# How many neighbours the index is asked for before ranking happens here. The
# ordering rules below — the relevance window, the nudge for completeness — are
# unchanged; they just run over a few hundred candidates instead of the whole
# catalogue. Wide enough that the cut-off never runs out of rows to cut.
CANDIDATES = 400


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
    if not assistant_available():
        return None

    try:
        from google.genai import types

        resp = gemini_client().models.embed_content(
            model=EMBED_MODEL,
            contents=text,
            config=types.EmbedContentConfig(output_dimensionality=EMBED_DIM),
        )
        # Normalised here so cosine distance and dot product agree, and in plain
        # Python: numpy existed to hold the whole catalogue in a matrix, and the
        # index does that job now. One vector of 768 floats does not need it.
        raw = [float(v) for v in resp.embeddings[0].values]
        norm = math.sqrt(sum(v * v for v in raw)) or 1.0
        vec = [v / norm for v in raw]
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

    where: list[str] = ["TRUE"]
    params: list[Any] = []
    country = country or (inferred("country") or "")
    level = level or (inferred("level") or "")
    if max_tuition is None:
        max_tuition = inferred("max_tuition_eur_year")
    free_only = free_only or bool(inferred("free_only"))
    max_ielts = inferred("max_ielts")

    if country:
        where.append("p.country = %s")
        params.append(country.upper())
    if level:
        where.append("p.degree_level = %s")
        params.append(level)
    if area:
        where.append("p.area = %s")
        params.append(area)
    if subject:
        where.append("p.subject = %s")
        params.append(subject)
    if free_only:
        where.append("p.tuition_free = 1")
    if english_only:
        where.append("p.english_only = 1")
    if max_tuition is not None:
        # A programme with unknown tuition is not evidence of being affordable,
        # so it does not survive a budget filter.
        where.append("p.tuition_eur_year IS NOT NULL AND p.tuition_eur_year <= %s")
        params.append(max_tuition)
    if max_ielts is not None:
        where.append("p.ielts IS NOT NULL AND p.ielts <= %s")
        params.append(max_ielts)

    vec = query_vector(interpreted.get("subject") or q) if q.strip() else None

    if vec is not None:
        return semantic_search(where, params, vec, today_mmdd, sort, page, per_page, interpreted)
    return text_search(where, params, q, today_mmdd, sort, page, per_page, interpreted)


# "Which date comes next" depends on today, so it cannot be precomputed — but it
# no longer needs a second table and a join either. The dates sit on the row as
# an array of MMDD integers and this is arithmetic over them.
NEXT_DEADLINE = ("(SELECT MIN((d - %s + 10000) %% 10000) "
                 "FROM unnest(p.deadline_mmdds) AS d) AS next_deadline")


def order_by(sort: str) -> str:
    """The same orderings as before, expressed for Postgres.

    NULLS LAST is explicit: Postgres sorts nulls first on ASC, and a programme
    with no stated tuition heading the "cheapest" list is the kind of quiet
    wrongness that takes a week to notice.
    """
    # Every ordering ends in uid. Without a total order the database is free to
    # return ties in any order it likes, and it does — page 2 could repeat a row
    # from page 1 and drop another entirely. Sorting by deadline puts thousands
    # of programmes on the same date, so this is not a corner case.
    return {
        "tuition": "tuition_eur_year ASC NULLS LAST, quality DESC, uid",
        "deadline": "next_deadline ASC NULLS LAST, quality DESC, uid",
        "ielts": "ielts ASC NULLS LAST, quality DESC, uid",
    }.get(sort, "rank ASC, quality DESC, uid")


def semantic_search(where, params, vec, today_mmdd, sort, page, per_page, interpreted):
    """Ask the index for the nearest candidates, then rank them here.

    The ranking rules are the ones this site has always used — a relevance
    window relative to the best match, and a nudge for completeness — but they
    now run over a few hundred rows the index picked out rather than over every
    row that passed the filter. That is the whole point of the move: the same
    answers, without reading the catalogue to produce them.
    """
    literal = "[" + ",".join(f"{v:.6f}" for v in vec) + "]"
    clause = " AND ".join(where)

    sql = f"""
        SELECT {CARD_FIELDS},
               1 - (p.vec <=> %s::vector) AS similarity,
               {NEXT_DEADLINE}
        FROM programs p
        WHERE {clause} AND p.vec IS NOT NULL
        ORDER BY p.vec <=> %s::vector
        LIMIT %s
    """
    count_sql = f"SELECT COUNT(*) AS n FROM programs p WHERE {clause}"

    try:
        rows = query(sql, (literal, today_mmdd, *params, literal, CANDIDATES))
        in_filter = query(count_sql, tuple(params))[0]["n"]
    except Exception as e:  # noqa: BLE001 — a malformed filter is the caller's fault, not a 500
        raise HTTPException(400, f"bad query: {str(e)[:200]}") from e

    # A small nudge for completeness, so two similarly relevant programmes are
    # ordered by which one a user can act on. Kept well below the relevance
    # window so it breaks ties, not rankings.
    scored = [(float(r["similarity"]) + 0.004 * (r["quality"] or 0), r) for r in rows]

    # Same rule as the SQL orderings: uid last, so a tie never reshuffles between
    # one page and the next.
    if sort == "tuition":
        scored.sort(key=lambda s: (s[1]["tuition_eur_year"] is None,
                                   s[1]["tuition_eur_year"] or 0, -s[0], s[1]["uid"]))
    elif sort == "deadline":
        scored.sort(key=lambda s: (s[1]["next_deadline"] is None,
                                   s[1]["next_deadline"] or 0, -s[0], s[1]["uid"]))
    elif sort == "ielts":
        scored.sort(key=lambda s: (s[1]["ielts"] is None, s[1]["ielts"] or 0, -s[0], s[1]["uid"]))
    else:
        scored.sort(key=lambda s: (-s[0], s[1]["uid"]))

    # Similarity scores sit in a narrow band (best ~0.75, median ~0.60), so cut
    # relative to the best match rather than at an absolute value. Without this
    # the count reads "1,716 programmes" for a query about one subject, which is
    # true of the filter but useless as an answer.
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
    """Fallback when there is no vector for the phrase, or no credentials.

    Postgres' own text index, with the same two attempts as before: every word,
    then any word. AND keeps "data science" meaning data science; OR keeps a
    typo or an unusual phrasing from returning an empty page.
    """
    terms = fts_terms(q) if q.strip() else []
    attempts = [" & ".join(terms)] if terms else [None]
    if len(terms) > 1:
        attempts.append(" | ".join(terms))

    for i, tsquery in enumerate(attempts):
        clause = " AND ".join(where + (["p.fts @@ to_tsquery('simple', %s)"] if tsquery else []))
        rank = "ts_rank(p.fts, to_tsquery('simple', %s))" if tsquery else "0"
        filters = (*params, tsquery) if tsquery else tuple(params)

        count_sql = f"SELECT COUNT(*) AS n FROM programs p WHERE {clause}"
        sql = f"""
            SELECT {CARD_FIELDS},
                   -{rank} AS rank,
                   {NEXT_DEADLINE}
            FROM programs p
            WHERE {clause}
            ORDER BY {order_by(sort)}
            LIMIT %s OFFSET %s
        """
        try:
            total = query(count_sql, filters)[0]["n"]
            if not total and i < len(attempts) - 1:
                continue
            rank_params = (tsquery,) if tsquery else ()
            rows = query(sql, (*rank_params, today_mmdd, *filters,
                               per_page, (page - 1) * per_page))
        except Exception as e:  # noqa: BLE001
            raise HTTPException(400, f"bad query: {str(e)[:200]}") from e

        return {
            "total": total,
            "page": page,
            "per_page": per_page,
            "broadened": bool(terms) and i > 0,
            "semantic": False,
            "interpreted": interpreted,
            "items": [row_to_dict(r) for r in rows],
        }


@app.get("/api/facets")
def facets() -> dict[str, Any]:
    def counts(column: str) -> list[dict[str, Any]]:
        return [
            {"value": r["value"], "count": r["n"]}
            for r in query(
                f"SELECT {column} AS value, COUNT(*) AS n FROM programs "
                # Ties broken by name, not by whatever order the rows came back
                # in. The subject list is cut at 80, so an arbitrary tie at the
                # boundary silently swaps one field of study for another between
                # one deploy and the next.
                f"WHERE {column} IS NOT NULL GROUP BY {column} "
                f"ORDER BY COUNT(*) DESC, {column} ASC")
        ]

    totals = query("SELECT COUNT(*) AS total, "
                   "COUNT(*) FILTER (WHERE tuition_free = 1) AS free FROM programs")[0]
    return {
        "countries": counts("country"),
        "levels": counts("degree_level"),
        "areas": counts("area"),
        # Long tail truncated: 249 subjects is a catalogue, not a dropdown.
        "subjects": counts("subject")[:80],
        "total": totals["total"],
        "free": totals["free"],
    }


@app.get("/api/program/{uid}")
def program(uid: str) -> dict[str, Any]:
    rows = query("SELECT * FROM programs WHERE uid = %s", (uid,))
    if not rows:
        raise HTTPException(404, "no such programme")
    return row_to_dict(rows[0])


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
    # Sent by a signed-out visitor so their free questions follow the device
    # rather than the IP — a shared university network is one IP.
    anon_id: Optional[str] = Field(None, max_length=64)


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

    # Two different ceilings, and they answer different questions. The one above
    # is abuse control and has always been by IP. This one is the plan: how many
    # answers this reader gets before signing in or upgrading buys them more.
    user = auth.current_user(request)
    allowance = auth.quota(user, (body.anon_id or "")[:64])
    if not allowance["allowed"]:
        return JSONResponse({"error": "quota", **allowance}, status_code=402)

    found = query("SELECT * FROM programs WHERE uid = %s", (body.uid,))
    if not found:
        raise HTTPException(404, "no such programme")
    row = found[0]

    if not assistant_available():
        # Fail fast and clearly. Falling through would call google.auth.default(),
        # which blocks on metadata-server discovery for tens of seconds.
        return JSONResponse({"error": "assistant_unavailable", "detail": "no credentials configured"},
                            status_code=503)

    language = {"uk": "Ukrainian", "en": "English"}.get(body.lang, "English")
    parts = [SYSTEM.format(language=language), "PROGRAMME DATA:",
             build_context(row_to_dict(row), body.lang)]
    # The profile is read from the account, never from the request body: what
    # the assistant is told about a person has to be what that person saved
    # about themselves, not what a caller claims.
    if told := auth.profile_of(user):
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

    # Counted only now: a call that failed on our side is not one of the
    # reader's questions.
    auth.record_ask(user, (body.anon_id or "")[:64], body.uid)

    usage = getattr(resp, "usage_metadata", None)
    return JSONResponse({
        "answer": answer or "Не змогла сформувати відповідь. Спробуй перефразувати питання.",
        # Sent back so the page can show "2 questions left" before the reader
        # hits the wall instead of at it.
        "quota": {**allowance, "used": allowance["used"] + 1,
                  "remaining": None if allowance["remaining"] is None else max(0, allowance["remaining"] - 1)},
        "tokens": {
            "in": getattr(usage, "prompt_token_count", 0) or 0,
            "out": getattr(usage, "candidates_token_count", 0) or 0,
        },
    })


# ---------- accounts ----------
#
# The wall is deliberately late. Search, the full card and the first questions
# need no account, because a visitor who has not seen the catalogue has no
# reason to give us an address. What does need one is anything we would have to
# keep: a saved list, a deadline we promise to remind them about, and a profile
# that lets the page say "your date" instead of "a date".


class ProfileIn(BaseModel):
    citizenship: Optional[str] = None
    status: Optional[str] = None
    education: Optional[str] = None
    ielts: Optional[float] = Field(None, ge=0, le=9)
    toefl: Optional[int] = Field(None, ge=0, le=120)
    lang: Optional[str] = None
    # The rest of the profile. Bounds here are sanity, not policy: they exist so
    # a typo cannot store a graduation year of 20255 or a mark of a million.
    field: Optional[str] = Field(None, max_length=120)
    institution: Optional[str] = Field(None, max_length=160)
    grad_year: Optional[int] = Field(None, ge=1950, le=2100)
    gpa: Optional[float] = Field(None, ge=0, le=100)
    gpa_scale: Optional[str] = None
    english_self: Optional[str] = None
    intake: Optional[str] = None
    want_level: Optional[str] = None
    budget_max: Optional[int] = Field(None, ge=0, le=200000)


class UidsIn(BaseModel):
    uids: list[str] = Field(default_factory=list, max_length=200)


class ChecklistItem(BaseModel):
    text: str = Field("", max_length=auth.CHECK_MAX_TEXT)
    done: bool = False


class SavedNoteIn(BaseModel):
    note: Optional[str] = Field(None, max_length=auth.NOTE_MAX)
    state: Optional[str] = None
    checklist: Optional[list[ChecklistItem]] = Field(None, max_length=auth.CHECK_MAX_ITEMS)


def signed_in(request: Request) -> dict[str, Any]:
    user = auth.current_user(request)
    if not user:
        raise HTTPException(401, "sign in required")
    return user


def me_payload(user: dict[str, Any], request: Request) -> dict[str, Any]:
    return {
        "user": {
            "id": str(user["id"]),
            "email": user.get("email"),
            "plan": user.get("plan", "free"),
            "created_at": str(user.get("created_at") or ""),
            "onboarded": bool(user.get("onboarded")),
            "profile": {f: user.get(f) for f in auth.PROFILE_FIELDS},
        },
        "saved": auth.saved_uids(user["id"]),
        # The writing on the saved list, keyed by uid. Sent with everything else
        # rather than fetched when the account page opens: it is two short
        # columns, and one round trip that already happens beats a second one.
        "saved_meta": auth.saved_rows(user["id"]),
        "watched": auth.watched_uids(user["id"]),
        "history": auth.recent_searches(user["id"]),
        "quota": auth.quota(user, ""),
    }


@app.get("/api/config")
def config(anon_id: str = "") -> dict[str, Any]:
    """What the page needs before it knows who is looking at it.

    Includes the anonymous allowance so the assistant can show "1 question left"
    on the first visit rather than only discovering the limit by hitting it.
    """
    out = auth.public_config()
    out["quota"] = auth.quota(None, anon_id[:64]) if anon_id else None
    return out


@app.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    return me_payload(signed_in(request), request)


@app.put("/api/me")
def save_profile(body: ProfileIn, request: Request) -> dict[str, Any]:
    user = signed_in(request)
    updated = auth.update_profile(user["id"], body.model_dump(exclude_unset=True))
    return me_payload(updated, request)


@app.get("/api/me/export")
def export_me(request: Request) -> JSONResponse:
    """Everything we hold about this person, as a file they can keep.

    Content-Disposition so the browser saves it instead of rendering JSON in a
    tab: this is meant to be a copy of your data, and a copy you have to
    right-click to keep is a worse promise.
    """
    user = signed_in(request)
    stamp = date.today().isoformat()
    return JSONResponse(
        auth.export_data(user),
        headers={"Content-Disposition": f'attachment; filename="kounsly-{stamp}.json"'},
    )


@app.delete("/api/me")
def delete_me(request: Request) -> dict[str, Any]:
    """Erase this person's data. See auth.delete_account for what stays and why."""
    user = signed_in(request)
    auth.delete_account(user["id"])
    return {"deleted": True}


def add_to_list(kind: str, body: UidsIn, request: Request) -> dict[str, Any]:
    """Save programmes or watch their deadlines.

    Takes a list rather than one uid because this is also how a visitor's
    pre-sign-in shortlist arrives: they starred three programmes, then signed
    in, and all three land in one call. Losing that list at the moment of
    signing in is the fastest way to make an account feel like a toll gate.
    """
    user = signed_in(request)
    auth.add_many(kind, user["id"], body.uids)
    return me_payload(user, request)


def remove_from_list(kind: str, uid: str, request: Request) -> dict[str, Any]:
    user = signed_in(request)
    auth.remove(kind, user["id"], uid)
    return me_payload(user, request)


# Spelled out rather than one /api/{kind} route: a path parameter here would
# quietly swallow every future POST under /api/ that happens not to be a list.
@app.post("/api/saved")
def add_saved(body: UidsIn, request: Request) -> dict[str, Any]:
    return add_to_list("saved", body, request)


@app.delete("/api/saved/{uid}")
def remove_saved(uid: str, request: Request) -> dict[str, Any]:
    return remove_from_list("saved", uid, request)


@app.patch("/api/saved/{uid}")
def annotate_saved(uid: str, body: SavedNoteIn, request: Request) -> dict[str, Any]:
    """The reader's own note on a saved programme, and where they are with it.

    PATCH rather than PUT: the note and the status are set from two different
    controls, and sending one must not blank the other.
    """
    user = signed_in(request)
    auth.annotate_saved(user["id"], uid, body.model_dump(exclude_unset=True))  # pydantic → plain dicts
    return me_payload(user, request)


@app.post("/api/watch")
def add_watch(body: UidsIn, request: Request) -> dict[str, Any]:
    return add_to_list("watch", body, request)


@app.delete("/api/watch/{uid}")
def remove_watch(uid: str, request: Request) -> dict[str, Any]:
    return remove_from_list("watch", uid, request)


class SearchIn(BaseModel):
    q: str = Field("", max_length=200)
    params: str = Field("", max_length=500)


@app.post("/api/history")
def remember_search(body: SearchIn, request: Request) -> dict[str, Any]:
    """Remember a search. Fire-and-forget from the page's point of view.

    Recorded here rather than inside /api/search so that the search itself
    stays a plain GET that costs nothing and needs no token: a signed-out
    visitor's queries are not ours to keep, and a search must not wait on a
    write to a second database before it can show results.
    """
    user = signed_in(request)
    auth.record_search(user["id"], body.q, body.params)
    return {"history": auth.recent_searches(user["id"])}


@app.delete("/api/history")
def forget_search(request: Request, q: str = "") -> dict[str, Any]:
    """Drop one search, or the whole history when `q` is absent."""
    user = signed_in(request)
    auth.forget_searches(user["id"], q)
    return {"history": auth.recent_searches(user["id"])}


@app.get("/api/programs")
def programs_by_uid(uids: str = "") -> dict[str, Any]:
    """Card rows for an explicit set of uids — how a saved list is rendered.

    A uid that is no longer in the catalogue is simply absent from the result
    rather than an error: sources drop programmes, and that must not break a
    page listing the other four.
    """
    wanted = [u for u in uids.split(",") if u.strip()][:200]
    if not wanted:
        return {"items": []}
    today_mmdd = date.today().month * 100 + date.today().day
    rows = query(
        f"""SELECT {CARD_FIELDS}, {NEXT_DEADLINE}
            FROM programs p WHERE p.uid = ANY(%s)""",
        (today_mmdd, wanted),
    )
    # Returned in the order asked for, which is the order they were saved in.
    by_uid = {r["uid"]: row_to_dict(r) for r in rows}
    return {"items": [by_uid[u] for u in wanted if u in by_uid]}


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
    n = query("SELECT COUNT(*) AS n FROM programs")[0]["n"]
    out = {"ok": True, "programmes": n, "db": "postgres",
           "assistant": assistant_available(), "accounts": auth.accounts_available()}
    # Which signing keys this deployment can check, and which the project
    # publishes. No key material — see token_diagnosis. Here rather than in a
    # log because "signed in, then immediately not" is the one auth failure that
    # leaves no trace anyone can look at from outside.
    if out["accounts"]:
        out["tokens"] = auth.token_diagnosis()
    return out


LEGAL = ROOT / "legal.html"


@app.get("/terms")
@app.get("/privacy")
def legal() -> FileResponse:
    """Terms and the privacy policy — two real addresses, one file.

    Real addresses because they are linked from the sign-in box and will be
    handed to a payment provider, and neither a hash nor a modal is something
    you can put in a form. One file because they share a header, a footer and
    every style, and the page decides which of the two to show from the path.
    """
    return FileResponse(LEGAL, headers={"Cache-Control": "no-store"})


@app.get("/")
def index() -> FileResponse:
    # no-store: the page shipped stale once already and cost hours of confusion
    return FileResponse(INDEX, headers={"Cache-Control": "no-store"})


ICON = ROOT / "static" / "icon.svg"

# A week. The icon and these two files change roughly never, and unlike the
# page they carry nothing that goes stale in a way anyone would notice.
_STATIC_CACHE = {"Cache-Control": "public, max-age=604800"}


@app.get("/favicon.ico")
@app.get("/icon.svg")
def favicon() -> FileResponse:
    """The tab icon, at both addresses browsers look for it.

    `/favicon.ico` is requested by every browser on every first visit whether or
    not the page asks for one, and answering it with the API's JSON 404 put an
    error in the log for every visitor and left the tab blank. One SVG serves
    both: the content type is what is read, not the extension.
    """
    return FileResponse(ICON, media_type="image/svg+xml", headers=_STATIC_CACHE)


@app.get("/robots.txt")
def robots() -> Response:
    """Crawlers are welcome everywhere except the API.

    Nothing under /api is a page: indexing it spends the crawl budget for this
    site on JSON that would never be a useful result.
    """
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        "Disallow: /api/\n"
        f"\nSitemap: {SITE_ORIGIN}/sitemap.xml\n"
    )
    return Response(body, media_type="text/plain", headers=_STATIC_CACHE)


@app.get("/sitemap.xml")
def sitemap() -> Response:
    """The three addresses that are real pages.

    Programmes are not in here on purpose. They have no URLs of their own yet —
    a programme opens in a sheet over the search — so listing them would be
    listing pages that do not exist. When they get addresses, they belong here.
    """
    pages = ["/", "/terms", "/privacy"]
    urls = "".join(f"<url><loc>{SITE_ORIGIN}{p}</loc></url>" for p in pages)
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{urls}</urlset>"
    )
    return Response(body, media_type="application/xml", headers=_STATIC_CACHE)


@app.exception_handler(404)
def not_found(request: Request, exc: Any) -> Response:
    """A mistyped address should land on the site, not on the API's error body.

    Everything under /api is answered by a program and keeps its JSON. Anything
    else was typed or followed by a person, and `{"detail":"Not Found"}` in a
    browser window is the site looking broken rather than the address being
    wrong.
    """
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    # 404, not a redirect: the address really is not a page, and telling a
    # crawler otherwise gets every typo indexed as a copy of the home page.
    return FileResponse(INDEX, status_code=404, headers={"Cache-Control": "no-store"})
