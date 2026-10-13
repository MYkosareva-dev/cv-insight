# AI Code Review — feature/final-evidence — 2026-10-13

- **Branch:** `feature/final-evidence`
- **Base:** `main` @ `5ad88e4120c5208ac4eb30462759636e33fe4d22`
- **HEAD:** `db4480cc7e6ee11655a9243d9646c610b0ebf0bd`
- **Commits in range (6):** `dcce716`, `2a18e09`, `5a9dafe`, `f963fe1`, `6744bcb`, `db4480c`

**Scope.** The owner narrowed this review. It is not a full four-pass review. It covers:
1. Whether `src/` is changed by comments only, and `scripts/` and `supabase/` not at all.
2. Whether the `webhook.ts` comments agree with SPEC M12 as amended and with what `handleStripeWebhook` actually does.
3. Whether the SPEC M12 and P15 edits agree with the code and with README.
4. Whether `docs/eval/release-verification.md` is internally consistent.

No `.env*` file was read. Every recursive search excluded `.env*`. No file was modified.

Verdict: **APPROVE** (no blockers, no majors; four minor findings and one nit, listed below)

---

## 1. Code change is comment-only: confirmed

```
$ git diff --stat main...HEAD
 SPEC.md                           |   4 +-
 docs/backlog.md                   |  32 +++++
 docs/eval/release-verification.md |  52 ++++++++
 docs/eval/security-scan.md        | 248 ++++++++++++++++++++++++++++++++++++++
 src/lib/billing/webhook.ts        |   9 +-
 5 files changed, 340 insertions(+), 5 deletions(-)

$ git diff --stat main...HEAD -- src scripts supabase
 src/lib/billing/webhook.ts | 9 ++++++---
 1 file changed, 6 insertions(+), 3 deletions(-)
```

The diff touches no file under `scripts/` or `supabase/`. I filtered the changed lines in `src/` to drop every line that begins with ` *` (the inside of a JSDoc block). Nothing was left (grep exit 1), so every changed line is inside the doc comment above `handleStripeWebhook`. The two hunks, from `src/lib/billing/webhook.ts`:

```
-    deliver in order and redelivers for days, so a late copy of an old
+    deliver in order and redelivers failed deliveries for a limited window,
+    so a late copy of an old
...
-    ignored rather than written — a malformed id would fail the insert and be
-    retried for three days. No user → 200 and a warn line with the event id.
+    ignored rather than written — a malformed id would fail the insert, answer
+    500 and be redelivered to no purpose. No user → 200 and a warn line with
+    the event id, and no redelivery: only read, parse and insert failures
+    answer 500 and are redelivered (SPEC M12, "no reconciliation job").
```

I re-ran both checks on HEAD:
- `node scripts/check.mjs` printed `check passed (13 rules): ...`
- `npm test` printed `tests 491 · pass 491 · fail 0`

## 2. Comments vs SPEC M12 vs actual behaviour

What the code does, outcome by outcome:

| Outcome | Code | Answer | SPEC M12 (amended) | webhook.ts comment |
|---|---|---|---|---|
| No signature or bad signature | `webhook.ts:177`, `:182` | 400 | "A failed signature answers `400`" ✓ | step 1 ✓ |
| Verified event, envelope does not parse | `:186` | 500 | "verified event whose fields do not parse" ✓ | "parse" ✓ |
| Event type the app does not use | `:188` | 200 | ✓ | step 2 ✓ |
| Checkout session or subscription id does not parse | `:196`, `:204` | 500 | ✓ (parse) | ✓ |
| Checkout that is not a subscription (`mode !== 'subscription'` or no subscription) | `:198` | 200 | **not listed** | **not listed** |
| `subscriptions.retrieve` throws | catch `:234` | 500 | "read … the subscription from Stripe" ✓ | "read" ✓ |
| Subscription retrieved but `snapshotOf` returns null | `:209` | 500 | not literally covered (see m2) | not literally covered |
| No account can be attributed | `:215–217` | 200 + warn | ✓ | step 4 ✓ |
| Ledger customer lookup throws | `subscriptionEvents.ts:80`, then catch `:234` | 500 | "the ledger's customer lookup" ✓ | covered by "read" ✓ |
| Insert hits a unique violation (replay) | `subscriptionEvents.ts:55` | 200 | ✓ | step 5 ✓ |
| Insert hits an FK violation (deleted account) | `subscriptionEvents.ts:56`, `webhook.ts:230` | 200 + warn | ✓ | step 5 ✓ |
| Any other insert error | `subscriptionEvents.ts:57`, then catch | 500 | ✓ | "insert" ✓ |
| Misconfiguration (missing secret, live key) | `src/app/api/stripe/webhook/route.ts:52–60` | 500 | **not in the "Only …" list** (see m1) | not mentioned |

Overall, the comments, SPEC M12 and the code agree on every main 200, 400 and 500 path. The gaps are minor and listed below.

## 3. SPEC M12 / P15 vs README

- M12 (`SPEC.md:1531`), P15 (`SPEC.md:1732`) and README (`README.md:776–785`) agree on four points:
  - Stripe retries for "a limited window", which is shorter in test mode.
  - "Being confirmed" appears only on the return from Checkout.
  - A later visit inside the window shows plain Free.
  - A missed cancellation shows Pro with no notice.
- The code matches. `SETTINGS.upgradePending` is rendered at `src/app/(app)/settings/page.tsx:216`, and the in-code comment `settings/page.tsx:99` describes only the `?checkout=success` path.
- `SPEC.md:362` ("if not yet, 'Your upgrade is being confirmed'") sits in the Checkout-return flow, so it does not contradict the amendment.

