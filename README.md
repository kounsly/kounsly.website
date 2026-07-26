# Kounsly — website

Search over English-taught degrees abroad, in plain language. Ask
*"дешевий магістр з машинного навчання в Німеччині"* and get real programmes
back — tuition, deadlines, English requirements — every fact carrying the
official page it came from and the date it was checked. No agent, no
commission, no pay-to-rank.

Live at **kounsly.com**. 5 704 programmes across five countries:

| | | source |
|---|---:|---|
| 🇩🇪 Germany | 2 250 | DAAD |
| 🇳🇱 Netherlands | 1 737 | Nuffic / Study in NL |
| 🇸🇪 Sweden | 940 | universityadmissions.se (UHR) |
| 🇱🇹 Lithuania | 578 | Study in Lithuania |
| 🇫🇮 Finland | 199 | Opintopolku |

This repository is the site. The catalogue behind it is built next door in
`kounsly-pipeline`, which collects, normalises, enriches, translates and embeds
the data, then uploads the finished file to the server.

## Two constraints everything else follows from

**The catalogue is a read-only SQLite file, mounted from the host.** Search
costs nothing to serve, and nothing at runtime writes to it.

It used to live inside the image, which made a data refresh an ordinary git
push and let a code rollback roll the data back with it. Five countries ended
that: 78 MB is past what GitHub takes without complaint, and every deploy left
another copy of it on a 20 GB disk. Code and data now ship separately — `git
push` for one, `build_db.py --publish-remote` for the other.

**There is no build step.** One `index.html`, one JavaScript file, one
stylesheet, no framework, no bundler, no npm. Not minimalism for its own sake:
a change is visible the moment it is saved, and there is no toolchain to break
between writing a fix and shipping it.

## Layout

```
app.py            FastAPI: search, facets, one programme, the assistant
index.html        The whole page. Design tokens and the card styles live here
static/app.js     Search, results, the detail sheet, the assistant
static/app.css    Components layered on index.html's tokens
kounsly.db        The catalogue — gitignored; the pipeline writes it here
```

Locally `kounsly.db` sits next to `app.py` and `uvicorn app:app` finds it. In
production it is a read-only bind mount of `/data/kounsly` on the host, found
through `KOUNSLY_DB`. A container that starts without that mount says so and
fails its health check rather than serving an empty catalogue.

The copies committed before the move are still in git history, so a fresh clone
is about 175 MB. Rewriting that away costs every commit hash, which is not
worth it while the repository has one author.

