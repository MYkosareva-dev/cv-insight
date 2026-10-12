-- Billing ledger and per-version provenance (SPEC v3.0, Block C).
-- Run in the Supabase SQL editor AFTER 001-005. It ALTERs resume_versions, which
-- 001 creates.
--
-- The billing ledger. One row per Stripe event this app accepted; the plan is derived
-- from the latest row and stored nowhere else. Owner SELECT only: no user role may
-- insert, update or delete, so the only writer is the webhook through the service role.
create table if not exists subscription_events (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  stripe_event_id        text not null unique,            -- idempotency: a replay cannot insert
  stripe_event_type      text not null,
  stripe_customer_id     text not null,
  stripe_subscription_id text,
  status                 text not null,                   -- Stripe's own status string, verbatim
  cancel_at_period_end   boolean not null default false,
  current_period_end     timestamptz,
  received_at            timestamptz not null default now()
);
create index if not exists subscription_events_user_recent
  on subscription_events (user_id, received_at desc);
alter table subscription_events enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscription_events' and policyname = 'subscription_events_owner_select') then
    create policy subscription_events_owner_select on subscription_events
      for select using (auth.uid() = user_id);
  end if;
end $$;

-- Append-only BELOW RLS. RLS already denies every user-role write; this is for the roles
-- RLS does not bind (service role, the SQL editor). UPDATE is refused outright. DELETE is
-- refused unless it arrives through the ON DELETE CASCADE from auth.users: a direct
-- DELETE runs this trigger at pg_trigger_depth() = 1, the cascade reaches it through the
-- referential-integrity trigger at depth 2. Not security definer (R3).
create or replace function subscription_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'subscription_events is append-only';
  end if;
  if pg_trigger_depth() < 2 then
    raise exception 'subscription_events rows are removed only with the account';
  end if;
  return old;
end $$;
drop trigger if exists subscription_events_append_only on subscription_events;
create trigger subscription_events_append_only
  before update or delete on subscription_events
  for each row execute function subscription_events_append_only();

-- TRUNCATE fires no row trigger and is not filtered by RLS, so the append-only guarantee
-- above would not hold against it. No REST or RPC path issues TRUNCATE today; this keeps
-- the two API roles from ever holding the privilege.
revoke truncate on subscription_events from anon, authenticated;

-- Per-version provenance. Both nullable, both set on insert; the table stays append-only.
alter table resume_versions add column if not exists model text
  check (model is null or char_length(model) between 3 and 120);
-- retrieval_log is bounded because resume_versions keeps its owner INSERT policy: any
-- signed-in user can write their own row through the REST endpoint, so an unbounded jsonb
-- is unbounded storage. 64 KB is far above the largest log the agentic loop can write
-- (at most 6 searches of query, counts and item titles).
alter table resume_versions add column if not exists retrieval_log jsonb
  check (retrieval_log is null or octet_length(retrieval_log::text) <= 65536);
