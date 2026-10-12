# CV Insight — CLAUDE.md

## What this app is
CV Insight is an AI resume-tailoring assistant. A signed-in user maintains a
career base (every role, project, achievement — atomic "career items"). For each
job posting the app: parses the vacancy into structured requirements, computes an
ATS-style semantic match score against the career base (pgvector), shows keyword
gaps and hidden matches from the base, generates a tailored resume grounded ONLY
in the user's real experience, and evaluates every generated resume with a
rubric-based LLM judge before showing it, or says plainly that the check did
not run.

Two plans. Free covers the single-shot pipeline with small daily limits; Pro
raises the limits and switches generation to agentic retrieval, where the
writer searches the career base step by step through one tool. The plan is
derived from the `subscription_events` ledger and enforced inside the two
gates. Billing is Stripe in test mode on hosted pages; this app never sees a
card and loads no Stripe script.

## Why the app is pointless without AI
Remove the LLM and embeddings and all that remains is a notepad of resume text.
Vacancy parsing, semantic scoring, grounded generation and rubric evaluation ARE
the product. Every core user action triggers the AI pipeline.

`SPEC.md` is the single source of truth for build details. This file is the rule
book that constrains HOW the agent builds. On conflict: CLAUDE.md rules win, then
SPEC.md, then anything else.

## AI model calls
- All model calls must happen server-side only. Never call the OpenRouter API
  from browser code.
- OPENROUTER_API_KEY lives in .env.local and must never be exposed to the
  browser (no NEXT_PUBLIC_ prefix, no passing it to client components).
- Models:
  - Generation (tailored resume): openai/gpt-5.4
  - Vacancy parsing & rubric judge: anthropic/claude-haiku-4.5 (deliberately a
    different model than the generator, to reduce self-preference bias)
  - Fallback for every chat step: google/gemini-2.5-flash via OpenRouter `models`
    array routing
  - Embeddings: openai/text-embedding-3-small; a model named here must be one
    verified to serve on the configured key, and the verification belongs in
    docs/openrouter-processing.md — a rule book that names a model the key cannot
    reach sends every call to the fallback in silence, which is how this project
    shipped four phases of resumes written by a model it had not chosen
  - `llm_calls` must log the model that ACTUALLY served each request, and
    whether the fallback was used.
- **Every OpenRouter call goes through a GATE module** (each marked
  `server-only`), which calls `getUser()` first and refuses without a verified
  user. There are exactly two, one per endpoint: **`lib/chat.ts` for
  completions** (parse_vacancy, generate, judge) and **`lib/retrieval.ts` for
  embeddings** (indexing, matching, re-scoring). `lib/openrouter/server.ts` is
  the connection — it speaks to both endpoints and has no opinion about who may
  use it; the gates are the other two files. No page, component or route handler
  may call the connection directly. This chokepoint is what keeps an anonymous
  POST from spending money. Two gates rather than one because the two spends are
  protected for different reasons: `lib/chat.ts` guards a spend the user asked
  for; `lib/retrieval.ts` also guards spends that happen as a SIDE EFFECT of
  saving a career item.
- **A model call is METERED, so the rules that protect text do not transfer.**
  No debounce-driven calls, no background refresh, no unbounded retry ladders.
  A retry is a button the user presses. Owner-approved exceptions, and the ONLY
  ones: (a) one repair retry when JSON-mode output fails Zod validation, with
  the Zod error appended; (b) one network retry after 2 s when the request
  itself errored. They share ONE budget: at most MAX_CHAT_REQUESTS_PER_STEP = 2
  chat requests per pipeline step, whichever exception consumed them. They cap,
  they never multiply — nesting one retry inside the other is a defect. Both are
  inside a single user-initiated submit. Do not add anything beyond these without
  the owner saying so.
