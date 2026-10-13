# Compliance review: feature/go-public (eu-compliance-reviewer, verbatim)

Scope: /signup, /login, /impressum and README.md. Run 2026-10-13 on the
uncommitted working tree of `feature/go-public`. Saved verbatim.

---

VERDICT: ESCALATE TO LEGAL (plus ACTION NEEDED on the engineering items)

Scope check: I read every file in scope. /signup and /login are server pages. The shared form is `src/components/auth-form.tsx`. Both render inside `src/app/(auth)/layout.tsx`, which is the only other file under `src/app/(auth)/` (three files in total), so I read it too as the surface that carries the footer. I also read `src/app/impressum/page.tsx`, the IMPRESSUM block and its docblock in `src/lib/copy.ts` (lines 81-142), README.md in full, and SPEC lines 1-3, 1160-1166 and 1311-1340.

I also opened a few files only to check claims README makes: `/privacy` (lines 172-219 plus a grep), `DEMO_NOTICE` (copy.ts:47-69), `docs/eval/erasure-evidence.md` (grep), `docs/backlog.md` (eu-8, gp-1/2, F2), `scripts/check.mjs` (the DAL list), `package.json`/`src` (an analytics grep) and the prior report F2.

I did not read WORKLOG.md or any .env* file. This is an engineering review, not legal advice.

New data flows: none in code. The surfaces collect the same data as before (email and password through Supabase Auth). What changes is the audience: unknown members of the public instead of invitees. Email ownership is not verified, because confirm-email is OFF.

Findings:

1. [MAJOR, ESCALATE TO LEGAL] The § 5 DDG address position goes public without counsel's answer, and the page states the rule it does not meet.
   - Files: `src/lib/copy.ts:141` (addressRule), `:121` (heading), `:110-114` (docblock); `README.md:737-738`; `docs/backlog.md:287-292`.
   - Prior F2(b) asked for counsel to confirm the address omission "before the go-public branch opens registration". The backlog itself says registration opening "is when the reviewer asked for it to be answered". This branch opens registration with F2 still open. copy.ts:113 records an owner decision that "Registration being open is not a trigger".
   - F2(a), the engineering half, is also undone. The rendered sentence still reads "A publicly offered service in Germany must publish an address at which its operator can be served (§ 5 DDG)". The deployment is now publicly offered, so on a world-readable page it states a rule and then says it is not met. The heading "Angaben gemäß § 5 DDG" claims the block is the § 5 disclosure.
   - SPEC:1340 (read in scope) still says "The day the deployment becomes public or commercial, name + email is no longer sufficient". That contradicts copy.ts:113. If a later SPEC decision supersedes it, nothing at 1340 says so.
   - Required changes:
     - (a) Drop the paraphrase of the statute in addressRule and state only the operator's position, as F2(a) proposed. Example: "The operator's postal address is not published while this deployment takes no payment; it is supplied on request to the email address above."
     - (b) Get counsel's answer before or alongside the public link. Otherwise the owner should explicitly record that the risk is accepted without counsel, in SPEC as a Decision. Note the risk of warning letters (Abmahnung) for a public German site with no serviceable address (ladungsfähige Anschrift), whether or not money moves.
     - (c) Annotate SPEC:1340 as superseded, with a pointer to the decision that replaced it.

2. [MAJOR] README misstates what the demonstration notice says, and the notice conflicts with /privacy.
   - `README.md:20-21` says "use invented data, not a real resume — the notice on every member screen says why".
   - `README.md:482` says "This is why the demonstration notice asks people not to paste a real resume".
   - `README.md:728` says the eu-8 carry-over holds "only because the demonstration notice asks for invented data".
   - The notice actually reads (`copy.ts:68`): "No other person's real resume or personal details may be uploaded to it — use your own career history, or invented sample data." It allows the user's own real resume, and it gives no reason.
   - `/privacy:182-183` says "please do not paste a real resume or any other real person's details".
   - So the three surfaces give two different instructions, and README's justification for carrying eu-8 (account-level erasure only) rests on wording the notice does not contain. Now that strangers register, the notice is the instruction they actually see.
   - Required change: align `DEMO_NOTICE.body` with /privacy (invented data only, ideally with a one-clause reason: the AI provider account is not operated by us). After that, README:20-21, :482 and :728 are true. If the owner prefers to keep "your own career history", rewrite the three README sentences and backlog:135 to match, and reassess eu-8 and finding 3, because real personal data is then expressly invited.

