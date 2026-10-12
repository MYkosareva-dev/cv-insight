# eu-compliance-reviewer — scoped review, `feature/compliance-and-docs`

Run once, scoped to the /impressum page diff and the README changes only (owner
instruction). Report reproduced verbatim below.

---

eu-compliance-reviewer: scoped review of `feature/compliance-and-docs` (/impressum and README)

**Scope and method.** This run had Read, Grep and Glob only, with no shell. I could not run `git diff main...feature/compliance-and-docs`. I reviewed the current working tree of every in-scope file instead:
- `src/app/impressum/page.tsx`
- `src/lib/copy.ts:78-136` (the IMPRESSUM and IMPRESSUM_FILLED block only; the RESULT.aiGeneratedLine hunk was ignored)
- `tests/unit/impressum.test.mjs`
- `README.md`, in full, with attention to the sections the two README commits touch: "How this codebase is built", "Not built" / "Specified in SPEC v3.0", the GDPR posture bullet and the Impressum limitation

I read the following as context:
- SPEC.md:1259-1287
- CLAUDE.md (Privacy, Documentation voice)
- `docs/reviews/compliance-and-docs-architect-plan.md`

For verification I also grepped `src/` for Stripe/plan wording, `.claude/` agent descriptions and `docs/reviews/full-review-*` headers, `package.json` for the test glob, and `/privacy` for Impressum references. I did not read WORKLOG.md or any `.env*` file.

The working tree has `IMPRESSUM.email` filled (`copy.ts:117`, uncommitted, git status `M src/lib/copy.ts`). As instructed, I did not treat the email value as a finding. With it filled, the `[[` guard now passes.

This is a legal-adjacent engineering review, not legal advice. One item below (F2) is explicitly for real legal counsel.

```
VERDICT: ACTION NEEDED
New data flows: none. The page is static, sets no cookie, loads no script and adds no processor. The only personal data it adds is the operator's own name and contact email, published by the operator on purpose. README adds no flow.
Findings: 0 BLOCKER, 0 MAJOR, 5 MINOR, 4 NOTE (below)
/privacy drift: out of scope for this run. One cross-check: /privacy points readers to the Impressum for the controller's identity (`src/app/privacy/page.tsx:34-39`, `:280`, `:309-311`), which makes /impressum the page that satisfies Art. 13(1)(a) in practice. See F2 and N1.
```

## Findings

**F1 [MINOR] The two "About this deployment" paragraphs rest on two different exemption theories.**
- `src/lib/copy.ts:133` (rendered at `page.tsx:60`): "It is **not offered as a service**, no payment is taken for it …"
- `src/lib/copy.ts:135` (rendered at `page.tsx:61`): "A **publicly offered service** in Germany must publish an address … This deployment **offers no paid service** and takes no money …"
- The first says the deployment is not a service at all. The second implies it is a service, just an unpaid one, and grounds the missing address on non-payment alone.
- A reader, or a competitor's lawyer, sees the operator claiming both "§5 does not reach me because I am not a service" and "§5 reaches services, and mine is free". Each is arguable alone; side by side they look like a hedge.
- The cause is the deferral: the pre-v3.0 `nonCommercial` sentence was written for the closed-demo theory (SPEC:1286), and `addressRule` was written for the v3.0 "public but takes no money" theory (SPEC:1287).
- Required change: pick one theory for the interim period and make both sentences agree with it. With registration closed today, the closed-demo theory is the true one. The smallest edit is in `addressRule`: replace "offers no paid service and takes no money" with wording that matches `nonCommercial`, such as "is not offered as a service and takes no money".
- `addressRule` is marked verbatim in SPEC:1280, so this needs an owner decision and a `> Decision:` line in SPEC. It cannot be a silent edit. Alternatively, accept the tension and record that it resolves when billing lands with the v3.0 first sentence.

