"""Accounts: who the reader is, and what that lets them do.

Identity is Supabase's job. It runs the Google and Apple redirects, sends the
one-time codes, and hands the browser a signed JWT; this module only *verifies*
that token and keeps the rows that belong to a person. We never see a password,
an OAuth secret or a refresh token — that is the whole reason for using it.

Everything here degrades to off. With no Supabase settings configured the site
is exactly what it was: search, cards and a metered assistant for anonymous
visitors. That is deliberate — the catalogue must never stop working because a
second service is down, and it means this can ship before the project exists.
"""
from __future__ import annotations

import os
import threading
from datetime import date, datetime, timezone
from typing import Any, Optional

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET") or ""   # legacy HS256 projects
DATABASE_URL = os.getenv("DATABASE_URL") or ""

# What each tier may ask. The anonymous allowance is a demo, not a free plan:
# enough to see that the assistant answers from real data and not from the air,
# which is the thing worth making an account for.
ANON_ASKS = int(os.getenv("KOUNSLY_ANON_ASKS", "3"))            # per device, lifetime
FREE_ASKS_PER_MONTH = int(os.getenv("KOUNSLY_FREE_ASKS", "15"))
PRO_ASKS_PER_MONTH = int(os.getenv("KOUNSLY_PRO_ASKS", "600"))  # a ceiling on abuse, not a plan limit

PROFILE_FIELDS = ("citizenship", "status", "education", "ielts", "toefl")

# Which values we accept for the enumerated profile fields. A free-text
# citizenship would reach the assistant's prompt, so the set is closed here.
ALLOWED = {
    "citizenship": {"UA", "EU", "OTHER"},
    "status": {"none", "protection"},
    "education": {"school", "bachelor", "master"},
}


def accounts_available() -> bool:
    """Whether sign-in is configured — decided without a network call.

    Same rule as assistant_available(): /api/health is called by the container
    health check every 30s and must never wait on anything remote.
    """
    return bool(SUPABASE_URL and DATABASE_URL)


# ---------- token verification ----------

_jwk_client: Any = None
_jwk_lock = threading.Lock()


def _jwks():
    """Cached JWKS client for Supabase's asymmetric (ES256) signing keys.

    Built lazily and once: constructing it is cheap but it holds a key cache,
    and a new one per request would fetch the key set per request.
    """
    global _jwk_client
    if _jwk_client is None:
        with _jwk_lock:
            if _jwk_client is None:
                from jwt import PyJWKClient

                _jwk_client = PyJWKClient(
                    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
                    cache_keys=True,
                    lifespan=3600,
                )
    return _jwk_client


def verify_token(token: str) -> Optional[dict[str, Any]]:
    """Claims from a valid Supabase access token, or None.

    Returns None rather than raising for every failure mode, expired included:
    an unreadable token means "not signed in", which every caller here already
    handles. Supabase issues ES256 on current projects and HS256 on older ones,
    so both are accepted — but only the one the project is actually configured
    for, never "whatever the header says".
    """
    import jwt

    if not token or not accounts_available():
        return None
    try:
        options = {"require": ["exp", "sub"]}
        common = dict(audience="authenticated", issuer=f"{SUPABASE_URL}/auth/v1",
                      options=options, leeway=10)
        if SUPABASE_JWT_SECRET:
            return jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], **common)
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["ES256", "RS256"], **common)
    except Exception as e:  # noqa: BLE001 — an invalid token is a logged-out user, not an error
        print(f"token rejected: {type(e).__name__}: {str(e)[:120]}")
        return None


def bearer(request) -> Optional[str]:
    header = request.headers.get("authorization") or ""
    return header[7:].strip() if header.lower().startswith("bearer ") else None


# ---------- storage ----------

_pool: Any = None
_pool_lock = threading.Lock()


