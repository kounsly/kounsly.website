# Turning accounts on

The code ships switched off. With none of the variables below set, the site is
exactly what it was — search, cards, and a metered assistant for anonymous
visitors — and `/api/health` reports `"accounts": false`. Nothing here needs to
be done in a hurry, and nothing here can break the catalogue.

Everything in this file happens in a browser, in someone else's console. It is
the part I can't do for you.

## 1. Supabase project

Create a project (any region close to the users; Frankfurt for EU traffic).

Then **SQL Editor → New query → paste `schema.sql` → Run.** It creates the five
tables and is safe to re-run.

From **Project Settings**, collect three values:

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Settings → API → Project URL | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | Settings → API → anon/publishable key | Public by design — it ships to the browser |
| `DATABASE_URL` | Settings → Database → Connection string → **Transaction pooler** | Port 6543. Put the real password in |

Use the pooler, not the direct connection: a container that restarts holds
connections open, and the direct port runs out. The app already sets
`prepare_threshold=None` so transaction-mode pooling works.

Never set `SUPABASE_SERVICE_ROLE_KEY` here. The app doesn't use it — it talks to
Postgres directly and verifies tokens with the public key set.

## 2. Google

1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client
   ID → Web application**.
2. Authorised redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
3. Copy the client ID and secret into Supabase → **Authentication → Providers →
   Google**, and enable it.

The consent screen needs an app name, a support e-mail and the privacy-policy
URL. "External" + "Testing" works while there are under 100 users; publishing it
is a form, not a review, as long as only the basic profile scopes are requested.

## 3. Apple

You already have the Developer Program membership, so this is configuration
only.

1. **Certificates, Identifiers & Profiles → Identifiers → App ID**, enable *Sign
   in with Apple*.
2. Create a **Services ID** (this is the `client_id`). Enable *Sign in with
   Apple* on it, then Configure:
   - Domain: `<ref>.supabase.co`
   - Return URL: `https://<ref>.supabase.co/auth/v1/callback`
3. **Keys → new key**, enable *Sign in with Apple*, download the `.p8`. It is
   downloadable exactly once.
4. In Supabase → **Authentication → Providers → Apple**: Services ID, Team ID,
   Key ID, and the `.p8` contents.

Supabase regenerates the signed client secret from the `.p8` itself, so the
six-month expiry that makes hand-rolled Apple sign-in a maintenance chore is not
ours to remember.

Apple lets people hide their address behind a relay (`…@privaterelay.appleid.com`).
That is a real, deliverable address — deadline reminders will reach it — but it
means the same person signing in later with Google looks like a second account.
Nothing to fix now; worth knowing before wondering about duplicate rows.

## 4. E-mail and password

This is the default route in the sign-in box — an address, a password, and one
button that says either *Увійти* or *Створити акаунт*. Supabase has the e-mail
provider on out of the box, so **nothing here has to be switched on**. Three
settings are worth looking at anyway.

**Authentication → Providers → Email**

- *Confirm email* — leave it **on**. Signing up then puts an account in place
  that cannot be used until the link in the e-mail is opened, and the box says
  so instead of pretending to be signed in. Turning it off lets anyone make an
  account on someone else's address.
- *Minimum password length* — set it to **8**. The form already refuses
  anything shorter, and a server that allows 6 makes that a lie the moment
  someone uses a different client.

**Authentication → URL Configuration** has to be right for this, not only for
Google — the confirmation and password-reset e-mails both come back to the site
with the tokens in the fragment, and an address that is not on the redirect list
is refused after the reader has already clicked. See §5.

### The code fallback — the one easy thing to get wrong

Under the password form there is *"Увійти кодом з пошти"*, which sends a
**six-digit code** rather than a magic link. Supabase's default template only
sends a link, and a reader gets an e-mail with nothing to type into the box.

**Authentication → Email Templates → Magic Link**: make sure the body contains
`{{ .Token }}`. Something like:

```
Your Kounsly code: {{ .Token }}
It expires in an hour. If you didn't ask for it, ignore this e-mail.
```

Keeping `{{ .ConfirmationURL }}` as well is fine — then both work.

The **Confirm signup** and **Reset password** templates need no editing: both
ship with `{{ .ConfirmationURL }}`, which is exactly what the password flow
uses.

Supabase's built-in mailer is rate-limited to a handful of messages an hour,
which is enough for testing and not enough for launch. Every password sign-up
sends one, so this is the first thing that will bite on a launch day. Before
real traffic, point **Authentication → Emails → SMTP** at Resend or Postmark
from the domain you already send outreach from.

## 5. URLs

**Authentication → URL Configuration**:
- Site URL: `https://kounsly.com` (whatever the live domain is)
- Redirect URLs: add the same, plus `http://127.0.0.1:8000` for local work

A missing entry here fails at the worst possible moment — after the user has
already approved at Google — and looks like the sign-in silently doing nothing.

## 6. Coolify

Add to the application's environment:

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
```

Optional, all with sensible defaults:

```
KOUNSLY_PROVIDERS=google,apple,email   # drop one to hide its button
KOUNSLY_ANON_ASKS=3                    # free questions before signing in, per device
KOUNSLY_FREE_ASKS=15                   # per month, with an account
KOUNSLY_PRO_ASKS=600                   # ceiling on the paid plan, not a plan limit
KOUNSLY_REMINDERS=off                  # turn on only once something sends them
```

Older Supabase projects sign tokens with a shared secret instead of a key pair.
If yours does, add `SUPABASE_JWT_SECRET=<Settings → API → JWT secret>`; new
projects don't need it and shouldn't set it.

## 7. Checking it worked

```bash
curl -s https://kounsly.com/api/health      # "accounts": true
curl -s https://kounsly.com/api/config      # enabled, url, providers
```

Then in the browser:

1. Press ★ on a card while signed out — the star fills and the sign-in box opens
   saying *"Збережи цю програму"*.
2. Sign in with Google. You come back to the same programme, the star is still
   filled, and the four onboarding questions appear.
3. Answer citizenship = Україна. Open a programme with two deadlines: the non-EU
   one is now marked *твій дедлайн*, and the card, the tile and the list all
   show that same date.
4. Ask four questions signed out in a private window — the fourth opens the wall,
   and after signing in it asks the question you had already typed.

## What is deliberately not here yet

- **Payments.** `plan` is a column with `'free'` in it and a ceiling that reads
  it. Nothing sets it to `'pro'`.
- **The reminder e-mails themselves.** `deadline_watch` records what to send and
  `notified_at` stops it going twice, but nothing sends anything. The button is
  therefore hidden: `KOUNSLY_REMINDERS` is off by default, and the table, the
  endpoints and the wall copy are all ready for the day it is on. Turn it on in
  the same deploy as the sender, not before.
- **Account deletion.** `on delete cascade` is in place, so deleting the
  `auth.users` row removes everything. There is no button for it.
