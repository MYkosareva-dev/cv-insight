# Pre-implementation review: feature/go-public (ai-architect, verbatim)

Scope: plan items 1–4 (registration open; Impressum; README; docs/deploy.md).
Run 2026-10-13, before any code change on the branch. Saved verbatim.

---

VERDICT: REVISE. One blocker: the plan quietly departs from the SPEC v3.0 cost-fence rationale. Everything else is approve-with-changes.

Findings:

1. [BLOCKER] SPEC.md:1163 and SPEC.md:1779 against plan items 3 and 4 (provider key with no credit limit). The v3.0 supersession note gives two reasons for opening registration with confirm-email OFF. The first is that "the provider's credit limit on the key bounds what the deployment can spend in total". The second is that "the key's credit limit is the protection against bulk sign-up, not a mailbox". It also says deploy.md gets "a new step [that] records the credit limit set on the provider key". DoD 16 (1779) tells README to name the fence as "Free plan per account, credit limit on the key". Your plan says the key carries no limit the operator can set. DoD 17 (1780) does allow that ("stating that plainly"), but then the confirm-email-OFF rationale in Block E is false. With no total ceiling and no mailbox step, the Free limits fence each account, not the deployment: N scripted sign-ups get N times the allowance. → Required change: add a `> Decision:` amendment to SPEC Block E v3.0 (and the wording of DoD 16) that says (i) no credit limit can be set on this key, (ii) the only bound is per account, so the total is unbounded under bulk sign-up, and (iii) why confirm-email stays OFF anyway, or that it is turned ON. The owner makes that call, not the agent. The README sentence "the Free limits are the only fence; exhaustion surfaces as AI_UNAVAILABLE" also needs fixing. Exhaustion of what? With no operator limit, the only "exhaustion" is the other party's account balance. Say exactly that.

2. [MAJOR] docs/reviews/full-review-2026-10-12-architecture.md:26-36 (H1) and docs/reviews/full-review-2026-10-12-nextjs-security.md:51-58. The Free/B7 caps are observe-then-spend. `llm_calls` rows are written in `after()`, so N parallel requests all read the same count and all pass. The architecture review said "Registration must not open before this exists". nextjs-security said it becomes High once registration opens with confirm-email OFF. I found no disposition of it: grep of docs/backlog.md for parallel/burst/reservation found nothing, and SPEC.md:934 only declares the per-instance generate lock. This plan opens registration and writes "enforced in the gates" as the fence. → Required change: either fix it (a reservation or an advisory-lock counter, which is a separate branch with its own architect pass), or have the owner explicitly accept the risk. Record the acceptance in the same SPEC amendment as finding 1 and as a backlog entry. README's fence paragraph must then say that the per-account limits are not race-safe under concurrent requests. Opening registration while silent on a known open review finding is an undeclared deviation.

3. [MAJOR] docs/eval/billing-webhook-evidence.md:3-9 (DoD 12, deployment half pending). The plan writes the deploy.md Stripe steps but does not say whether the deployment run happens in this branch. → Required change: either run it and record it in this branch, or list DoD 12's deployment half under "not done / deferred" in the hand-over. The CLAUDE.md "No undeclared deviations" rule applies.

4. [MAJOR] Plan item 3, CI paragraph cites `docs/eval/e2e-go-public-run.txt`. That file does not exist (glob of docs/eval/). → Required change: README may cite it only once a real run is committed (CLAUDE.md "A configured mechanism is not a working one"). Otherwise state that the suite *can* run against the deployed project and has not yet. Close or update the CI backlog entry the v3.0 note says this closes (docs/backlog.md:78 and :782 still say "registration is closed").

