-- Kounsly — the account grows up. Run once against the Supabase project's
-- Postgres, *before* deploying the code that goes with it: update_profile()
-- writes these columns by name and will fail on a database that lacks them.
--
-- Everything here is additive and nullable. An account that never fills any of
-- it behaves exactly as it did before: the four onboarding answers still work,
-- and nothing in the catalogue depends on a profile being complete.
--
-- Rule for every column below: it exists because something in the product
-- reads it. A field that only sits in a form is a field that lies about being
-- useful, so "other languages I speak" and "countries I like" are deliberately
-- absent — nothing can act on them yet.

-- ---------- the profile, past the four onboarding questions ----------

alter table app_user
  -- The last diploma, in the reader's own words. `field` reaches the
  -- assistant's prompt, so it is trimmed and length-capped in the API rather
  -- than being an open text box that ends up in a model call.
  add column if not exists field       text,          -- "Комп'ютерні науки"
  add column if not exists institution text,          -- "ЛНУ ім. Франка"
  add column if not exists grad_year   integer,       -- year that diploma was awarded

  -- The average mark, kept *with the scale it was given on*. Storing a bare
  -- number would be the same bug as storing a deadline without saying whose
  -- it is: 4.0 is excellent on one scale and a fail on another. Conversion is
  -- shown to the reader as an approximation and never written back as fact.
  add column if not exists gpa         numeric(5,2),
  add column if not exists gpa_scale   text,          -- 100 | 12 | 5 | 4

  -- Self-assessed English, for people who have never taken a test. It softens
  -- the search; it never produces a "you qualify", because a self-assessment
  -- is not a score a university accepts.
  add column if not exists english_self text,         -- A2 | B1 | B2 | C1 | C2

  -- What they are actually applying for. These three become the default state
  -- of the filters that already exist — no new search behaviour, just a
  -- starting position that isn't "everything".
  add column if not exists intake      text,          -- 2026-fall | 2027-spring | 2027-fall | undecided
  add column if not exists want_level  text,          -- bachelor | master | any
  add column if not exists budget_max  integer;       -- euros per year; 0 means "free only"

-- ---------- saved programmes become a working list ----------

alter table saved_program
  -- The single most valuable thing in this migration. Someone compares five
  -- programmes for weeks and holds "this one needs a motivation letter, this
  -- one closes earlier" in their head. uid is deliberately not a foreign key
  -- into the catalogue, and this note inherits that: a programme vanishing
  -- from a source must never delete what a person wrote about it.
  add column if not exists note  text,
  -- applying | thinking | dropped. Nullable rather than defaulted to
  -- 'thinking': a star is not yet a decision, and pretending otherwise would
  -- fill everyone's list with a status they never chose.
  add column if not exists state text;

alter table saved_program drop constraint if exists saved_program_state_check;
alter table saved_program add constraint saved_program_state_check
  check (state is null or state in ('applying', 'thinking', 'dropped'));
