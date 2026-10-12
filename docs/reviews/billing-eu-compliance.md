# eu-compliance-reviewer — /privacy and /impressum, `feature/billing`

Scope: `src/app/privacy/page.tsx`, `src/app/impressum/page.tsx` and the copy constants they
render. Run once, after the "Plans and payment" paragraph, the Stripe processor entry and the
Impressum "About this deployment" sentence were written. Saved verbatim.

---

eu-compliance-reviewer: scoped review of feature/billing, covering /privacy, /impressum and the copy.ts constants they render.

**Method note.** I had no shell tool in this run, so I could not run `git diff main -- ...`. I reviewed the working-tree contents of the three files directly. To check the claims against what the code does, I also read SPEC.md lines 1255–1290, supabase/migrations/006_subscription_events.sql, src/app/api/billing/checkout/route.ts, src/app/api/account/route.ts, src/lib/stripe/server.ts and docs/eval/erasure-evidence.md. I edited no files.

```
VERDICT: ACTION NEEDED  (plus two ESCALATE TO LEGAL items: Stripe's controller/processor role and transfer mechanism, and the §5 DDG position)

New data flows:
- App -> Stripe (Checkout Session create): the account email (customer_email) and the account UUID (client_reference_id and subscription_data.metadata.user_id). Basis: Art. 6(1)(b). Recipient is a third-country company (US group).
- User -> Stripe directly, on Stripe's hosted page: card data, cardholder name, billing country/postcode as the form asks, and IP/device data. The app never sees these, but the page should name them as collected by Stripe.
- App -> Stripe (Portal): the Stripe customer id.
- Stripe -> App (webhook) -> subscription_events in EU-Frankfurt: user_id, stripe_event_id, event type, customer id, subscription id, status, cancel_at_period_end, current_period_end, received_at. FK NOT NULL ON DELETE CASCADE to auth.users. Verified in 006.
- No new cookies, storage or scripts on these two pages (static content only).
```

## Findings

**[MAJOR] P1. The processor count is now wrong.**
- The page says: "Three service providers process data on our behalf and on our instructions."
- The same paragraph then lists four: Supabase, Vercel, OpenRouter and Stripe.
- This is drift inside the page itself.
- Proposed change: replace "Three service providers" with "Four service providers". Also see P2, which may affect "on our behalf and on our instructions".

**[MAJOR, ESCALATE TO LEGAL] P2. Stripe's role is stated as purely a processor, and nobody has checked that.**
- The page says Stripe processes "on our behalf and on our instructions". The "Why we process it" section says "nothing is sold or shared with anyone for their own purposes."
- Stripe collects card, billing and device data directly from the user on its own pages. Payment providers commonly act as independent controllers for some of that processing, such as fraud prevention and their own legal obligations.
- I am not stating Stripe's actual classification as fact. The owner has to read Stripe's current DPA and privacy policy for the account's region, and get legal advice if it is still unclear. Until then the page should not assert pure processor status.
- Proposed processors sentence: "Stripe manages subscriptions: if you upgrade, it receives your email address and internal account identifier from us and holds your plan status. The card and billing details you enter on Stripe's own pages are collected by Stripe directly, and what Stripe does with data for its own purposes is described in Stripe's own privacy policy."
- Link Stripe's privacy policy URL at that sentence, after the owner has opened and checked it.
- Change the "Why we process it" sentence to: "...and nothing is sold. Apart from what Stripe's own privacy policy describes for payments, no data is shared with anyone for their own purposes."

**[MAJOR] P3. The third-country transfer is understated, and no safeguard is named.**
- The page says Stripe holds data "on its own infrastructure, which includes the United States".
- This is weaker than the OpenRouter section, which says plainly "transferred to the United States". A reader could take "includes" to mean the data might stay in the EU.
- Art. 13(1)(f) requires stating that a transfer happens and the safeguard it relies on (adequacy decision, or SCCs).
- My understanding is that Stripe relies on the EU-US Data Privacy Framework and/or SCCs. That has NOT been verified for this account, and per the brief it must not be invented on the page.
- Proposed wording now: "...holds your plan status. Stripe is a US company group, and this data is transferred to and processed in the United States."
- Once the owner has verified the DPA: add "...on the basis of [the safeguard named in Stripe's data processing terms]".
- Same gap, out of scope: the OpenRouter/Anthropic/OpenAI/Google transfer paragraph also names no safeguard. Track it in the same fix.
- The legal-counsel flag on the transfer basis applies to both.