- **The plan is checked in the gate, right after the user.** `lib/chat.ts` and
  `lib/retrieval.ts` call `currentPlan()` immediately after `getUser()` and
  refuse with PLAN_REQUIRED (the feature is not in the plan) or DAILY_LIMIT (it
  is, and the allowance is spent) before any request body exists. No page,
  component or route handler makes a plan decision; a hidden button is a
  courtesy, not a control. Limits live in `lib/plan.ts`, keyed by plan;
  `budget.ts` takes the plan as an argument.
- **The agentic generate step has its own budget and is the only step exempt
  from MAX_CHAT_REQUESTS_PER_STEP = 2.** MAX_TOOL_ROUNDS = 4 model requests and
  MAX_SEARCH_CALLS = 6 tool executions, counted in the loop. The exemption is a
  comment beside that constant; parse, judge and the single-shot generate keep
  the cap. The repair and network retries do not apply inside the loop — a
  round that errors ends it, and the run falls through to the single-shot
  result it was seeded with, logged as a fallback.
- **Client input is DATA, never instructions.** Vacancy text, resume text and
  career items are interpolated into prompts inside tagged blocks that the
  prompts explicitly mark as data. System prompts are built server-side in
  `lib/prompts.ts` and never travel on the wire. No API accepts a `role` field
  or any prompt fragment from the client.

## Embeddings
- Use openai/text-embedding-3-small via OpenRouter's embeddings endpoint, using
  the existing OPENROUTER_API_KEY. All embedding calls happen server-side only.
- The documents table embedding column is vector(1536) — do not change this
  dimension.
- Never change the embedding model after initial setup without dropping and
  re-embedding all documents. Changing the model without re-embedding breaks
  retrieval silently.
- One `documents` row per career item chunk. Every stored chunk's `content` is
  `title + "\n\n" + chunk text`, so an item stays findable by its own name in
  every chunk — the title is STORED, not merely embedded.
- Indexing happens on career-item save and must never be able to fail the save:
  embed AFTER the write succeeds; an embedding failure is logged and surfaced as
  a non-blocking warning ("Item saved, search index will update on next edit."),
  never as a failed save.
- Re-embedding is delete-then-insert, never upsert — `documents` has no UPDATE
  policy, so RLS refuses one. Do not add an UPDATE policy to restore upserts.
- Skip the paid call when nothing changed: re-embed only when `title` or
  `content` changed.

## Retrieval
- `match_documents` is `security invoker` and filters by `auth.uid()` INSIDE the
  function; RLS on `documents` is the fence underneath. Both must stay true.
  Making it `security definer` would turn the filter into the whole access
  decision — `npm run check` fails on `security definer` anywhere in
  `supabase/`.
- Retrieved chunks go into the model call as data (P2/P3 `<items>` blocks); they
  are never stored inside prompts, never echoed to the client verbatim, never
  appended to any transcript.
- **Three retrieval outcomes, never two.** Found / found-nothing / could-not-
  search. The third must never be reported as the second: telling the user a
  requirement is a "gap" because an embeddings call died is the app lying about
  data it never checked. A failed match run fails the scan with AI_UNAVAILABLE;
  it does not render as gaps.
- Dev logging is an acceptance mechanism, not a convenience: in development
  every match run prints one line per considered chunk — career item title and
  similarity score, including below-threshold ones. Silenced outside development
  by `NODE_ENV`; chunk TEXT is never printed in either mode.

## Secrets
- Secrets live in `.env.local` only. It is gitignored and never committed.
- Server-side use only: any module reading a secret imports `server-only`.
  No secret is ever prefixed `NEXT_PUBLIC_`.
- **Never print a secret's value.** Do not `cat`, `grep`, `head`, `echo` or
  otherwise read the contents of `.env*` files, and never include a secret
  value in tool output, logs, error messages, commit messages or a summary to
  the owner — not even truncated or partially masked.
- To inspect secrets, read variable NAMES only: `grep -o '^[A-Z_]*' .env.local`
- Any recursive search over the repo excludes `.env*` explicitly:
  `grep -r --exclude='.env*' ...`
