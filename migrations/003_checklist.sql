-- Kounsly — the application checklist. Run before deploying the code with it.
--
-- What someone still has to do for a programme they are applying to. Ours to
-- store, theirs to write: the list is seeded from facts the catalogue already
-- holds (the portal it names, the date it states, the certificate it asks for)
-- and every line can be edited or deleted, because the university's page is
-- what is true and our reading of it is not.
--
-- jsonb rather than a table of rows: it is a short list that is always read and
-- written whole, it belongs to exactly one saved_program, and it has to survive
-- the programme leaving the catalogue — the same rule the note already follows.

alter table saved_program
  add column if not exists checklist jsonb;