**[MAJOR] P4. Stripe's customer record has no erasure path.**
- The page says: "The Stripe customer record itself is not deleted by this app."
- That is honest, but Art. 17 still applies. The operator is the one who sent the email and UUID to Stripe, and the page gives the user no way to get them removed.
- The "Right to erasure" section and the "How long it is kept" section say nothing about Stripe.
- Proposed sentence for the end of the Plans and payment paragraph: "The Stripe customer record itself is not deleted by this app; if you want it removed, contact the operator named in the Impressum and it will be deleted in Stripe for you."
- This does not touch the single-source rule. It names no retention period and sits outside the audit-record ternary.
- The operator must actually be able to do this: deleting a test-mode customer in the Stripe dashboard works.

**[MAJOR] P5. The retention section does not cover the ledger.**
- The page says: "What you create is kept until you remove it or delete your account... Job postings, scans, generated resume versions and the AI usage records are not individually deletable in this version".
- Subscription event rows are not "what you create": Stripe's webhook writes them. They are also deliberately impossible to delete on their own (append-only trigger).
- Proposed: after "...and the AI usage records", add "and subscription event records". Then add: "Subscription event records are written by the payment system rather than by you and are kept, unaltered, until you delete your account — they are the record your plan is derived from."

**[MAJOR, deploy gate, not wording] P6. "That record is deleted with your account" is ahead of its evidence.**
- Is the wording true? Structurally, yes. `user_id uuid not null references auth.users(id) on delete cascade` means no ledger row can outlive its auth.users row. If the trigger refuses the cascade, Postgres rolls back the whole `deleteUser`, so the account survives too.
- So the failure mode is never "the account is gone but the rows stay". It is "Deletion failed" for every user who ever upgraded.
- That breaks a different promise, PRIVACY_ERASURE.lead "Deleting your account removes your account...", for exactly those users.
- My reading of `pg_trigger_depth() < 2` is that it is correct: the RI cascade trigger is at depth 1, and the BEFORE trigger it fires on subscription_events is at depth 2. That is still a configured mechanism, not a witnessed one.
- docs/eval/erasure-evidence.md has no match for "subscription", "ledger" or "Stripe".
- CLAUDE.md says the ledger cascade is "witnessed in docs/eval/erasure-evidence.md", and that claim is currently untrue.
- Required: keep the page wording, but do not deploy this branch publicly until the Block H item 11 run with ledger rows present is recorded in docs/eval/erasure-evidence.md. Alternatively, list it explicitly as "not done / deferred" in the hand-over, per the No-undeclared-deviations rule.
- The page comment's own reasoning should also mention the rollback point, so the next reader sees the real risk: "if the trigger refuses, deleteUser fails as a whole, so the risk is a failed erasure, never a surviving row."

**[MINOR] P7. Stripe's direct collection is described too narrowly.**
- The page says "card details are entered on Stripe's own pages and never reach CV Insight."
- Stripe's hosted form also collects cardholder name, billing country/postcode and device/IP data.
- Proposed: "card and billing details are entered on Stripe's own pages and never reach CV Insight."
- "and nothing else from this app" is accurate against checkout/route.ts: the only other fields are the price id and the success/cancel URLs, which carry no personal data. I confirm the internal-identifier deviation from SPEC is correct and needed. SPEC's "email address and nothing else" would have been false.
- SPEC.md line 1257 should be amended to match, so SPEC and the page agree. Otherwise this is an undeclared deviation.

**[MINOR] P8. The ledger's data categories are close but incomplete.**
- The page lists "(your plan status and period, Stripe's customer and subscription identifiers)".
- The table also stores the event type, the cancel-at-period-end flag and the time the event was received.
- Proposed: "(the event type and when it arrived, your plan status, period and whether it is set to cancel, and Stripe's customer and subscription identifiers)".

