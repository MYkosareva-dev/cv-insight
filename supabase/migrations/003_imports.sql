-- Import provenance for the career base (SPEC v2.11; Phase 2 owner-feedback round).
-- Run in the Supabase SQL editor AFTER 001 and 002.
--
-- Why this table exists: a career item currently records that it came from an import
-- (`source = 'import'`) but not from WHICH one. After two or three resumes the base is
-- a flat list with no way to tell which document a fact came from, or what role that
-- document was aimed at. That is provenance, and it is not derivable after the fact --
-- nothing in career_items carries it, so it has to be stored at save time.
--
-- One row per import RUN, not per file: the same PDF imported twice is two runs, and
-- the user needs to tell them apart.

create table imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The user's own label for this run, defaulted to "Resume N" by the app and
  -- editable before saving. NOT NULL: an unnamed source is exactly the state this
  -- table exists to remove.
  name text not null check (char_length(name) between 1 and 120),
  -- The role this resume was aimed at, when the user says. Optional by design --
  -- an old CV often had no single target, and forcing one would invite a guess.
  target_role text check (char_length(target_role) <= 120),
  -- 'pdf' or 'paste'. NOT NULL: the app always sets it, so a null could only mean a
  -- row that bypassed the import flow -- and the database is the right place to
  -- forbid that, rather than a convention every future writer has to remember.
  source_kind text not null check (source_kind in ('pdf','paste')),
  created_at timestamptz not null default now()
);
create index imports_user_idx on imports(user_id, created_at desc);

-- RLS: owner-scoped, least-privilege, same shape as every other table (CLAUDE.md,
-- "Data access rules"). SELECT / INSERT / UPDATE only.
--
-- The absent DELETE policy is deliberate and is the interesting part of this
-- migration. Deleting a SOURCE is out of scope: the items it produced outlive it, and
-- a user who could delete an import row would silently strip the provenance from
-- every item that points at it -- turning a fact with a known origin back into a fact
-- with none, which is the defect this table was added to fix. Account deletion still
-- removes everything through the FK cascade to auth.users, so the right to erasure is
-- unaffected (cascades are not blocked by RLS).
alter table imports enable row level security;
create policy "imports_select_own" on imports for select using (auth.uid() = user_id);
create policy "imports_insert_own" on imports for insert with check (auth.uid() = user_id);
create policy "imports_update_own" on imports for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link career items to the run that produced them.
--
-- ON DELETE SET NULL rather than CASCADE: if an import row ever does go, the ITEMS
-- must not go with it. A career item is the user's real experience and the import is
-- only how it arrived; deleting the paperwork must never delete the history. The
-- column is nullable for the same reason it must stay nullable -- a hand-created item
-- has no import, and every item that predates this migration has none either.
alter table career_items add column import_id uuid references imports(id) on delete set null;

-- Reads are always "this user's items, optionally filtered by source", so the index
-- leads with user_id. It also covers the plain user_id lookups the previous index
-- served, but that one is left in place: dropping it is a separate decision from
-- adding provenance.
create index career_items_import_idx on career_items(user_id, import_id);
