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

import json
import os
import threading
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Optional

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET") or ""   # legacy HS256 projects
DATABASE_URL = os.getenv("DATABASE_URL") or ""

# What each tier may ask. The anonymous allowance is a demo, not a free plan:
# enough to see that the assistant answers from real data and not from the air,
# which is the thing worth making an account for.
ANON_ASKS = int(os.getenv("KOUNSLY_ANON_ASKS", "2"))            # per device, lifetime
FREE_ASKS_PER_MONTH = int(os.getenv("KOUNSLY_FREE_ASKS", "15"))
PRO_ASKS_PER_MONTH = int(os.getenv("KOUNSLY_PRO_ASKS", "600"))  # a ceiling on abuse, not a plan limit

# How many programmes an anonymous reader may open in full. Counted in the
# browser, not here, and deliberately so: /api/program stays public because the
# cards link to it and a search engine should be able to read it. This is a shop
# window, not a lock — the point is to ask for an account at the moment the
# catalogue has already proved it is worth one.
ANON_VIEWS = int(os.getenv("KOUNSLY_ANON_VIEWS", "2"))

# The four the onboarding asks, plus what the account page adds. Order matters
# only for the export file, which is read by people.
PROFILE_FIELDS = (
    "citizenship", "status", "education", "ielts", "toefl",
    "field", "institution", "grad_year", "gpa", "gpa_scale", "english_self",
    "intake", "want_level", "budget_max",
)

# Which values we accept for the enumerated profile fields. A free-text
# citizenship would reach the assistant's prompt, so the set is closed here.
ALLOWED = {
    "citizenship": {"UA", "EU", "OTHER"},
    "status": {"none", "protection"},
    "education": {"school", "bachelor", "master"},
    "gpa_scale": {"100", "12", "5", "4"},
    "english_self": {"A2", "B1", "B2", "C1", "C2"},
    "intake": {"2026-fall", "2027-spring", "2027-fall", "undecided"},
    "want_level": {"bachelor", "master", "any"},
}

# The two fields a person writes themselves, and the only ones on the profile
# that are not from a closed list. Capped because both reach the assistant's
# prompt: a profile is context, not an input channel.
FREE_TEXT = {"field": 120, "institution": 160}