def pool():
    """Connection pool to the user database, opened on first use.

    prepare_threshold=None because Supabase's pooler runs in transaction mode:
    psycopg starts using server-side prepared statements after a few repeats of
    the same query, and those do not survive a connection being handed to
    another session between statements.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                from psycopg.rows import dict_row
                from psycopg_pool import ConnectionPool

                _pool = ConnectionPool(
                    DATABASE_URL, min_size=0, max_size=4, timeout=8,
                    max_idle=120, kwargs={"row_factory": dict_row,
                                          "prepare_threshold": None,
                                          "connect_timeout": 8},
                    open=True, check=ConnectionPool.check_connection,
                )
    return _pool


def query(sql: str, params: tuple = (), *, one: bool = False, write: bool = False):
    with pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        if write and cur.description is None:
            return None
        return cur.fetchone() if one else cur.fetchall()


def ensure_user(claims: dict[str, Any]) -> dict[str, Any]:
    """The app_user row for these claims, created on first sight.

    Supabase owns auth.users; this row is ours and holds the profile. Doing it
    on read rather than with a database trigger keeps the account and the
    profile in one place we control, and means a user created by any sign-in
    method — Google, Apple, e-mail — arrives here identically.
    """
    return query(
        """
        INSERT INTO app_user (id, email) VALUES (%s, %s)
        ON CONFLICT (id) DO UPDATE
          SET seen_at = now(),
              email = COALESCE(EXCLUDED.email, app_user.email)
        RETURNING *
        """,
        (claims["sub"], claims.get("email")),
        one=True, write=True,
    )


def current_user(request) -> Optional[dict[str, Any]]:
    """The signed-in user, or None. Never raises: signed-out is not an error."""
    if not accounts_available():
        return None
    claims = verify_token(bearer(request) or "")
    if not claims:
        return None
    try:
        return ensure_user(claims)
    except Exception as e:  # noqa: BLE001 — the database being down logs people out, it does not 500 the page
        print(f"user lookup failed: {str(e)[:160]}")
        return None


def update_profile(user_id: str, data: dict[str, Any]) -> dict[str, Any]:
    """Write the profile fields that were actually supplied.

    Only the known columns, only the allowed values, and an explicit null is
    kept as "cleared" rather than ignored — a person removing their IELTS score
    is saying something.
    """
    sets, params = [], []
    for field in PROFILE_FIELDS:
        if field not in data:
            continue
        value = data[field]
        if isinstance(value, str):
            value = value.strip() or None
        if field in ALLOWED and value is not None and value not in ALLOWED[field]:
            continue
        sets.append(f"{field} = %s")
        params.append(value)
    if "lang" in data and data["lang"] in ("uk", "en"):
        sets.append("lang = %s")
        params.append(data["lang"])
    sets.append("onboarded = true")

    params.append(user_id)
    return query(f"UPDATE app_user SET {', '.join(sets)} WHERE id = %s RETURNING *",
                 tuple(params), one=True, write=True)


def profile_of(user: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    """The profile in the shape the assistant's prompt expects, or None."""
    if not user:
        return None
    told = {f: user.get(f) for f in PROFILE_FIELDS if user.get(f) not in (None, "")}
    return {k: str(v) for k, v in told.items()} or None


# ---------- saved programmes and watched deadlines ----------

