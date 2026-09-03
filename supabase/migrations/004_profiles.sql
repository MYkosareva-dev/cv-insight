-- The user's display name (SPEC v2.17; Phase 4 owner-feedback round).
-- Run in the Supabase SQL editor AFTER 001, 002 and 003.
--
-- Why this table exists now, having been declined in Block C. That decision said
-- "no `profiles` table -- `auth.users` covers MVP needs; nothing user-facing to store
-- beyond owned rows", and it held until the app produced a document with a NAME line
-- on it. Owner testing found that line reading "Data Annotator" -- the vacancy's job
-- title -- because the generator had nothing else to put there: P4 splits an imported
-- resume into career items and the name heading becomes part of none of them, so the
-- career base contains no person's name anywhere. A grounded generator refusing to
-- invent one is correct behaviour; the app asking for one is the fix. A .docx exported
-- without it reaches an employer with a job title where the candidate's name belongs,
-- and no amount of prompt work can produce a fact the app has never been told.
--
-- One row per user, keyed BY the user. `user_id` is the primary key rather than a
-- separate `id` with a unique constraint: there is exactly one profile per account and
-- the database should be the thing that says so, not a convention every future writer
-- has to remember.

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- NULLABLE by design, and the app must work without it. A name is personal data:
  -- requiring one to use a resume tool would collect it from users who did not want
  -- to give it, and the alternative -- a visible placeholder the user replaces in the
  -- editor -- costs them one edit and asks nothing. The app therefore treats an unset
  -- name as a normal state, never as an error.
  --
  -- 120 characters matches `imports.name` and is generous for a real name in any
  -- script. The lower bound is 1, not 0: an empty string would be a name that is
  -- present and blank, which is a third state nothing needs -- the app writes NULL.
  display_name text check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on profiles
  for each row execute procedure moddatetime(updated_at);

-- RLS: owner-scoped, least-privilege, the same shape as every other table
-- (CLAUDE.md, "Data access rules"). SELECT / INSERT / UPDATE.
--
-- WITH CHECK on BOTH write policies, and the UPDATE policy carries USING as well.
-- USING decides which rows may be targeted; WITH CHECK decides what they may be
-- changed INTO. An UPDATE policy with only USING would let a caller who legitimately
-- owns their row rewrite `user_id` to someone else's -- handing that person a display
-- name they never chose, on a row they cannot see coming. The pair is what makes the
-- ownership hold before and after the write.
--
-- NO DELETE POLICY, and the absence is deliberate rather than an omission. Clearing a
-- display name is an UPDATE to null, which the app already does when the field is
-- emptied; there is no product action that removes the ROW. Erasure is account
-- deletion, and this row dies with the account through the `on delete cascade` above
-- -- cascades run as the table owner with RLS bypassed, so a missing DELETE policy
-- does not block them (the same reasoning 001 records for its own absent policies).
alter table profiles enable row level security;
create policy "profiles_select_own" on profiles for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on profiles for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