3. [MAJOR, ESCALATE TO LEGAL] The processor chain for the model provider is unchanged, but it now reaches the public.
   - Files: `README.md:476-487`; context in backlog gp-2/eu-2.
   - The OpenRouter account belongs to another party, so the controller has no processing contract with OpenRouter and cannot verify its retention or training settings. README states this honestly.
   - Opening registration means real data from people the operator does not know is now foreseeable, whatever any notice says. Registration is a self-serve form, and the notice is not shown until after sign-up.
   - Two questions need counsel: whether a disclosure plus a "do not paste real data" instruction is an adequate position under Art. 28 (a processor engaged through a third party's account with no contract with the controller) and Art. 44 et seq. (US transfer) for a public service. An engineering review cannot sign off on either.
   - Required change: put the question to counsel together with F2, or record an owner risk-acceptance Decision for the go-public round. The engineering mitigation stays as planned: an operator-owned key with a recorded verification.

4. [MINOR] At the point of collection on /signup, the privacy information is reachable but not adjacent to the form, and the demonstration notice is not there.
   - Files: `src/app/(auth)/signup/page.tsx:25-37`; `src/app/(auth)/layout.tsx:29-36`; `src/app/(app)/layout.tsx:59`.
   - The (auth) layout footer links Privacy and Impressum on /signup and /login. In my engineering view that satisfies a layered Art. 13 approach. There is no consent claim anywhere on these surfaces (grep found no "agree"/"consent"/"accept" copy), which is correct for an Art. 6(1)(b) basis.
   - Two gaps remain. The footer sits outside the 400 px card and is small (text-xs). And `DEMO_NOTICE` renders only on the authenticated shell, while README's live link sends strangers straight to /signup.
   - Required change: add one line inside the card on /signup, with no consent wording, e.g. "Your email is used only to run your account. How CV Insight handles personal data: Privacy." Also render `DEMO_NOTICE` (as aligned in finding 2) on /signup, or in the (auth) layout, so a stranger reads it before creating an account.

5. [MINOR] README invites registration with "any address", and email ownership is never checked.
   - File: `README.md:19-20` ("sign up with any address, no confirmation mail is sent").
   - With confirm-email OFF, an account can be opened under someone else's email. That person's address is then stored, appears in the auth audit log for 90 days, and is sent to Stripe if the account upgrades.
   - Related: README:751 says "the account can still be deleted by the operator on request". For an unverified address, the operator needs some identity check before acting on such a request (Art. 12(6)).
   - Required change: replace "any address" with wording that does not invite third-party addresses. Either "your own email address (it is not verified)" or, if the intent is privacy-preserving, "an address you control, or a throwaway one". Add an internal note in docs/ on how a deletion request for an unverified account is authenticated, e.g. a reply from that mailbox.

6. [MINOR] False statement in README: "eight DAL files".
   - File: `README.md:326`.
   - The R1/R2 row says `.from(` and `.rpc(` are allowed "only inside the eight DAL files". `scripts/check.mjs:93-101` lists nine, including `subscriptionEvents.ts`, and README:373 says "all nine owner-scoped tables".
   - Required change: "nine".

7. [MINOR] The SPEC copy of the Impressum lags the shipped text (the F1 fix).
   - SPEC:1334 still says "This deployment offers no paid service and takes no money". `copy.ts:141` ships "This deployment cannot take money — its Pro plan runs in Stripe's test mode, where no payment is possible".
   - The shipped text is the correct one, since a Pro plan exists, but SPEC labels its block "Copy, verbatim" (SPEC:1315).
   - Required change: update SPEC:1334 to the as-built sentence, or annotate it as superseded by the F1 fix.

8. [NOTE] Answer to Q2: F1 is resolved, and the Impressum is otherwise consistent with a public deployment.
   - aboutDeployment (`copy.ts:139`) and addressRule (`copy.ts:141`) now rest on one reason: Stripe test mode, so no payment is possible.
   - Name, a mailto contact and the link to /privacy render, and `IMPRESSUM_FILLED = true`.
   - The remaining problems are F2 (finding 1). As the prior report also said, the operator should confirm with a real test message that the inbox at `IMPRESSUM.email` is read and that the address can actually be supplied on request.
   - The unfilled branch (`copy.ts:125`) is unreachable while the switch is true. It is harmless.

9. [NOTE] README:479-481 is precise but could mislead.
   - It says "no account identifier travels with them — not the email address, not the user id…".
   - That is literally accurate (no `user` field in `src/lib/openrouter/server.ts`), but per CLAUDE.md the saved display name does reach the provider in the P2/P3 prompts.
   - Suggested change: add "the display name you save does, for the resume's name line".

Answers to Q3 (README claims checked against code):
- No analytics: confirmed. No analytics, telemetry or Sentry dependency in package.json. No localStorage, sessionStorage, document.cookie or font-CDN use in `src` (comment mentions only). The Speed Insights caveat at README:465-474 is honest.
- Stripe: the README limitation at :763-766 matches `/privacy:214-216`.
- Erasure: the evidence exists at `docs/eval/erasure-evidence.md:124ff`, "v3.0 re-run — the billing ledger (2026-10-12)", VERIFIED, which matches README:454-457.
- Provider caveat: accurate, apart from findings 2, 3 and 9.
- Cost fence (README:421-434): consistent with SPEC Decision v3.0c and backlog gp-1/gp-2.

/privacy drift: not reviewed (out of scope). Cross-check only: /privacy:182 and DEMO_NOTICE (copy.ts:68) contradict each other on whether the user's own real resume may be pasted (see finding 2).

Relevant paths:
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\impressum\page.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(auth)\signup\page.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(auth)\login\page.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\(auth)\layout.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\auth-form.tsx
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\README.md
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md (lines 1334, 1340)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\backlog.md (lines 133-138, 287-292)
- d:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\reviews\compliance-and-docs-eu-compliance.md (F2)

Per CLAUDE.md, save this report verbatim to docs/reviews/ before acting on it.