**[MINOR] P9. The Impressum contradicts itself on "paid service".**
- aboutDeployment says: "It has a Free plan and a Pro plan; upgrades go through Stripe in test mode".
- addressRule says: "This deployment offers no paid service and takes no money".
- A page that names a Pro plan, and per SPEC v3.0 shows a price, does offer one. What is true is that it cannot charge for it.
- Proposed addressRule middle sentence: "This deployment cannot take money — its Pro plan runs in Stripe's test mode, where no payment is possible — and its operator's postal address is therefore shown as a marked placeholder rather than published here; it is supplied on request to the email address above."
- aboutDeployment itself is SPEC-verbatim and accurate. stripeClient() refuses any key not prefixed `sk_test_`, so "no real payment is possible" is enforced by code, not by a flag.

**[ESCALATE TO LEGAL] P10. The §5 DDG position.**
- §5 DDG covers digital services offered *geschäftsmäßig*, which is usually but not only against payment.
- The deployment now has open registration, two plans and a displayed price. Whether "no money can move" takes it outside that scope is a legal judgment, not a technical one.
- The page publicly states the rule and states it is not met ("shown as a marked placeholder rather than published here"). That is honest, but it is also a written admission on a public German page. A missing *ladungsfähige Anschrift* is a known risk for formal legal warning letters (Abmahnung) in Germany.
- I am not saying the owner's position is wrong. I am saying a non-lawyer review cannot sign it off.
- Options: (a) counsel confirms the test-mode position, or (b) publish a serviceable address (a c/o or business-address service is a common choice) and retire the placeholder.
- The sk_test_ trigger in copy.ts is correct as the hard backstop.

**[NOTE] P11. The single-source comment is now inaccurate.**
- The erasure-section comment says it is "the ONLY place the page may mention audit records, retention or erasure scope."
- The Plans paragraph, which is SPEC-verbatim, now states erasure scope for the ledger and for Stripe.
- This is acceptable, because the guarded claim is the audit-record PERIOD and that is untouched. The comment should be narrowed to say so, so a later agent does not "fix" the Stripe sentence away.
- I confirm the retention ternary is untouched.

**[NOTE] P12. Deletion copy outside this scope.**
- CLAUDE.md requires deletion copy to name "what goes AND what stays" everywhere.
- The Settings delete dialog, which I did not review, should also say the Stripe customer record stays, and how to get it removed (P4).
- Run the full compliance pass on settings/page.tsx before the PR.

**[NOTE] P13. Before any live mode (not a finding today).**
- Deleting an account leaves any Stripe subscription running. In test mode that costs nothing; in live mode the user would keep being billed. Account deletion must cancel the subscription before live mode.
- German tax law requires invoices to be kept for up to 10 years. That would make "that record is deleted with your account" false for invoices. This needs a legal-counsel review at the same trigger as P10.

**[NOTE] P14. Items checked and found fine.**
- Legal basis Art. 6(1)(b) for plan management: appropriate.
- The data-categories list now includes "a record of each subscription event": matches SPEC.
- PRIVACY_UPDATED = '12 October 2026' is today. I could not diff it against main; confirm it was bumped in this branch, since this branch adds a new recipient.
- Documentation voice: citing GDPR articles and § 5 DDG on legal pages is appropriate, because those pages exist to state legal information. No finding.
- The OpenRouter sentence "not your user id" is scoped to AI requests and stays accurate.

```
/privacy drift:
- "Three service providers" vs four listed (P1)
- "on our behalf and on our instructions" / "nothing ... shared with anyone for their own purposes" vs Stripe's own-purpose processing, unverified (P2)
- "which includes the United States" understates a US transfer; no safeguard named (P3)
- Retention section omits subscription event records (P5)
- Ledger field list incomplete (P8)
- Erasure claim for the ledger structurally true but unwitnessed; erasure-evidence.md has no ledger run (P6)
/impressum drift:
- "offers no paid service" vs "has a Free plan and a Pro plan" (P9)
```

Files referenced:
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\privacy\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\impressum\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts (PRIVACY_ERASURE lines 36–42, PRIVACY_UPDATED line 76, IMPRESSUM lines 112–136)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md (lines 1257, 1278–1287)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\supabase\migrations\006_subscription_events.sql
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\billing\checkout\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\api\account\route.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\stripe\server.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\eval\erasure-evidence.md (no ledger evidence yet)

Per CLAUDE.md, save this report verbatim to docs/reviews/ before acting on it.