def saved_uids(user_id: str) -> list[str]:
    rows = query("SELECT uid FROM saved_program WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
    return [r["uid"] for r in rows]


def watched_uids(user_id: str) -> list[str]:
    rows = query("SELECT uid FROM deadline_watch WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
    return [r["uid"] for r in rows]


TABLES = {"saved": "saved_program", "watch": "deadline_watch"}


def add_many(kind: str, user_id: str, uids: list[str]) -> None:
    """Save a batch, ignoring ones already there.

    Batched because this is also the merge path: everything a visitor saved
    before signing in arrives in one call at the moment they sign in.
    """
    uids = [u for u in dict.fromkeys(uids) if u][:200]
    if not uids:
        return
    values = ",".join(["(%s, %s)"] * len(uids))
    params: list[Any] = []
    for uid in uids:
        params += [user_id, uid]
    query(f"INSERT INTO {TABLES[kind]} (user_id, uid) VALUES {values} ON CONFLICT DO NOTHING",
          tuple(params), write=True)


def remove(kind: str, user_id: str, uid: str) -> None:
    query(f"DELETE FROM {TABLES[kind]} WHERE user_id = %s AND uid = %s", (user_id, uid), write=True)


# ---------- search history ----------

RECENT_SEARCHES = 8


def record_search(user_id: str, q: str, params: str = "") -> None:
    """Remember a phrase this reader searched for.

    Re-searching the same phrase moves it back to the top instead of adding a
    row: what makes this useful is getting back to a search, and one search
    repeated is one thing to get back to.

    Never raises. A history write failing must not turn a working search into a
    broken page — this is a convenience, and the results are the product.
    """
    q = (q or "").strip()[:200]
    if not accounts_available() or not q:
        return
    try:
        query(
            """
            INSERT INTO search_event (user_id, q, params) VALUES (%s, %s, %s)
            ON CONFLICT (user_id, q) DO UPDATE
              SET created_at = now(), params = EXCLUDED.params
            """,
            (user_id, q, (params or "")[:500]), write=True,
        )
    except Exception as e:  # noqa: BLE001
        print(f"search not recorded: {str(e)[:160]}")


def recent_searches(user_id: str) -> list[dict[str, Any]]:
    try:
        rows = query(
            "SELECT q, params FROM search_event WHERE user_id = %s ORDER BY created_at DESC LIMIT %s",
            (user_id, RECENT_SEARCHES),
        )
    except Exception as e:  # noqa: BLE001
        print(f"history unavailable: {str(e)[:160]}")
        return []
    return [{"q": r["q"], "params": r["params"] or ""} for r in rows]


def forget_searches(user_id: str, q: str = "") -> None:
    """Drop one remembered search, or all of them.

    Deleting your own history has to work without asking us, and it has to be
    a real delete — there is no archived copy of this table.
    """
    if q:
        query("DELETE FROM search_event WHERE user_id = %s AND q = %s", (user_id, q[:200]), write=True)
    else:
        query("DELETE FROM search_event WHERE user_id = %s", (user_id,), write=True)


# ---------- the meter ----------

def _month_start() -> datetime:
    today = date.today()
    return datetime(today.year, today.month, 1, tzinfo=timezone.utc)


def quota(user: Optional[dict[str, Any]], anon_id: str) -> dict[str, Any]:
    """How many questions this reader has left, and what would raise it.

    `scope` is what the front end shows on the wall: "anon" means signing in
    lifts the limit, "free" means upgrading does, "pro" means neither.
    """
    if not accounts_available():
        # Nothing to meter against and nowhere to sign up: leave the old
        # IP-per-hour guardrail as the only limit, as before.
        return {"allowed": True, "used": 0, "limit": None, "remaining": None, "scope": "off"}

    try:
        if user:
            limit = PRO_ASKS_PER_MONTH if user.get("plan") == "pro" else FREE_ASKS_PER_MONTH
            row = query("SELECT COUNT(*) AS n FROM ask_event WHERE user_id = %s AND created_at >= %s",
                        (user["id"], _month_start()), one=True)
            scope = "pro" if user.get("plan") == "pro" else "free"
        else:
            limit = ANON_ASKS
            row = query("SELECT COUNT(*) AS n FROM ask_event WHERE anon_id = %s", (anon_id,), one=True)
            scope = "anon"
    except Exception as e:  # noqa: BLE001 — if the meter is unreachable, let the question through
        print(f"quota check failed, allowing: {str(e)[:160]}")
        return {"allowed": True, "used": 0, "limit": None, "remaining": None, "scope": "off"}

    used = int((row or {}).get("n") or 0)
    return {"allowed": used < limit, "used": used, "limit": limit,
            "remaining": max(0, limit - used), "scope": scope}


def record_ask(user: Optional[dict[str, Any]], anon_id: str, uid: str) -> None:
    """Count a question. Called only after one was actually answered — a failed
    call is our problem, not the reader's allowance."""
    if not accounts_available():
        return
    try:
        query("INSERT INTO ask_event (user_id, anon_id, uid) VALUES (%s, %s, %s)",
              (user["id"] if user else None, None if user else (anon_id or "?"), uid), write=True)
    except Exception as e:  # noqa: BLE001
        print(f"ask not recorded: {str(e)[:160]}")


def public_config() -> dict[str, Any]:
    """What the browser needs to start a sign-in. The anon key is publishable by
    design — it is the key Supabase's own client library ships to the page."""
    return {
        "enabled": accounts_available(),
        "url": SUPABASE_URL,
        "anon_key": os.getenv("SUPABASE_ANON_KEY") or "",
        "providers": [p.strip() for p in os.getenv("KOUNSLY_PROVIDERS", "google,apple,email").split(",") if p.strip()],
        "anon_asks": ANON_ASKS,
        "free_asks": FREE_ASKS_PER_MONTH,
        # Off until custom SMTP is configured, and for a specific reason:
        # Supabase refuses to edit e-mail templates on its built-in mailer, and
        # the stock Magic Link template sends a *link*, not the six-digit token
        # our box asks for. Offering "e-mail me a code" that answers with a link
        # is worse than not offering it. Turn this on in the same change as the
        # SMTP settings, not before.
        "email_code": os.getenv("KOUNSLY_EMAIL_CODE", "").lower() in ("1", "true", "on", "yes"),
        # Off until something actually sends the reminders. The button is a
        # promise — "we will e-mail you before this closes" — and a promise with
        # no sender behind it is the same mistake as telling someone which
        # deadline is theirs before there was an account to know it from.
        "reminders": os.getenv("KOUNSLY_REMINDERS", "").lower() in ("1", "true", "on", "yes"),
    }
