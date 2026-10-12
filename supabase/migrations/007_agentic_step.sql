-- The agentic generation step joins the llm_calls step vocabulary (SPEC v3.0, Block C).
-- Run in the Supabase SQL editor AFTER 001-006, and BEFORE deploying the code that
-- writes step = 'generate_agentic'.
--
-- WHY THIS EXISTS. 001 declares llm_calls.step with an inline CHECK listing six values.
-- Every request of the agentic loop writes a row with step = 'generate_agentic', and the
-- row is written fire-and-forget (rule B8: a log failure never fails the request) — so
-- without this migration Postgres refuses every agentic row and the loss is silent:
-- /quality would show no agentic spend and rule B7's daily count would not see it.
--
-- THE CONSTRAINT IS DROPPED BY ITS EXPLICIT NAME, WITHOUT `if exists`. Postgres names an
-- inline column CHECK `<table>_<column>_check`. With `if exists`, a wrong name would turn
-- the drop into a silent no-op and the old CHECK would keep refusing the new value — the
-- exact failure this file fixes, moved somewhere else. A loud error is the better outcome.
--
-- No RLS or policy change: llm_calls stays S/I, append-only.
--
-- Verify after running:
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'llm_calls'::regclass and contype = 'c';
-- Expected: llm_calls_step_check listing seven values, 'generate_agentic' among them.

begin;

alter table llm_calls drop constraint llm_calls_step_check;

alter table llm_calls add constraint llm_calls_step_check
  check (step in ('import_resume','parse_vacancy','generate','judge','embed','rescore','generate_agentic'));

commit;
