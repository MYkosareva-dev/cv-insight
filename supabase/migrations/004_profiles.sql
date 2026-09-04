-- Optional display name for the generated resume's name line (SPEC v2.17; Phase-4
-- owner-testing round).
-- Run in the Supabase SQL editor AFTER 001 and 002.
--
-- Why this table exists: the generated resume's NAME line rendered "Data Annotator" --
-- the vacancy's job title -- because the career base contains no person's name
-- anywhere. P4 splits an imported resume into atomic career items and the name heading
-- becomes part of none of them. A grounded generator refusing to invent one is rule B2
-- doing its job; the app having never ASKED for a name is the defect. That line is what
-- a recruiter and an ATS parser read as the candidate's name, so a .docx exported that
-- way reaches an employer with a job title where the name belongs.
--
-- One row per user, `user_id` as the primary key, `display_name` nullable and
-- length-checked. RLS owner-scoped select / insert / update, with `with check` on both
-- writes so an owner cannot rewrite `user_id` to another account, and NO delete policy:
-- clearing a name is an update to null, and the row dies with the account through
-- `on delete cascade`.
--
-- RE-RUNNABLE, and all of it rather than most of it. `create table if not exists` and
-- `drop trigger if exists` were here from the start; the three policies were not,
-- because CREATE POLICY has no IF NOT EXISTS form at any Postgres version, so a second
-- run got past the function, the table and the trigger and then aborted with 42710.
-- Half-idempotent is worse than plainly non-idempotent: these files are pasted into the
-- SQL editor, and an error from a file whose first three statements just succeeded
-- tells the operator nothing about which run created what.

-- Named for the migration that owns it. The first version of this was
-- `public.touch_updated_at()` -- a generic name, created with `create or replace`, in a
-- schema every later migration also writes to, which is one careless `create or replace`
-- away from silently changing what THIS trigger does.
create or replace function public.m004_touch_profiles_updated_at()
returns trigger
language plpgsql
-- No ambient schema resolution: an empty search_path means a later migration cannot
-- change what this body refers to by placing an object in front of it on the path.
-- `now()` still resolves, because pg_catalog is searched implicitly whatever this is
-- set to. NOT `security definer` -- this function needs no privileges of its own, and
-- `check.mjs` fails the build on `security definer` anywhere under supabase/.
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function public.m004_touch_profiles_updated_at();

-- Idempotent as written: enabling RLS on a table that already has it is not an error.
alter table profiles enable row level security;

-- Guarded one policy at a time rather than as a single block, so a file left
-- half-applied by an interrupted paste still converges on a second run.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_own'
  ) then
    create policy "profiles_select_own" on profiles for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_insert_own'
  ) then
    create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_update_own'
  ) then
    create policy "profiles_update_own" on profiles for update
      using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end;
$$;

-- `public.touch_updated_at()` is deliberately NOT dropped here. This file cannot know
-- whether anything else in the live database still executes it -- 001 installs
-- `moddatetime` for the career_items and applications touch triggers, and backlog
-- `p4-27` records that the extension is not available on this project, so how those two
-- triggers are actually wired is the open question that item exists to answer. A
-- `drop function` here would either fail on a dependency (breaking re-runnability) or
-- succeed by cascading a trigger this migration never created. Dropping it is a
-- decision for whoever closes p4-27.