5. [MINOR] Stale "registration closed" text outside the plan's file list. Scope check (grep over the repo excluding .env* and WORKLOG.md) found:
   - scripts/demo-seed.mjs:136 ("registration is closed, so this script cannot make one")
   - docs/eval/fresh-clone-verification.md:164
   - docs/backlog.md:78, :782 (and the long lines :742/:744)
   - docs/deploy.md:124-127 (NODE_ENV "three behaviours" → two). The plan covers this one.

   → Required change: fix or declare each. Leave docs/reviews/* as they are, since they are verbatim records. Leave the deploy.md 2026-09-04 record row 11 (:319) as history; the plan already says so.

6. [MINOR] Question (a), AuthForm types (src/components/auth-form.tsx:37-45, :115). Make `altHref` and `altLabel` required `string` and delete the conditional. Both callers always pass both after this change. A discriminated union would keep a branch for a state that no longer exists in any environment. Rewrite the prop docblock, because :37-43 explains the v2.25 reason. Add one clause to the SPEC v3.0 note (1163) saying the props became required. Otherwise SPEC:1157 ("optional together … a type error") is the last word on the props and contradicts the code.

7. [MINOR] Question (b), the four stale README facts: in scope, all four. DoD 16 asks for an accurate README, and each one is a false security claim on a public deployment:
   - README:343, "exactly one consumer" → two (CLAUDE.md Secrets: account deletion and Stripe webhook).
   - README:454-462, migrations 001-005 and "eight tables" → 001-007, nine tables.
   - Add subscription_events (S only) to the RLS table.
   - Env list → seven names, with STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_PRO server-only.

   Fixing them is not drift; leaving them is.

8. [MINOR] The README limits paragraph should give the real table. From src/lib/plan.ts:61-74:
   - Free: 50 chat rows per 24 h overall, parse_vacancy 3, generate 1, rescore 20.
   - Pro: 50 chat rows overall, no per-step allowance, rescore 100, agentic.

   "50 chat/24h" is the same ceiling on both plans; say so, or the Pro section implies a higher chat ceiling than exists. The judge and import calls are bounded only by the 50-row ceiling.

9. [MINOR] Per-version provenance (README:680-684). `resume_versions.model` and `retrieval_log` were added in migration 006 (supabase/migrations/006_subscription_events.sql:57, :63), not 007. Versions written before 006 have NULL. The README sentence "has no model column" is now false, as is the claim that /quality cannot report by model. Narrow it: per-model reporting is possible for post-006 versions, if /quality actually does it. If it does not, say that it does not.

10. [NOTE] "How this codebase is built" (README:548-573) already lists all six agents and both commands. A glob of .claude/agents and .claude/commands gives exactly 6 + 2, so that part of DoD 16 is already met. Say so in the hand-over rather than leaving it unmentioned.

11. [NOTE] "Not built, deliberately" (README:686-687) has no payments or agentic entry, so that part of DoD 16 is already met. Removing the "Plans and billing are built" and "Agentic retrieval … deferred to go-public" paragraphs (README:689-697) after moving their content to the pipeline section is correct. Put the "### 6b" Pro subsection before "### The call budget" (README:148) and update that section with the agentic exemption (MAX_TOOL_ROUNDS=4 and MAX_SEARCH_CALLS=6 are exempt from MAX_CHAT_REQUESTS_PER_STEP=2).

12. [NOTE] Impressum, plan item 2. A docblock-only edit is fine. src/lib/copy.ts:110-111 already carries the sk_test_ trigger, so this is reordering, not new content. On F5: docs/backlog.md is "known and open" (README:702-703), so a resolved finding listed there as open is a small false claim. If the owner wants it in the backlog, write it as closed with a pointer to SPEC v3.0a decision 12. Recording it only as closed in the hand-over is also fine. F2 belongs in the backlog as planned.

13. [NOTE] deploy.md:29 already lists migrations 001-007 with the 007 ordering warning. An "explicit apply list" adds to it; don't duplicate the warning in a way that lets the two drift apart. Steps 2 and 3 and the "Known open items" bullets at :302-306 are rewritten as planned. The erasure re-run note at :303-305 ("needs registration briefly re-opened") becomes moot.

14. [NOTE] Question (d), CLAUDE.md compliance. No chokepoint, DAL, server/client or secret-boundary change: the diff touches two pages, one client component, copy.ts and docs. AuthForm stays free of secrets and model logic, and scripts/check.mjs has no rule that depends on /signup. The rules at risk are "No undeclared deviations" (findings 1-4) and "A configured mechanism is not a working one" (finding 4). In the "Do not set NODE_ENV" text, keep the two behaviours that still depend on it: the /api/dev/* fence and the cookie `secure` flag.

Deviations needing a SPEC/CLAUDE amendment:
- SPEC Block E v3.0 note (1163) and DoD 16 (1779): no credit limit exists on the key, so the bulk-sign-up rationale for confirm-email OFF needs restating or reversing (owner decision).
- The concurrency bypass of the B7 caps: accept the risk or fix it before registration opens (owner decision), recorded in SPEC and the backlog.
- SPEC 1157 (AuthForm props optional together): superseded by required props, one clause in the v3.0 note.
- DoD 12 deployment half: done in this branch, or declared deferred in the hand-over.

Files:
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(auth)\signup\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(auth)\login\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\auth-form.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\plan.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\README.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\deploy.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\backlog.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\billing-webhook-evidence.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\fresh-clone-verification.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\scripts\demo-seed.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\reviews\full-review-2026-10-12-architecture.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\reviews\full-review-2026-10-12-nextjs-security.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql

Scope note: per the token instruction I read only SPEC.md 1139-1170, 1311-1339 and 1747-1781, plus the single line 934 to check the concurrency disposition. Block A/C/D/F were not re-read; nothing in this plan touches them.