# What the assistant is told. The mark is left out on purpose: it is stored with
# its scale and converted only as an on-screen approximation, and handing a
# model "gpa 91" invites it to state a German grade as if a university had said
# so. Same reason `status` is here but nothing is derived from it.
PROMPT_FIELDS = ("citizenship", "status", "education", "ielts", "toefl", "field", "english_self")


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
    handles.

    Supabase signs with a key pair on current projects and a shared secret on
    older ones, and which one is in force is not ours to assume. It used to be
    decided by whether SUPABASE_JWT_SECRET happened to be set, and that is a
    trap with no symptom: a secret left over from an older project, on a project
    that has since moved to ES256, makes every genuine token fail verification.
    Signing in then works perfectly — Supabase issues the token, the browser
    stores it — and the very next request is answered "not signed in", so the
    page drops back to a sign-in button and nothing anywhere says why.

    So the token's own header chooses, and each algorithm is verified only with
    a key of its own kind: HS256 against the shared secret, ES256/RS256 against
    the published key set. That is not "whatever the header says" — an ES256
    token can never be checked against the secret, and an HS256 one can never be
    checked against a public key, which is the algorithm-confusion attack this
    shape is usually warned about. Anything else is refused outright.
    """
    import jwt

    if not token or not accounts_available():
        return None
    try:
        common = dict(audience="authenticated", issuer=f"{SUPABASE_URL}/auth/v1",
                      options={"require": ["exp", "sub"]}, leeway=10)
        alg = (jwt.get_unverified_header(token) or {}).get("alg", "")

        if alg == "HS256":
            if not SUPABASE_JWT_SECRET:
                print("token rejected: HS256 token but no SUPABASE_JWT_SECRET is set")
                return None
            return jwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], **common)

        if alg in ("ES256", "RS256"):
            key = _jwks().get_signing_key_from_jwt(token).key
            return jwt.decode(token, key, algorithms=["ES256", "RS256"], **common)

        print(f"token rejected: unsupported alg {alg!r}")
        return None
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


MIGRATIONS = Path(__file__).resolve().parent / "migrations"


def apply_migrations() -> list[str]:
    """Bring the user database up to the schema this code expects.

    Applied on startup rather than by hand, because by hand is what failed.
    003 adds saved_program.checklist; the code that selects that column shipped;
    the column was never added to the project; and from that moment every
    signed-in reader got a 500 from /api/me. Sign-in itself worked perfectly —
    Supabase issued the token, the browser stored it — so the page simply went
    back to showing a sign-in button, and the catalogue looked entirely healthy
    the whole time. A schema step that a deploy can forget is a schema step that
    a deploy will forget.

    Every file is written to be idempotent — `add column if not exists`,
    `create table if not exists`, `drop constraint if exists` before adding one —
    so running all of them on every boot is a no-op once they are applied.

    Never fatal. The catalogue must not stop serving search because the user
    database is unreachable or a statement was refused; that is the same rule
    the rest of this module follows.
    """
    if not accounts_available() or not MIGRATIONS.is_dir():
        return []
    done = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        sql = path.read_text(encoding="utf-8").strip()
        if not sql:
            continue
        try:
            with pool().connection() as conn, conn.cursor() as cur:
                cur.execute(sql)
            done.append(path.name)
        except Exception as e:  # noqa: BLE001
            print(f"migration {path.name} failed: {str(e)[:200]}")
    if done:
        print("migrations applied: " + ", ".join(done))
    return done


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
        if field in FREE_TEXT and isinstance(value, str):
            value = value[: FREE_TEXT[field]]
        if field in ALLOWED and value is not None and str(value) not in ALLOWED[field]:
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
    """The profile in the shape the assistant's prompt expects, or None.

    A deliberately smaller set than the profile page collects — see
    PROMPT_FIELDS for which parts of it the model is not told, and why.
    """
    if not user:
        return None
    told = {f: user.get(f) for f in PROMPT_FIELDS if user.get(f) not in (None, "")}
    return {k: str(v) for k, v in told.items()} or None


# ---------- saved programmes and watched deadlines ----------

def saved_uids(user_id: str) -> list[str]:
    rows = query("SELECT uid FROM saved_program WHERE user_id = %s ORDER BY created_at DESC", (user_id,))
    return [r["uid"] for r in rows]


SAVED_STATES = {"applying", "thinking", "dropped"}
NOTE_MAX = 2000


CHECK_MAX_ITEMS = 30
CHECK_MAX_TEXT = 200


def clean_checklist(raw: Any) -> Optional[list[dict[str, Any]]]:
    """Accept a checklist only in the shape we wrote it.

    Every line is a person's own words about their own application, so the text
    is kept as typed — trimmed and length-capped, not parsed. Anything that is
    not a line with text is dropped rather than stored as an empty tick.
    """
    if raw is None:
        return None
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw[:CHECK_MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()[:CHECK_MAX_TEXT]
        if not text:
            continue
        out.append({"text": text, "done": bool(item.get("done"))})
    return out


def saved_rows(user_id: str) -> dict[str, dict[str, Any]]:
    """Everything the reader added to a saved programme, keyed by uid.

    Separate from saved_uids() because the order of the list and the writing on
    it are different questions, and the card view needs only the first.

    Falls back to the columns that certainly exist if one of the newer ones does
    not. This is where the missing checklist column turned into a 500 for the
    whole account, and the account is worth more than any single column on it:
    a saved list without its notes is degraded, a reader who cannot sign in at
    all is broken. The migration runs on startup now, so this is a second line
    rather than the plan.
    """
    columns = "uid, note, state, checklist"
    try:
        rows = query(
            f"SELECT {columns} FROM saved_program WHERE user_id = %s ORDER BY created_at DESC",
            (user_id,),
        )
    except Exception as e:  # noqa: BLE001
        print(f"saved_rows falling back to bare columns: {str(e)[:160]}")
        try:
            rows = query(
                "SELECT uid FROM saved_program WHERE user_id = %s ORDER BY created_at DESC",
                (user_id,),
            )
        except Exception as e2:  # noqa: BLE001
            print(f"saved_rows unavailable: {str(e2)[:160]}")
            return {}
    return {r["uid"]: {"note": r.get("note") or "", "state": r.get("state"),
                       "checklist": r.get("checklist")} for r in rows}


def annotate_saved(user_id: str, uid: str, data: dict[str, Any]) -> None:
    """Set the note and/or the state on one saved programme.

    Only touches a row that is already saved: annotating something that was
    never starred would quietly add it to the list, and a note is not a save.
    """
    sets, params = [], []
    if "note" in data:
        note = (data["note"] or "").strip()[:NOTE_MAX]
        sets.append("note = %s")
        params.append(note or None)
    if "state" in data:
        state = data["state"] or None
        if state is not None and state not in SAVED_STATES:
            state = None
        sets.append("state = %s")
        params.append(state)
    if "checklist" in data:
        import json as _json

        items = clean_checklist(data["checklist"])
        sets.append("checklist = %s")
        params.append(_json.dumps(items) if items else None)
    if not sets:
        return
    params += [user_id, uid]
    query(f"UPDATE saved_program SET {', '.join(sets)} WHERE user_id = %s AND uid = %s",
          tuple(params), write=True)


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

# How many the browser gets. Was eight, when this was eight chips under the
# search box; the panel that replaced them shows a few and expands, so it needs
# more than fits on one row but nowhere near the whole history.
RECENT_SEARCHES = 25


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


def recent_searches(user_id: str, limit: Optional[int] = RECENT_SEARCHES) -> list[dict[str, Any]]:
    """The reader's own searches, newest first.

    `limit=None` is the export: the panel under the search box shows the
    handful you would plausibly go back to, but "give me my data" means all of
    it, not the same eight.
    """
    sql = "SELECT q, params, created_at FROM search_event WHERE user_id = %s ORDER BY created_at DESC"
    params: tuple = (user_id,)
    if limit is not None:
        sql += " LIMIT %s"
        params += (limit,)
    try:
        rows = query(sql, params)
    except Exception as e:  # noqa: BLE001
        print(f"history unavailable: {str(e)[:160]}")
        return []
    return [{"q": r["q"], "params": r["params"] or "", "at": str(r["created_at"])} for r in rows]


def forget_searches(user_id: str, q: str = "") -> None:
    """Drop one remembered search, or all of them.

    Deleting your own history has to work without asking us, and it has to be
    a real delete — there is no archived copy of this table.
    """
    if q:
        query("DELETE FROM search_event WHERE user_id = %s AND q = %s", (user_id, q[:200]), write=True)
    else:
        query("DELETE FROM search_event WHERE user_id = %s", (user_id,), write=True)


# ---------- taking your data, and leaving ----------

def export_data(user: dict[str, Any]) -> dict[str, Any]:
    """Everything we hold about this person, in one readable file.

    Written from the same tables the product reads, not from a summary: if a
    row is not in here, we do not have it. That is the claim the button makes,
    and it is only true as long as this function stays the whole of it.
    """
    user_id = user["id"]
    saved = saved_rows(user_id)
    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {
            "email": user.get("email"),
            "created_at": str(user.get("created_at") or ""),
            "plan": user.get("plan", "free"),
            "lang": user.get("lang", "uk"),
        },
        "profile": {f: _plain(user.get(f)) for f in PROFILE_FIELDS},
        "saved": [{"uid": uid, **row} for uid, row in saved.items()],
        "deadline_reminders": watched_uids(user_id),
        "searches": recent_searches(user_id, limit=None),
        "questions_this_month": quota(user, "").get("used", 0),
    }


def _plain(value: Any) -> Any:
    """JSON-safe: psycopg hands back Decimal for numeric columns."""
    from decimal import Decimal

    return float(value) if isinstance(value, Decimal) else value


def delete_account(user_id: str) -> None:
    """Erase the person's data. Not reversible, and there is no archived copy.

    Deletes our own row and lets `on delete cascade` take the saved list, the
    reminders, the history and the question counter with it. The row in
    auth.users is Supabase's and stays: removing it needs a service_role key,
    and keeping a key that can read every account in the project — on the
    server, for one button — is a worse trade than an orphaned identity row
    that now points at nothing. The interface says "delete all your data"
    rather than "delete your account" for exactly this reason.
    """
    query("DELETE FROM app_user WHERE id = %s", (user_id,), write=True)


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


_settings: dict[str, Any] = {}
_settings_at = 0.0
_settings_lock = threading.Lock()


def auth_settings() -> dict[str, Any]:
    """What Supabase itself says is switched on, cached for five minutes.

    Read rather than assumed, because the two lists came apart in exactly the
    way that is hardest to see from the outside: KOUNSLY_PROVIDERS said
    "google,apple,email", the project had only e-mail enabled, and pressing
    "Continue with Google" navigated to a Supabase URL that answered a raw
    400 — `provider is not enabled` — which in a browser reads as the sign-in
    doing nothing at all. A button for a provider that cannot work is worse than
    no button, and this endpoint is the only honest source for which can.

    Unreachable means we fall back to the env var: a button that might fail is
    still better than a page with no way in.
    """
    global _settings, _settings_at
    if not SUPABASE_URL:
        return {}
    now = time.monotonic()
    # The timestamp is the freshness marker, not the contents: an empty answer
    # has to be cached as firmly as a full one, or a failure is retried on every
    # request and the retry is what costs the four seconds.
    if _settings_at and now - _settings_at < 300:
        return _settings
    with _settings_lock:
        if _settings_at and time.monotonic() - _settings_at < 300:
            return _settings
        try:
            req = urllib.request.Request(
                f"{SUPABASE_URL}/auth/v1/settings",
                headers={"apikey": os.getenv("SUPABASE_ANON_KEY") or ""},
            )
            with urllib.request.urlopen(req, timeout=4) as response:
                _settings = json.loads(response.read().decode()) or {}
        except Exception as e:  # noqa: BLE001 — a slow auth host must not hold up the page
            print(f"auth settings unreadable: {str(e)[:160]}")
        finally:
            # Stamped whether or not it worked, so a failure is cached too.
            # Without this, an auth host that is down turns every /api/config —
            # which is on the page's boot path — into a four-second wait, and
            # slow is how an outage on their side becomes an outage on ours.
            _settings_at = now
    return _settings


def token_diagnosis() -> dict[str, Any]:
    """How this deployment can verify a token, without revealing any key.

    Here because the failure it describes is invisible from outside: a session
    that signs in and is refused on the next request looks like broken sign-in
    and is a key mismatch. `secret_set` is a yes or no, never the secret.
    """
    out: dict[str, Any] = {
        "secret_set": bool(SUPABASE_JWT_SECRET),
        "published_algorithms": [],
    }
    if not SUPABASE_URL:
        return out
    try:
        req = urllib.request.Request(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            headers={"apikey": os.getenv("SUPABASE_ANON_KEY") or ""},
        )
        with urllib.request.urlopen(req, timeout=4) as response:
            keys = (json.loads(response.read().decode()) or {}).get("keys") or []
        out["published_algorithms"] = sorted({k.get("alg", "?") for k in keys})
    except Exception as e:  # noqa: BLE001
        out["published_algorithms"] = ["unreadable: " + str(e)[:80]]
    # Both accepted is the healthy state now: the token's header decides which
    # key is used. Only a shared-secret-only deployment against a project that
    # publishes key pairs would have been broken, and that can no longer happen.
    out["accepts"] = (["HS256"] if SUPABASE_JWT_SECRET else []) + ["ES256", "RS256"]
    return out


def providers() -> list[str]:
    """The sign-in buttons to draw: what we want, intersected with what works."""
    wanted = [p.strip() for p in os.getenv("KOUNSLY_PROVIDERS", "google,apple,email").split(",") if p.strip()]
    external = auth_settings().get("external") or {}
    if not external:
        return wanted
    return [p for p in wanted if external.get(p)]


def public_config() -> dict[str, Any]:
    """What the browser needs to start a sign-in. The anon key is publishable by
    design — it is the key Supabase's own client library ships to the page."""
    return {
        "enabled": accounts_available(),
        "url": SUPABASE_URL,
        "anon_key": os.getenv("SUPABASE_ANON_KEY") or "",
        "providers": providers(),
        "anon_asks": ANON_ASKS,
        "anon_views": ANON_VIEWS,
        "free_asks": FREE_ASKS_PER_MONTH,
        # Whether a new account has to open a link in an e-mail before it can be
        # used. When it does, the sign-up box has to say so before it takes a
        # password — otherwise the account is created, the sign-in that follows
        # answers "email not confirmed", and nothing on screen explains why.
        "email_confirm": not bool(auth_settings().get("mailer_autoconfirm")),
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