**F2 [MINOR, needs legal counsel before registration opens] The page paraphrases § 5 DDG inaccurately, and the address omission depends on that paraphrase.**
- `copy.ts:135` states the rule as "A publicly offered service in Germany must publish an address at which its operator can be served (§ 5 DDG)."
- § 5 DDG actually covers *geschäftsmäßige, in der Regel gegen Entgelt angebotene digitale Dienste* (business-like services of a kind normally provided for payment). The test is neither "publicly offered" nor whether *this* deployment takes money. "In der Regel gegen Entgelt" is commonly read as describing the *type* of service, and "geschäftsmäßig" is commonly read broadly.
- So "takes no money, therefore no address" is a legal argument, not a statement of the rule. The page currently presents it as a consequence of the rule.
- The heading `Angaben gemäß § 5 DDG` (`copy.ts:115`, `page.tsx:25`) claims the block *is* the § 5 disclosure, while the paragraph below says it does not meet § 5. Honest, but self-contradictory as a heading.
- Engineering view:
  - While registration is closed and the link goes to named people, the exposure is low. The closed-demo reasoning at SPEC:1286 is the stronger of the two theories.
  - SPEC v3.0 (SPEC:1287, `copy.ts:107-108`, `README.md:660-661`) drops the "public or commercial" trigger and keeps only the `sk_test_` trigger. Once registration opens, the risk rises: a public site run by a natural person in Germany with no *ladungsfähige Anschrift* (an address where legal papers can be served) is a common target of warning letters (Abmahnungen), whether or not money moves.
- Required change:
  - (a) Engineering, now: stop restating the statute. Cite § 5 DDG and state only the operator's position, e.g. "The operator's postal address is not published while this deployment takes no payment; it is supplied on request …". Or quote the statutory criteria accurately.
  - (b) Legal: have real counsel confirm the address-omission position before the go-public branch opens registration, not when the Stripe key goes live. Until that is done, I recommend restoring "the deployment becomes public" as a second trigger beside the `sk_test_` one in `copy.ts:107-108` and README:660-661. That is an owner/SPEC decision.

**F3 [MINOR] The guard has a gap: it only catches `[[`.**
- `tests/unit/impressum.test.mjs:20-26` runs under `npm test` (`package.json:12` glob `tests/unit/*.test.mjs`) and therefore under `prebuild` and CI. The coverage is real.
- But with `IMPRESSUM_FILLED = true` it would pass all of these:
  - an empty `email` or `operatorName`
  - a single-bracket placeholder such as `[owner email]`
  - `TODO`
  - a malformed address, which would render as a dead `mailto:` (`page.tsx:33`)
- The test's own header says a placeholder email would be "a `mailto:` link to nobody". The current check does not fully enforce that.
- Required change: inside the `if (IMPRESSUM_FILLED)` branch, add:
  - `assert.match(IMPRESSUM.email, /^[^\s@\[\]]+@[^\s@\[\]]+\.[^\s@\[\]]+$/)`
  - `assert.ok(IMPRESSUM.operatorName.trim().length > 0 && !IMPRESSUM.operatorName.includes('['))`
- The address-placeholder test (`:28-30`) is adequate.

**F4 [MINOR] README states the address trigger in terms of a Stripe key that does not exist yet.**
- `README.md:660-662`: "The day the Stripe key is not a test key, the placeholder is a defect…" (same at `copy.ts:107-108`).
- `README.md:689-692` says Stripe is not built, and I found no Stripe code in `src/` (only comments in `copy.ts`).
- The rendered page uses the accurate, technology-neutral form: "Before any deployment that can take a payment" (`copy.ts:135`).
- Required change: lead README:660 with the rendered condition ("before any deployment that can take a payment, the address goes in first"), and give the `sk_test_` check as how that will be detected once billing exists. If the owner accepts F2(b), add the go-public trigger here too.

**F5 [MINOR, process] The deferred v3.0 sentence is recorded only in a review file, not in SPEC.**
- SPEC:1261 and SPEC:1270 say the v3.0 copy is "the text that renders from v3.0". SPEC:1278 marks the "Free plan and a Pro plan … Stripe" sentence verbatim.
- The code ships the pre-v3.0 `nonCommercial` sentence (`copy.ts:132-133`), with the reason only in a code comment (`copy.ts:126-131`) and in `docs/reviews/compliance-and-docs-architect-plan.md` finding 1. That finding itself lists interim copy as a "Deviation needing a SPEC/CLAUDE amendment".
- Shipping the old sentence is the correct compliance outcome: the v3.0 sentence would be false today. But CLAUDE.md ("No undeclared deviations") requires it either in SPEC as a `> Decision:` or under "not done / deferred" in this branch's hand-over.
- Required change: confirm the hand-over lists it. Better, add one `> Decision:` line under SPEC:1278 so the next agent reading SPEC does not "fix" the page to the false v3.0 text.
- I could not verify by diff that `copy.ts:133` matches the pre-v3.0 SPEC text word for word. Please check `git show main:src/lib/copy.ts`.