## Run locally

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app:app --reload --port 8000
```

Open http://127.0.0.1:8000. You need a `kounsly.db` — build one in the pipeline
with `python build_db.py --publish-only`, which copies it here.

Search and the detail view work with no credentials. The assistant needs Vertex
access (`gcloud auth application-default login`) and degrades to plain text
search without it rather than failing.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `KOUNSLY_DB` | `./kounsly.db` | Path to the catalogue. `/data/kounsly.db` in production |
| `GCP_PROJECT` / `GCP_LOCATION` | `kounsly` / `global` | Vertex project |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | — | Service-account key, raw or base64. How the server authenticates; there is no ADC in the container |
| `GEMINI_API_KEY` | — | AI Studio fallback. The $300 credits do **not** apply to it |
| `KOUNSLY_CHAT_MODEL` | `gemini-3.6-flash` | The assistant |
| `KOUNSLY_PARSE_MODEL` | `gemini-3.5-flash-lite` | Phrase → filters |
| `KOUNSLY_EMBED_MODEL` | `gemini-embedding-2` | 768 dimensions, must match the pipeline |
| `KOUNSLY_ASK_LIMIT` | `20` | Questions per hour per IP — abuse control, not a plan |

## API

| | |
|---|---|
| `GET /api/search` | The main one. `q`, filters, `sort`, `page`, `ai=false` to skip interpretation |
| `GET /api/facets` | Counts for the filter dropdowns |
| `GET /api/program/{uid}` | Every stored field for one programme |
| `POST /api/ask` | The grounded assistant |
| `GET /api/health` | Row count, and whether the assistant is configured |

## How search actually works

A typed phrase gets two small AI touches, both cached per string:

1. **Phrase → filters.** *"cheap master's in ML in Germany"* becomes
   `level=master`, `country=DE`, a tuition ceiling, plus the part that is really
   about subject matter. Filters the user set by hand always win — the dropdowns
   are an instruction, the sentence is a guess. What the model made of the
   phrase is shown as chips, with a *"search literally"* escape hatch.
2. **Subject → meaning.** That subject phrase is embedded and compared against
   the catalogue's vectors, so a programme matches on meaning rather than on
   sharing words. Falls back to FTS5 text search when there are no vectors or no
   credentials.

The assistant is not a chatbot. It answers about **one** programme from **only**
that programme's stored fields, and when a fact is not in the data it says so
and points at the official page. An admissions answer that sounds right and is
wrong costs someone a year.

## Deploy

Push to `main`. Coolify auto-deploys from
`github.com/kounsly/kounsly.website` using the `Dockerfile`, onto
`173.242.50.199`.

The container listens on **port 80 on purpose** — Coolify already expected the
app there when this replaced the old nginx static site, so nothing on the server
needed reconfiguring.

Two settings on the Coolify application make the catalogue reachable, and a
rebuilt server needs both:

- a bind mount, host `/data/kounsly` → container `/data`, read-only
- `KOUNSLY_DB=/data/kounsly.db`

A deploy no longer carries data. Pushing code and running `--publish-remote`
are separate acts, and rolling back one does not roll back the other.

## Refreshing the catalogue

In `kounsly-pipeline`, and the order matters:

```bash
python build_db.py && python embed.py && python translate.py
python translate.py --repair
python build_db.py --publish-remote     # this is what puts it live
```

`--publish-remote` rsyncs the file to the server and moves it into place, which
is atomic within a filesystem — readers get yesterday's whole catalogue or
today's, never half of one. SQLite opens the file per request, so no restart is
needed. `--publish-only` still copies it into this directory for local work.

**Never plain `--publish`.** It rebuilds the database from JSONL first, which
drops the vectors and the Ukrainian columns you just paid to generate. The
`--repair` line is not optional either: the rebuild drops the Ukrainian columns
and `translate.py` restores them from cache *without* the repairs.

## Things worth knowing before changing something

- **The health check must not resolve credentials.** `google.auth.default()`
  off GCP blocks on the metadata server at 169.254.169.254 until it times out.
  That hung `/api/health`, failed the container check, and made Coolify report a
  perfectly healthy deploy as failed. `assistant_available()` decides from
  environment variables only.
- **The page and its scripts are served `no-store`.** A deploy once shipped new
  markup against last week's JavaScript, which looks like a broken feature
  rather than a stale file, and cost hours. Switch to hashed filenames when
  there is traffic worth optimising for.
- **Thinking is billed as output on Gemini 3.x** and silently eats
  `max_output_tokens` — a 700-token cap once left 23 tokens for the answer.
  `thinking_budget=0` everywhere; these tasks are "read the given fields".
- **Ukrainian is pre-translated into the database**, not translated per view, so
  the language toggle costs nothing at request time. A missing `*_uk` column
  falls back to the source language rather than showing a half-translated page.
- **One Gemini client per thread, held for the process lifetime.** Sharing one
  across threads closes it mid-run; letting one be garbage-collected closes
  transport later calls still need. Either way every subsequent request fails
  with *"the client has been closed"*.
- **`db()` opens read-only** (`mode=ro`) on every request. SQLite handles this
  fine at our scale, and it makes "the catalogue is immutable" a property of the
  connection rather than a convention.

## Not built yet

Accounts, saved lists and deadline reminders are written and waiting on the
`accounts` branch — sign-in through Supabase with Google, Apple and e-mail
codes, plus the profile that decides which stated deadline is the reader's. It
is unmerged because it needs a Supabase project configured first; see
`SETUP-AUTH.md` on that branch.

Also missing: payments, the reminder sender, and SEO pages for individual
programmes. The site is one URL with no router, so nothing is bookmarkable or
shareable yet — that is the same change as SEO pages, and probably the
highest-value one left.
