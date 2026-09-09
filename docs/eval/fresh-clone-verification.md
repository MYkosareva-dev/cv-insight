# The repository against a brand-new project — fresh-clone run evidence

**Status: VERIFIED.** This repository, cloned into an empty folder and set up by
following `README.md` literally, runs against a brand-new Supabase project:
migrations `001`–`005` all apply in order, RLS comes back enabled on all eight
tables with the policy counts the least-privilege matrix predicts, and the whole
pipeline runs end to end. The results are recorded verbatim under "Run results"
below.

Run on 2026-09-09 by the owner, from a fresh clone of `main` at commit `8156463`,
against a Supabase project created for this run and nothing else.

It answers the one question the repository could not answer about itself. Every
earlier run in this directory was made against the project this app was built on,
which has carried hand-applied statements and a rewritten migration since Phase 4;
"it works here" says nothing about a reader who starts from empty. This run starts
from empty.

## What this file is for

Backlog `p4-27` claimed the committed migrations might not apply to a fresh
project: `001_init.sql` installs and uses `moddatetime`, `004_profiles.sql` had
been rewritten to carry its own touch function instead, and the conclusion drawn
was that the extension was unavailable and the other files had inherited a bad
assumption. That conclusion reached three more places — a "Known caveat before you
run them" paragraph in README warning a reader against this repository's own
schema, an *Honest limitations* entry stating the migrations were unverified from
empty, and entry #6 of the backlog's own *Read these first*.

**The migrations were fine and the caveat was not.** `001` installs `moddatetime`
and both of its touch triggers resolve it; what failed on the original project was
schema resolution, not an absent extension. A doubt recorded as a fact outlives
every check that would have settled it, and the only thing that settles one is
running it.

The run was also the first time anyone followed README as written rather than from
memory, and that found three gaps of its own. They are in "What the run found"
below, and all three are fixed in the same branch as this file.

## How to re-verify it

```
git clone <repo> fresh && cd fresh && npm install
```

Create a new Supabase project, put its URL and anon key plus the two server-only
keys in `.env.local`, then, in the SQL editor and in this order:

```
supabase/migrations/001_init.sql
supabase/migrations/002_audit_retention.sql
supabase/migrations/003_imports.sql
supabase/migrations/004_profiles.sql
supabase/migrations/005_profile_contacts.sql
```

Decline the SQL editor's offer to enable RLS for you — the point is what the
migrations do, not what the dashboard does on their behalf. Then read RLS back:

```sql
select relname, relrowsecurity,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by relname;
```

Every row must read `true`, and the count must equal the row's own line in the
least-privilege matrix in SPEC Block C — not merely be nonzero. A count that is
too HIGH is as much a defect as one that is too low: absent policies in that
matrix are deliberate, so an extra policy is a permission nobody decided to grant.

Turn `Confirm email` off in the dashboard before signing up (Authentication →
Providers, *User Signups*), run `npx playwright install` once, then work the
first-run sequence in README: Settings → Career base → New scan → Generate.

## Run results

Verbatim, as reported by the owner.

```
### 1. MIGRATIONS
Migrations 001-005 applied in order to a fresh project, all successful
(002 returned schedule = 1, the pg_cron job).

### 2. RLS, READ BACK AFTERWARDS
RLS verified afterwards, on eight tables, all true, policy counts:
  applications 3 · career_items 4 · documents 3 · imports 3
  llm_calls 2 · profiles 3 · resume_versions 2 · vacancies 3
The SQL editor offered to enable RLS itself; the owner declined, so RLS came only
from the migrations.

### 3. THE PRODUCT
Full flow worked: sign-up, profile, import, scan, generate, judge, .docx, /quality.
The draft failed grounding and the single revision passed it.

### 4. THE SUITES
npm run build: check 13 rules, 382/382 unit tests, compiled, 20 pages.
npm run test:e2e: 33 passed, 1 skipped, 0 failed.
```

### The policy counts against the matrix, table by table

The counts are not merely nonzero — each one equals the matrix exactly, and that
matrix is the least-privilege claim CLAUDE.md and SPEC Block C both state:

| table | matrix | expected | counted |
|---|---|---|---|
| `career_items` | S/I/U/D | 4 | **4** |
| `documents` | S/I/D (no UPDATE — re-embed is delete-then-insert) | 3 | **3** |
| `vacancies` | S/I/U | 3 | **3** |
| `applications` | S/I/U | 3 | **3** |
| `resume_versions` | S/I (append-only) | 2 | **2** |
| `llm_calls` | S/I (append-only audit log) | 2 | **2** |
| `imports` | S/I/U (no DELETE — provenance) | 3 | **3** |
| `profiles` | S/I/U (no DELETE — dies with the account) | 3 | **3** |

Twenty-three policies on eight tables, all owner-scoped, none of them the
dashboard's doing.

## What this proves, and what it does not

**Proves.** The committed schema is a schema anyone can install. `001`–`005` apply
in order to an empty project with no hand-editing and no dashboard help, and the
access-control story they claim is the one the database ends up with: RLS on every
one of the eight tables, with exactly the policies the matrix names and no others.
`001`'s `create extension if not exists moddatetime;` is correct, so `p4-27` is
closed — what it recorded as a property of the migrations was a property of one
project's schema resolution.

**Proves, separately.** The product works when it is set up by its own README: an
account, a profile, a resume import, a scan, a grounded generation, a rubric
judgement, a `.docx` and the `/quality` dashboard — on a database whose rows are
all minutes old, so nothing on screen depended on data an earlier phase had left
lying around. `npm run build` and the Playwright suite are both green on that
project, and the suite could create its accounts because the run had turned
`Confirm email` off.

**Does not prove: that the pg_cron purge RUNS.** `002` returned `schedule = 1`,
which is the job id — the job exists on the schedule. A scheduled job is not a
succeeded run, and this project's own rule is that a configured mechanism is not
evidence of a working one. So the 90-day audit-retention claim stays behind its
evidence gate on this project too: `AUDIT_RETENTION_VERIFIED` is false until a
`succeeded` row from `cron.job_run_details` is pasted into the audit-retention
evidence file in this directory, and `/privacy` keeps its weaker sentence until
then. (That file's path is deliberately not written out here: `scripts/check.mjs`
R12's own test suite builds a sandbox with it deleted, and a backticked reference
to it from a docs file would fail R13 inside that sandbox.)

**Does not prove: that grounding behaviour has changed.** The draft failed
grounding and the revision passed it, which makes a **fifth** measured run whose
first draft was refused — see `p5-16`, and `p7-1` for what that number is a number
about. This run is an observation and not part of that measurement: the violation
text was not captured, so it cannot be classified the way `p7-1` classified the
runs whose text survives, and "the revision passed" is the second convergence this
project has seen rather than a rate. **Owner ruling, 2026-09-09: it stays a
recorded observation and does not move the 4-of-4 figure** — a run whose
violations cannot be classified cannot be counted alongside runs that were, which
is the whole lesson of `p7-1`.

**Does not prove: anything about the deployment.** This is a local run against a
new database. The deployed project still has registration closed, which is the
only thing keeping strangers out of it, and none of the dashboard settings in
`docs/deploy.md` is witnessed here.

## What the run found

Four defects, all in documentation, all fixed in the branch that carries this
file. They are recorded here because a verification that produces findings is
worth more than one that produces a green tick, and because three of them were
invisible to anyone who already had the app working.

1. **The `p4-27` caveat was disproven** — README's "Known caveat before you run
   them" and the matching *Honest limitations* entry, both replaced by one
   sentence citing this file. SPEC Block C also gained `004_profiles.sql`, which
   was the other half of that item: the eighth table's shape had existed only in
   its own migration file, so a reader following the spec's set-up script built
   seven tables and no `profiles`.
2. **README never said `Confirm email` must be off.** A new Supabase project ships
   with it on, and this app sends no mail of its own — so a sign-up creates an
   account with no session, a sign-in answers "Confirm your email before signing
   in.", and nothing behind the login is reachable. That is the app being
   unusable rather than rough, and the fix is one dashboard toggle nobody had
   written down.
3. **README had no first-run walkthrough.** It explained the pipeline in depth and
   never said what to do first: Settings before generating (the name line comes
   from there), a career base before a scan (the coverage decision is made against
   it), a scan before a generation.
4. **README listed `npm run test:e2e` without `npx playwright install`.** The
   browsers are not in `node_modules`, so on a fresh clone the suite fails before
   its first assertion.
