-- Contact details on the profile, for the resume's header block (SPEC v2.20;
-- Phase-5 owner-feedback round).
-- Run in the Supabase SQL editor AFTER 001, 002, 003 and 004. It ALTERs the table
-- 004 creates, so it cannot run before it.
--
-- Why these columns exist: an exported .docx carried no email, no phone and no
-- links, which makes it unusable as an actual resume. A recruiter who cannot reply
-- to a document does not reply to it, so this is a hole in the product's main
-- artefact rather than a nicety. The career base cannot supply them either: P4
-- splits an imported resume into atomic career items and the contact header becomes
-- part of none of them, the same reason the display name needed asking for in 004.
--
-- NO NEW TABLE AND NO NEW POLICIES. `profiles` is already one row per user with
-- owner-scoped select / insert / update, no delete policy, and `on delete cascade`
-- from `auth.users` — so these columns inherit the whole access story and the whole
-- erasure story. A second table would have needed its own copy of both.
--
-- EVERY FIELD IS OPTIONAL and the app is built for all of them being empty: the
-- header block collapses field by field and leaves no blank lines behind. A resume
-- tool that made a phone number mandatory would be collecting personal data it does
-- not need in order to work.
--
-- THE TWO URL COLUMNS CARRY AN `https://` CHECK as well as a length bound, which is
-- one constraint more than "nullable and length-checked" asked for. The Zod boundary
-- is where a bad scheme is REJECTED with copy the user can act on, and that is the
-- fence that matters; this is the backstop for the one thing that must never be
-- possible — a `javascript:` or `data:` value sitting in a column whose values a
-- later reader might be tempted to put in an href. The app renders them as text
-- nodes and never builds an anchor from an unvalidated scheme, so the constraint is
-- defence in depth, and it is here because the column outlives any given render
-- site.
--
-- RE-RUNNABLE. `add column if not exists` skips the entire clause — inline CHECK
-- included — when the column is already there, so no constraint name can collide on
-- a second run. That is why the checks are inline rather than separate
-- `add constraint` statements, which have no IF NOT EXISTS form.
--
-- NO FUNCTION IS NEEDED. 004 already installs
-- `public.m004_touch_profiles_updated_at()` and the `profiles_touch` trigger, which
-- fires on every UPDATE of this table whatever the column set is — so `updated_at`
-- keeps moving for a contact edit with nothing added here. A second touch function
-- would be a second thing to keep in step for no behaviour.

-- A contact email is NOT the account email: a user may apply from an address other
-- than the one they signed in with, and the account address is not something to
-- print on a document without being asked. 254 is the practical maximum length of an
-- address; the lower bound of 3 refuses a value too short to be one at all.
alter table profiles add column if not exists contact_email text
  check (contact_email is null or char_length(contact_email) between 3 and 254);

-- Free text on purpose, and NOT normalised. Phone numbers are written differently in
-- every country the app is used from, and a column that reformatted one would print
-- something the user did not write on their own resume.
alter table profiles add column if not exists phone text
  check (phone is null or char_length(phone) between 3 and 40);

alter table profiles add column if not exists linkedin_url text
  check (
    linkedin_url is null
    or (char_length(linkedin_url) between 12 and 200 and linkedin_url like 'https://%')
  );

alter table profiles add column if not exists github_url text
  check (
    github_url is null
    or (char_length(github_url) between 12 and 200 and github_url like 'https://%')
  );

-- "Hamburg, Germany" — a line on a resume, not a structured address. The app never
-- geocodes it and never needs to.
alter table profiles add column if not exists location text
  check (location is null or char_length(location) between 1 and 120);

-- NULLABLE, and the three states are meant: true prints "Open to remote", false
-- prints nothing, and null means the user has not said. A `not null default false`
-- would have made "has not said" indistinguishable from "no", which is the app
-- answering a question on the user's behalf on a document they send to an employer.
alter table profiles add column if not exists open_to_remote boolean;
