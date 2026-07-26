-- Kounsly user data. Run once against the Supabase project's Postgres.
--
-- The catalogue stays where it is: a read-only SQLite file mounted from the
-- host. This is the *other* half — the writable one — and it holds only what
-- belongs to a person: who they are, what they saved, what they searched for.
-- Keeping the two apart means a data rebuild can never touch a user row.
--
-- Identity lives in Supabase's own auth.users. We never store passwords, tokens
-- or OAuth secrets; app_user.id is a foreign key to it and nothing more.

create table if not exists app_user (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text,
  created_at    timestamptz not null default now(),
  seen_at       timestamptz not null default now(),

  -- The profile. These are exactly the fields the assistant already knows how
  -- to read (see Profile in app.py) — the reason accounts exist at all is to
  -- have somewhere honest to keep them.
  citizenship   text,          -- UA | EU | OTHER
  status        text,          -- none | protection
  education     text,          -- school | bachelor | master
  ielts         numeric(2,1),
  toefl         integer,
  onboarded     boolean not null default false,

  -- The rest of the profile, added in migrations/002_account.sql. Each of these
  -- is read by something: the last diploma and the mark feed the assistant and
  -- the "do I qualify" arithmetic, the last three are the opening position of
  -- the filters. See that file for why "languages I speak" is not here.
  field         text,          -- speciality of the last diploma
  institution   text,
  grad_year     integer,
  gpa           numeric(5,2),
  gpa_scale     text,          -- 100 | 12 | 5 | 4 — a mark is meaningless without it
  english_self  text,          -- A2 | B1 | B2 | C1 | C2, self-assessed
  intake        text,          -- 2026-fall | 2027-spring | 2027-fall | undecided
  want_level    text,          -- bachelor | master | any
  budget_max    integer,       -- euros per year; 0 means "free only"

  lang          text not null default 'uk',
  plan          text not null default 'free'    -- free | pro
);

-- Saved programmes. uid is a key into the SQLite catalogue, deliberately not a
-- foreign key: the catalogue is rebuilt from scratch on every data refresh, and
-- a programme disappearing from a source must not delete a person's list. The
-- API resolves uids at read time and simply omits ones it can no longer find.
-- `note` and `state` are what turn this from a filter into a working list: what
-- the reader worked out about a programme, and whether they are actually going
-- for it. The note inherits uid's rule — it outlives the programme's row in the
-- catalogue, because it is the reader's writing, not ours.
create table if not exists saved_program (
  user_id    uuid not null references app_user(id) on delete cascade,
  uid        text not null,
  created_at timestamptz not null default now(),
  note       text,
  state      text check (state is null or state in ('applying', 'thinking', 'dropped')),
  primary key (user_id, uid)
);

-- Deadline tracker. notified_at is what stops a reminder going out twice; the
-- sender is not built yet, the column is here so it doesn't need a migration.
create table if not exists deadline_watch (
  user_id     uuid not null references app_user(id) on delete cascade,
  uid         text not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  primary key (user_id, uid)
);

-- Search history. One row per distinct phrase rather than one per search: the
-- point of keeping it is "let me get back to what I was looking for", and the
-- same query typed nine times is one thing to get back to, not nine. `params`
-- is the rest of the search — country, level, budget — so reopening one
-- restores the search rather than only the words.
--
-- Only for signed-in people, and only the phrase they typed. There is no
-- anonymous search log here, and no record of what was shown back.
create table if not exists search_event (
  user_id    uuid not null references app_user(id) on delete cascade,
  q          text not null,
  params     text,
  created_at timestamptz not null default now(),
  primary key (user_id, q)
);

create index if not exists search_event_user on search_event (user_id, created_at desc);

-- One row per answered question. This is the quota meter and the only usage
-- record we keep; the question text is not stored.
create table if not exists ask_event (
  id         bigserial primary key,
  user_id    uuid references app_user(id) on delete cascade,
  anon_id    text,
  uid        text,
  created_at timestamptz not null default now(),
  check (user_id is not null or anon_id is not null)
);

create index if not exists ask_event_user_month on ask_event (user_id, created_at desc);
create index if not exists ask_event_anon on ask_event (anon_id, created_at desc);
create index if not exists saved_program_user on saved_program (user_id, created_at desc);
create index if not exists deadline_watch_user on deadline_watch (user_id, created_at desc);

-- The API connects as the owner and bypasses RLS, so these policies are not
-- what protects the data. They are here so that if PostgREST is ever exposed
-- with the anon key, it finds nothing: default-deny, no policies granted.
alter table app_user       enable row level security;
alter table saved_program  enable row level security;
alter table deadline_watch enable row level security;
alter table ask_event      enable row level security;
alter table search_event   enable row level security;