## Notes

**N1 [NOTE] Art. 13(1)(a) GDPR.**
- Name plus a working email meets "identity and contact details of the controller" for this audience, in my engineering view. Some supervisory-authority guidance and commentary expect a postal address as part of the controller's contact details. Bring this to counsel together with F2.
- Contactability depends on the mailbox being read. Per CLAUDE.md, a configured mechanism is not a working one: the owner should confirm that a test mail to `IMPRESSUM.email` arrives and is seen.
- The page promises the address "on request" (`copy.ts:135`). That is an operational commitment the owner must be able to honour.
- The email matches the one already public at `README.md:22`. That is consistent.

**N2 [NOTE] "Responsible for the content".**
- `copy.ts:120`, `page.tsx:39-41`. This label is the § 18(2) MStV concept (V.i.S.d.P., the person responsible for journalistic content). It applies to journalistic-editorial offers and carries its own name-plus-address requirement. It is not a § 5 DDG element.
- It is harmless here, since the same person is named, and it is SPEC-verbatim (SPEC:1273). But it adds nothing for a non-editorial tool and, if anything, invites the address requirement.
- Owner's choice: keep it or drop it. If kept, do not cite MStV.

**N3 [NOTE] Things I checked that are true today (no action needed).**
- "no payment is taken", "carries no advertising" (`copy.ts:133`): consistent with no Stripe code in `src/`, and with README:396-400 (no analytics) and README:689-692.
- "it is supplied on request to the email address above" (`copy.ts:135`): the email does render above it (`page.tsx:30-38`, before `:61`).
- The address slot is a marked placeholder, not an invented street (`copy.ts:124`, test at `:28-30`).
- The unfilled branch (`page.tsx:46-55`) never renders `[[…]]`.
- The page is static: no session, cookie, script or tracker (`page.tsx:7-18`). No TTDSG § 25 impact.
- The README live-deployment bullet (`:17-22`, registration closed, URL not committed) is consistent with the Impressum's not-a-service sentence.
- README:592-595 (GDPR posture, Impressum with a marked-placeholder address) and README:658-662 accurately describe the rendered page, apart from F4.
- README:689-692, "/privacy and /impressum do not describe them": verified. No plan or Stripe wording in any rendered string. The only hits in `src/` are comments at `copy.ts:107` and `:128`.
- The page-file comment no longer carries the stale "Vercel Deployment Protection" note flagged in architect finding 12.

**N4 [NOTE] README "How this codebase is built" (`README.md:548-573`).**
- The stages match each agent's `description:` front matter (`.claude/agents/*.md:3`), including "and once before deploy" for eu-compliance-reviewer.
- The `/full-review` row honestly says the command file is a generic template whose `subagent_type` names are not this repo's agents. That answers architect finding 7.
- One small overstatement at README:573: "which the `docs/reviews/full-review-*` reports name in their headers". Three of the four name the agent (architecture: ai-architect; nextjs-security; supabase-security). `full-review-2026-10-12-code-quality.md:1` reads "AI Code Review" and does not name `ai-code-reviewer`.
- Suggested fix: change README:573 to "three of the four name it in their headers", or add the agent name to that report's header. That is a docs/reviews edit, so leave the verbatim body untouched and add only a header line if the project allows that.

## Files referenced
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\impressum\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts (lines 78-136)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\unit\impressum.test.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\README.md (lines 17-22, 548-573, 592-595, 658-662, 686-692)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\SPEC.md (lines 1259-1287)
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\reviews\compliance-and-docs-architect-plan.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\reviews\full-review-2026-10-12-code-quality.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\privacy\page.tsx (lines 34-39, 280, 309-311; cross-reference only)