## 4. `docs/eval/release-verification.md`

- **Commit and date:** `5ad88e4120c5…` and 2026-10-13 match `docs/eval/security-scan.md:3–4`. ✓
- **Scan counts:** "0 critical, 0 high, 0 medium, 2 low, 5 informational" (`release-verification.md:52`) matches `security-scan.md:165` (`Critical 0 · High 0 · Medium 0 · Low 2 · Info 5`). It also matches F1–F7, where F1–F2 are Low and F3–F7 are Info. ✓
- **Audit:** "`npm audit --omit=dev` … found 0 vulnerabilities", with one dev-only chain tracked as `dp-1` (`:42–48`). This matches `security-scan.md:31–61`: five High entries along one `eslint-config-next → … → braces` path. `dp-1` exists at `docs/backlog.md:380`. ✓
- **Check and test counts:** 13 rules and 491 tests (`:32–36`) match the scan's §3 and my own re-run. ✓
- **Migrations:** "NOT re-run … last run covers `001`–`005`; `001`–`007` prepared, not run" (`:38`) matches `fresh-clone-verification.md:85` ("Migrations 001-005 applied") and `:195` ("Re-run for `001`–`007` … PREPARED, NOT RUN"). `supabase/migrations/` holds exactly `001`–`007`, so the claim that `006` and `007` have no from-empty evidence is accurate. ✓
- **Owner-run vs re-observed:** each table row labels its source. Line 14 (registration without email confirmation) is correctly marked "owner run" only. ✓

`docs/backlog.md` (sc-1, sc-2) and `docs/eval/security-scan.md` §7 agree with each other. Neither contradicts anything above.

---

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR

- **m1. The "only these answer 500" lists in M12 and in the webhook comment leave out the route-level misconfiguration 500.**
  - `src/app/api/stripe/webhook/route.ts:52–60` answers 500 when `stripeClient()` or `webhookSecret()` throws (missing secret, or a key that is not `sk_test_`). Stripe redelivers that answer like any other non-2xx.
  - `SPEC.md:1531` says "**Only** a failure to read … a failed ledger insert, or a verified event whose fields do not parse answers `500`, and only those are redelivered". `webhook.ts:161` says "only read, parse and insert failures answer 500".
  - P15 ("endpoint misconfigured") covers the scenario in prose, but M12's exhaustive "Only" is literally incomplete.
  - The same comment block also says at `webhook.ts:166` "6. Anything unexpected → 500". That sits uneasily beside "only read, parse and insert failures" four lines above it.
  - Suggested fix: add "or the endpoint's own configuration (route.ts)" to M12. Either drop "only" from line 161 or reconcile it with item 6.

- **m2. A retrieved subscription that fails `snapshotOf` is a 500 that neither text names exactly.**
  - `webhook.ts:208–209`: `const snapshot = snapshotOf(await deps.retrieveSubscription(subscriptionId)); if (!snapshot) return FAILED;`
  - This is a parse failure of Stripe's read response, not of "a verified event's fields" (SPEC wording). "Read" in a loose sense covers it, but the SPEC wording is narrower than the behaviour. A one-word widening fixes it: "a read, or a verified event, whose fields do not parse".

- **m3. The non-subscription Checkout 200 is missing from M12's list of 200s.**
  - `webhook.ts:198` returns `RECEIVED` for a `checkout.session.completed` with `mode !== 'subscription'` or no subscription.
  - M12 lists the 200 outcomes (unused type, unattributable, deleted account, replay) as though the list were complete, but leaves this one out. It is harmless and the in-code comment explains it, but the SPEC enumeration is not exhaustive.

- **m4. The old "three days" wording survives in two files outside the diff and now contradicts amended M12 and P15.**
  - `src/lib/db/subscriptionEvents.ts:46`: "redelivering it for three days would not make the account exist again". It also says "redelivering", while the code answers 200 here, so nothing is redelivered.
  - `tests/unit/webhook.test.mjs:277`: test title "…200 and a warn, not three days of retries (P12)".
  - The branch removed this phrasing from `webhook.ts` but did not cover the other places it appears (CLAUDE.md, "Verify the scope"). Both are comment or title strings, with no behaviour impact. Fix in this branch or a follow-up, and declare which.

### NIT

- **n1. "Re-observed in the working tree" names no tree** (`docs/eval/release-verification.md:36`). The working tree that ran `npm run check` and `npm test` was presumably `feature/final-evidence`, not `main` @ `5ad88e4`. The two differ only in comments and docs, so the figures still hold. Naming the branch and commit (or "`5ad88e4` plus comment-only changes") would make the provenance exact. My re-run on `db4480c` gives the same figures: 13 rules, 491/491.

---

Checked: secrets ✓ (no secret-bearing change; `.env*` not read), RLS ✓ (no `supabase/` change), chokepoints ✓ (`check.mjs` passed, 13 rules), zod ✓ (no new input or LLM output), llm_calls logging ✓ (n/a, no model call touched)

**Verdict: APPROVE.** The only change under `src/` is a comment in `src/lib/billing/webhook.ts`. The amended M12 and P15 match the handler's 200, 400 and 500 behaviour on every main path, and they agree with README. The release-verification record is consistent with the security scan and with the fresh-clone evidence. m1–m4 are wording precision and leftover old wording outside the diff. Fixing them in this branch is advisable but not required to merge.