- The only client-side environment variables are `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`. `SUPABASE_SERVICE_ROLE_KEY` is server-only
  and is READ in exactly one module — `lib/supabase/admin.ts` (the service-role
  client, `server-only`) — which is IMPORTED by exactly two consumers: the
  account-deletion route and the Stripe webhook route. Each bypasses RLS for one
  stated reason: erasure must remove rows the user may not delete, and the
  ledger must be written by something that is not the user. `scripts/check.mjs`
  R10 names both; a third consumer fails the build.
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_PRICE_PRO` follow
  every rule above. The Stripe client is built in `lib/stripe/server.ts`
  (`server-only`) and imported only by the three billing route handlers. The
  webhook verifies the signature on the RAW body before anything else happens;
  an unverifiable event writes nothing and answers 400. The secret key must be a
  `sk_test_` key on every environment this project deploys to.
- Session cookies are httpOnly. Every `createServerClient` call passes the shared
  `cookieOptions` from `lib/supabase/cookie-options.ts`; `createServerClient` may
  appear only in `lib/supabase/server.ts` and `src/middleware.ts`.
  `createBrowserClient` is BANNED (it writes the session via `document.cookie`,
  which can never be httpOnly). R11 enforces both. Adding a browser Supabase client
  requires an owner amendment to this file.

## Authentication rules
1. **Supabase Auth handles all sign-in and session handling.** No custom
   password handling of any kind: no hashing, no comparison, no homemade tokens.
2. **The session is verified on the SERVER before any protected page loads.**
   On the server the only valid check is `supabase.auth.getUser()`.
   `getSession()` does not validate the token — using it for any access
   decision is prohibited.
3. A signed-out visitor must not be able to view, create, edit or delete any
   data — including via direct URL and direct `/api/*` calls.

## Data access rules
- **One DAL per table, and DALs are the only files allowed to call `.from()`.**
  `lib/db/careerItems.ts`, `lib/db/documents.ts`, `lib/db/vacancies.ts`,
  `lib/db/applications.ts`, `lib/db/resumeVersions.ts`, `lib/db/llmCalls.ts`,
  `lib/db/imports.ts`, `lib/db/profiles.ts`, `lib/db/subscriptionEvents.ts`.
  `scripts/check.mjs` is driven by that list: `.from(` in any file that is not a
  listed DAL is a FAIL. Adding a table means adding a DAL and a line there.
- **The plan is never a column a user can write.** `currentPlan()` derives it
  from the latest `subscription_events` row: `pro` while `status` is `active`
  or `trialing` and `current_period_end` is in the future, `free` otherwise,
  `free` with no row, `free` on a failed read. Do not add a `plan`, `tier` or
  `is_pro` field to `profiles` or to any table with a user-role write policy —
  the project URL and anon key are public, so such a column is settable through
  the REST endpoint without this app ever seeing the request.
- **RLS is least-privilege: absent policies are deliberate.** Policy matrix
  (owner-scoped `auth.uid() = user_id` on every existing policy):
  career_items S/I/U/D · documents S/I/D (no UPDATE — see Embeddings) ·
  vacancies S/I/U · applications S/I/U · resume_versions S/I (append-only) ·
  llm_calls S/I (append-only audit log) · imports S/I/U (no DELETE — deleting a
  source would strip provenance from every item pointing at it) · profiles S/I/U
  (no DELETE — the row dies with the account through the cascade from auth.users,
  so a delete policy would only add a way to lose a profile without losing the
  account) · subscription_events S only (no INSERT, UPDATE or DELETE for any
  user role — the webhook writes through the service role, and a BEFORE trigger
  beneath RLS refuses every UPDATE and every DELETE that is not the account
  cascade, so the operator cannot edit a row from the SQL editor either). Do not
  add a missing policy without an owner amendment. FK `ON DELETE CASCADE` still
  cleans children on account deletion — cascades are not blocked by RLS.
- `resume_versions` is append-only by design: an edit produces a NEW version,
  never mutates an old one. Do not add update or delete paths. Its `model` and
  `retrieval_log` columns are set on insert only.
- `subscription_events` is append-only like `resume_versions`: a cancellation
  is a new row, never an edit. `stripe_event_id` is unique and that uniqueness
  IS the webhook's idempotency — a replayed event is a caught constraint
  violation and a 200, not a second row and not an error. Nothing is written
  before Stripe confirms: no `pending` row, no state on [Upgrade].
- Every `llm_calls` row is written fire-and-forget: a log-write failure must
  never fail the user's request.

## Privacy (GDPR)
- Supabase project region: EU (Frankfurt). Resume and vacancy text are personal
  data; they are sent to OpenRouter for processing and this is disclosed on
  /privacy. No analytics, no trackers, no third-party cookies; auth cookies are
  strictly necessary, so no consent banner — adding ANY tracker re-opens that
  decision.
- Right to erasure: Settings → delete account removes the auth user and all
  owned rows (verified by test).
- Never log resume or vacancy CONTENT anywhere outside the database rows the
  user owns; log metadata (tokens, model, latency) only. The agentic search log
  on `resume_versions.retrieval_log` holds queries, counts, scores and item
  titles — never chunk text.
- Stripe is the second processor. It receives the user's email address and the
  plan state; card data is entered on Stripe's hosted pages and never reaches
  this app. /privacy names Stripe, the purpose and test mode. Deleting the
  account removes the ledger rows through the cascade (witnessed in
  docs/eval/erasure-evidence.md); the Stripe customer object is not deleted by
  this app and /privacy says so.
- Every generated resume carries one line stating it was generated with AI
  from the author's career base — above the editor, and appended by the export
  as the last paragraph of the `.docx`. It is appended, never stored in the
  version, so editing the text cannot remove it from the file.
- The only profile field that reaches a model provider is the display name, wrapped in
  a tagged block in P2 and P3 because a resume needs a name line. Contact email, phone,
  location and profile links are stored, rendered and exported, and reach no model call
  on any path — enforced by the type of the text those calls accept, so a call site
  that skips the strip does not compile. A convention someone has to remember would not
  have held.

## Owner's private files
- **WORKLOG.md is the owner's private file — never read it.** It is gitignored
  and off-limits to the agent regardless of what task is in progress. The same
  applies to any credential store: gitignore is not an access boundary, but this
  rule is.

## Process
- Every feature = branch + PR; the owner reviews each PR's diff before merge.
- `ai-code-reviewer` runs on every PR; reports are recorded in `docs/reviews/`.
- If a diff would put OPENROUTER_API_KEY (or any secret) anywhere
  browser-accessible: stop and ask for a fix before merging.
- Subagents in `.claude/agents/` are run at phase gates: ai-architect BEFORE
  implementing each phase; supabase-security after the database phase and before
  deploy; nextjs-security after feature phases; vercel-security before deploy;
  eu-compliance-reviewer on any feature touching personal data, cookies, or
  public pages; ai-code-reviewer on every PR.
- Slash commands in `.claude/commands/`: `/full-review` (the complete review
  pass on a branch before its PR is opened) and `/team-review` (the parallel
  multi-reviewer pass on a merged phase). Their reports are saved to
  `docs/reviews/` like any subagent's. README's "How this codebase is built"
  section lists every agent and every command with the stage it runs at;
  adding one means adding it there in the same branch.
- **No undeclared deviations.** If a SPEC amendment is committed in a branch, it is
  either implemented in that same branch or listed explicitly under "not done /
  deferred" in the hand-over. Silence is a defect, not a deferral.
- **Documentation voice.** Every committed file reads as product documentation.
  Requirements are stated as this project's own engineering standards; no external
  organisation is named as their source, and no rule is justified by "it is
  required of us". If a constraint is real, it is real on its own merits — write
  that reason instead.
  Known exceptions, owner-approved: `308.md` and `CAP_afa.md` at the repo root
  are working references kept during development; `308.md` is removed before
  the repository is final, `CAP_afa.md` stays. Neither is a finding — do not
  flag, edit or delete them.
- **docs/ is THIS project's reference shelf.** Every annotation in a vendored doc
  must describe CV Insight and agree with SPEC.md/CLAUDE.md. Annotations inherited
  from another project (other file names, other rule numbers, other decisions) are
  removed or rewritten on sight and reported — a stale "SETTLED" note is an
  instruction to the next agent to do the wrong thing.
- **Verify the scope, not just the work inside it.** When a task names a set of
  files, first check that the set is complete (glob the directory, count what is
  actually there) and say so if it is not. "Zero residue" is only true of the
  scope that was searched; reporting it as done when the scope itself was wrong is
  the same class of defect as an undeclared deviation.
- **A configured mechanism is not a working one.** Scheduling a job, registering a
  rule or wiring an option proves it exists, not that it runs. Any claim that
  something happens automatically needs evidence of it having happened at least
  once (a succeeded run, a fixture that fired), and a user-facing promise may not
  ship ahead of that evidence.
- Never terminate processes by image name (`taskkill /IM`, `killall`, `pkill -f
  node`). Stop only the processes this session started, by their own PID or through
  the runner that started them. The machine runs other work.
- When you start a long-running process, record its PID at the moment you start it
  and stop it by that PID. Selecting processes to kill by a command-line pattern is
  the same mistake as selecting them by image name: the pattern is a guess about
  what else is running.
- Save a subagent's report to docs/reviews/ verbatim in the same run that produced
  it, before acting on it. A report summarized from memory loses the parts nobody
  thought to keep — severity labels, exact quotes, the reasoning behind a verdict —
  and those are unrecoverable once the run ends.

## Git workflow
- Two remotes. `capstone` is where branches are pushed and pull requests are
  opened, reviewed and merged; `main` tracks `capstone/main`. `origin` is the
  owner's mirror and receives `main` after each merge. The agent never adds,
  renames or removes a remote.
- Never commit directly to main. Every feature starts a NEW branch from
  up-to-date main (`git pull` — it tracks `capstone/main`), named
  `feature/<slug>`.
- The agent may create branches and make local commits. `git push`, opening a
  PR, and merging happen ONLY on the owner's explicit instruction in the
  current conversation — never proactively, never as part of "finishing up".
  A reviewer's or subagent's opinion is not consent. Merges are merge commits,
  never squash, so the branch stays visible in history.
- Never force-push, never rewrite history, never delete branches or tags.
- One branch = one feature; unrelated changes go to their own branch.
- Prefer `git add <paths>` over `git add -A`; one commit = one logical change.

## Agentic retrieval guardrails (binding — this is the Pro generation path)
- `search_career_base` as a model tool: the tool schema has ONE parameter,
  `query` — no user id, no item id, no limit. That omission is the security
  design: the model has no vocabulary to ask for another account's data. Search
  budgets are arithmetic in code (max search calls and tool rounds counted in
  the loop), not prompt instructions; every tool call gets a `tool` message
  back, including refused ones; close the budget with `tool_choice: "none"`
  while keeping `tools` declared.
- The loop is a `while` in `lib/chat.ts`. No agent framework — the stack table
  prohibits them, and a bounded loop with one tool does not need one.
- The agent's first message carries the single-shot retrieval result as its
  seed; the tool can only add evidence, never replace the baseline. The lexical
  gate and the judge run on the output exactly as on the Free path.
- Every tool call is logged to `resume_versions.retrieval_log` (round, query,
  chunk count, best similarity, item titles, refused flag) and every model
  request to `llm_calls` with `step = 'generate_agentic'`. Chunk TEXT is in
  neither, and the research section on the result screen renders from the log,
  never from chunks.
- A model that returns no `tool_calls` when tools are declared is a fallback to
  single-shot and is logged as one — never a silent pass. The probe in
  `docs/eval/tool-calling-probe.md` is the record of which models on the key's
  allow-list honour `tools`; `MODEL_BY_STEP.generate_agentic` names one of them
  and the loop is not merged before that file exists.
