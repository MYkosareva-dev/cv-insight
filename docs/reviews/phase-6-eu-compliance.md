# Phase 6 gate — eu-compliance-reviewer
(date 2026-09-04, commit 949ded8, branch phase-6-deploy — run BEFORE the first deploy)

## Scope and premise

This review is written for the deployment the owner described: a **closed, password-gated demo shared with a handful of named people** (a portfolio reviewer, an examiner, a couple of friends), on the **Vercel Hobby plan**, with Supabase in **EU-Frankfurt** and the operator in Germany. I have written the controller-obligation analysis for that shape of deployment rather than for a public service, and I say so at every point where the two diverge, because they diverge a great deal: Art. 30 records, DPIA thresholds, the §5 DDG Impressum duty and the practical reading of Art. 13/14 all move when the audience is a named, informed set of people rather than the public.

**The premise is contested and I have not resolved it.** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/reviews/phase-6-vercel-security.md:18-47` finds, with moderate-to-high confidence, that Vercel **Password Protection is a paid feature unavailable on Hobby**, and that `src/middleware.ts:12` places `/signup` in `PUBLIC_PATHS` while `src/lib/auth/actions.ts:58` calls `supabase.auth.signUp` with no invite check. If both hold, the deployment is publicly reachable *and* openly registrable — the exact inverse of the owner's premise. I therefore answer in two worlds throughout:

- **World (a) — the gate holds.** Either Password Protection is bought, or (the free, Hobby-compatible route) Supabase registration is closed and the named people are invited. Only named, informed individuals ever hold an account.
- **World (b) — the gate does not hold.** The production URL is public and anyone who learns it can register. This is the default outcome on Hobby if nothing is changed before the first deploy.

Every finding below is labelled with whether it is contingent on that question. **Most are not** — the majority of what is wrong here is wrong in both worlds.

One thing the gate does *not* do in either world: it does not make GDPR inapplicable. The Art. 2(2)(c) household exemption is read narrowly (Lindqvist, Ryneš) and does not cover a portfolio or examination artefact processed for a professional/educational purpose with data subjects outside the household. The owner is a controller. What the gate changes is the *weight* of several obligations, not their existence.

**This is legal-adjacent engineering review, not legal advice, and I am not a law firm.** I have said so once and will now give decisive answers rather than hedge each paragraph. Two items below genuinely need a lawyer and are flagged inline as such: the Art. 28/Chapter V position on the third-party OpenRouter account (eu-2), and the §5 DDG Impressum threshold if the deployment ever becomes public or commercial.

---

## Verdict

**FAIL — do not deploy yet.** 3 BLOCKER, 7 MAJOR, 4 MINOR, 1 NIT.

Two of the three blockers are not judgement calls on my part — **the repository's own documents already say the deployment is not ready.** `SPEC.md:927` makes privacy-page completeness "a hard gate before ANY deployment reachable by anyone but the owner — preview and share URLs included", and none of the five named elements exist on the page. `docs/openrouter-processing.md:122-123` says in its own words: *"Until this section is filled in, the deployment is development-only and no URL is shared outside the owner."* That section still reads `Status: NOT VERIFIED`.

The engineering underneath is, with real emphasis, **excellent**. The contact-header model boundary is enforced by a branded type and the enforcement genuinely holds — I verified every call site. Logging discipline is the best I have seen in a project this size: not one line puts resume, vacancy or profile content into a log or an error message, and the code says *why* at each site. The cascade covers all eight tables. Cookies are strictly necessary and nothing else. There is no analytics package, no third-party font, no tracker, no `localStorage`. What fails here is the **transparency layer and the processor position**, not the data handling.

---

## Findings

### [BLOCKER] eu-1 — `/privacy` is missing every element the project's own pre-deploy gate names

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:11-106` (whole page), against `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/SPEC.md:927`

**What:** SPEC.md:927 states the gate in terms that leave no room:

> Decision (scope): Phase 1 makes /privacy ACCURATE (no false claims, audit-log truth, email listed, reachable) — it is not yet public. COMPLETENESS — **controller identity, legal bases per purpose, retention table, data-subject rights section, and a REAL Impressum** (§5 DDG; a placeholder is abmahnfähig once public) — is a hard gate before ANY deployment reachable by anyone but the owner — preview and share URLs included

The page as it stands has five sections: "What is stored, and where", "Processing by OpenRouter", "Cookies", "Right to erasure", "Impressum". Measured against Art. 13 and against that gate, the following are **entirely absent**:

| Required | Present? |
|---|---|
| Controller identity and contact details (Art. 13(1)(a)) | **No** — `page.tsx:96-98` says `Placeholder — completed in the legal phase.` |
| Purposes **and legal basis** per purpose (Art. 13(1)(c)) | **No** — the words "legal basis", "contract", "legitimate interest" appear nowhere in `src/` |
| Recipients / categories of recipients (Art. 13(1)(e)) | **Partial** — OpenRouter and Supabase named; **Vercel is not named anywhere on the page** |
| Third-country transfer + safeguards (Art. 13(1)(f)) | **No** — see eu-3 |
| Retention periods (Art. 13(2)(a)) | **Partial** — only the 90-day auth audit purge; nothing on how long career items, vacancies, applications, resume versions or `llm_calls` are kept |
| Rights: access, rectification, erasure, restriction, objection, portability (Art. 13(2)(b)) | **Partial** — erasure only |
| Right to lodge a complaint with a supervisory authority (Art. 13(2)(d)) | **No** — this one is a flat omission and is always required |
| Existence of automated decision-making (Art. 13(2)(f)) | **No** — a one-line "the match score is advisory and no decision is made about you" is the right answer here |
| Whether provision is a contractual requirement (Art. 13(2)(e)) | **No** |

**Why it matters:** Art. 13 attaches at collection, and the named recipients in world (a) are data subjects exactly as strangers would be. What the gate genuinely *lightens* is the practical reading: for five people who know what the app is and who built it, a short, plain page is proportionate, and you do not need the twelve-screen boilerplate a public SaaS ships. What it does **not** lighten is the enumerated set above — controller identity, legal basis, transfers, retention, the rights list and the complaint right are not scaled by audience size. A page that omits all of them is not "lightly incomplete", it is missing the substance.

The legal bases here are straightforward and should be stated as such: **Art. 6(1)(b) contract performance** for the account, the career base, scans, generation and export (the user asked for the service and these are how it is delivered); **Art. 6(1)(f) legitimate interest** for the authentication audit records (security of the service — and that one needs the balancing named, briefly); **Art. 6(1)(c) legal obligation** for nothing, because there is nothing. There is **no consent-based processing anywhere in this app**, which is a genuine strength and should be said on the page, not left to be inferred.

**Contingent on the gate?** No. Required in both worlds. World (b) makes it more urgent, not differently required.

**Fix:** Rewrite `/privacy` to cover the nine rows above. Keep the existing sections — they are accurate and well written — and add: a controller block (resolved by the Impressum, see below), a "Why we process it and on what basis" section, a retention statement covering the non-audit data ("kept until you delete the item or your account; there is no separate retention period"), a rights section naming all six rights plus the supervisory-authority complaint right, a transfers section (eu-3), and the third-party-data instruction (eu-7). Do not import a generator's boilerplate — this page's current voice is precise and truthful and that is worth more than length.

---

### [BLOCKER] eu-2 — The OpenRouter account belongs to a third party; there is no Art. 28 processor position, and the project's own record says the deployment must therefore stay development-only

**Where:**
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/openrouter-processing.md:82-86`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/openrouter-processing.md:109-123`
- `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/SPEC.md:927`

**What:** The processing record states, in bold, that the key is not the owner's:

> **Observed on 2026-09-04. NOT FIXABLE BY THIS PROJECT — the key belongs to another party and the owner has no access to that workspace, so the guardrail stands and the CODE moved instead**

And the Verification section, which the same file makes the precondition for exposure:

> ## Verification
>
> Status: NOT VERIFIED
>
> Record the check below before any externally reachable deployment. […] Items 1-3 are unaffected by the v2.23 model change and still need checking against the account: a data-policy or logging setting is a property of the workspace, not of which slug this app requests.
>
> `<PASTE VERIFICATION HERE>`
>
> **Until this section is filled in, the deployment is development-only and no URL is shared outside the owner.**

Items 1-3 are the three that matter for privacy, and none is verified: *"Prompt logging / training on prompts: disabled"*, *"Prompt and completion retention: zero-retention routing where the provider offers it"*, *"No provider allowed that publishes prompts to a public dataset"*. The owner cannot verify them, because item 4's note establishes the owner has no access to the workspace where they are configured.

SPEC.md:927 already drew the conclusion this creates:

> The reference deployment runs on a shared account whose privacy settings are managed by the account holder and processes demo data only. […] **Consequence for the reference deployment: synthetic data only (the fictional persona).**

**Why it matters:** Three distinct problems, and gating fixes none of them.

1. **No Art. 28(3) contract.** A controller may only use a processor under a contract binding the processor on instructions, confidentiality, security, sub-processors, deletion and audit. The owner has no contractual relationship with OpenRouter at all — the account holder does. Whatever DPA OpenRouter offers, it is offered to the account holder, not to this controller. The owner cannot execute one, cannot enforce one and cannot audit against one.
2. **No documented Chapter V transfer basis.** OpenRouter is US-based and routes to OpenAI, Anthropic (via Amazon Bedrock) and Google per `docs/openrouter-processing.md:13-18`. The transfer safeguard would normally live in that same absent DPA (SCCs or a DPF certification). There is nothing to point at.
3. **The account holder is an uncontrolled recipient.** A third party who is not the owner controls the logging, retention and training settings on the pipe every user's CV goes through, and can change them without telling anyone. That is the definition of a processing relationship the controller does not govern.

And the plan directly contradicts the SPEC decision: **named real people pasting their real CVs is not "synthetic data only (the fictional persona)"**. A portfolio reviewer's actual career history is personal data, and the moment one is pasted the constraint the SPEC set for this account is broken.

**This is one of the two items that needs actual legal counsel**, because the answer for a five-person examination demo may well be "acceptable with informed, documented notice to those five people" — but that is a lawyer's call and not mine.

**Contingent on the gate?** No. It is bad in world (a) and catastrophic in world (b), where an unbounded number of strangers' CVs would flow through an account the owner does not control and cannot audit.

**Fix:** Pick one, before deploying.
1. **Best — get your own OpenRouter account.** Fund a key on an account the owner controls, accept OpenRouter's DPA, set retention/training/ZDR explicitly, paste the observed values into the Verification section, flip the status. This resolves eu-2 completely and also removes the guardrail problem that forced the v2.23 model change. It is the only option that makes the deployment defensible with real people's data.
2. **Or hold the line the SPEC already drew:** deploy, and instruct the named recipients in writing that the demo is for the fictional persona's data and that they should not paste their real CV. Then say so *on `/privacy` and on the scan and import screens*, not only in a message. This is weaker, it depends on people obeying an instruction while the product invites the opposite, and I do not recommend it — but it is coherent and it is what the SPEC currently promises.
3. Whichever is chosen, `/privacy` must state plainly that the model-provider account's retention and training settings are (a) verified and what they are, or (b) not under the operator's control. Silence is the one option that is not available.

---

### [BLOCKER] eu-3 — `/privacy` discloses no international transfer and names no recipient beyond OpenRouter and Supabase

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:45-54`

**What:** The entire OpenRouter section reads:

```
Resume and vacancy text are personal data. They are sent to OpenRouter for processing so
the app can parse the posting, score the match, generate a tailored resume and evaluate
it. The name you save in Settings travels with them, because a resume needs a name line
on it. The contact details you may save do not travel with them at all — the section
above says what happens to those instead.
```

What a reader is not told, and what `docs/openrouter-processing.md:13-18` establishes is true:

- OpenRouter is **outside the EU/EEA**, and this is a third-country transfer. The page never says the data leaves the EU. It says the opposite twice — `page.tsx:22` (*"hosted in the EU (Frankfurt)"*) and `copy.ts:39` (*"in our EU database"*) — so a careful reader would reasonably conclude nothing leaves.
- The upstream providers are **OpenAI, Anthropic (via Amazon Bedrock) and Google**. These are sub-processors and at minimum a *category* of recipient must be disclosed.
- **Vercel is not mentioned at all.** The hosting provider terminates every request, processes every byte of resume text in function memory, and keeps infrastructure logs containing IP addresses and request metadata. It is a processor and a recipient, and it is invisible on the page.
- **Function execution region.** `phase-6-vercel-security.md:177-189` (vs-6) establishes that no `preferredRegion` is exported anywhere and that Vercel's default is `iad1` (Washington DC). So on current configuration, **resume text would be processed in the United States on every single request**, while the page tells the reader the data lives in Frankfurt. That is not imprecision; it is the page describing a different system than the one that would run.

**Why it matters:** Art. 13(1)(e) and (f) are the two disclosures that exist specifically so a data subject can evaluate where their data goes and under what protection. A page that names the EU region twice and never mentions a US transfer is the class of drift this gate exists to catch — it is the single most misleading thing on the page, and it is misleading in the direction that flatters the operator.

**Contingent on the gate?** No.

**Fix:**
1. Set the Vercel function region to **Frankfurt (`fra1`)** before the first deploy (vs-6's fix; Settings → Functions → Function Region, then redeploy). This is a two-minute dashboard change that makes the EU-processing statement true rather than aspirational, and vs-6 notes it also buys latency headroom against the `maxDuration` problem.
2. Add a transfers section to `/privacy`: name Vercel as the hosting processor and say infrastructure logs including IP addresses are retained briefly at the hosting provider; name OpenRouter as the model-inference recipient; say plainly that OpenRouter is outside the EU and that it routes to US-based model providers; name the safeguard once eu-2 gives you one to name.
3. Do **not** put the four model slugs on `/privacy`. They changed twice in two SPEC revisions (v2.22, v2.23) and a slug on a legal page is a maintenance trap that will drift within a month. Name the *category* — "US-based model providers, currently OpenAI, Anthropic and Google" — and, if you want precision, link to `docs/openrouter-processing.md:13-18`, which is already accurate, already dated, and already the single source of that table.

---

### [MAJOR] eu-4 — The gate is the load-bearing assumption of this entire report, and on current configuration it does not exist

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/middleware.ts:12`

```ts
const PUBLIC_PATHS = ['/login', '/signup', '/privacy'];
```

**What:** I defer to vs-1 on the Vercel plan facts and will not re-litigate them. What I add is the compliance consequence, and what "load-bearing" has to mean.

**In world (a)**, these obligations are materially lightened:
- **Art. 30 records of processing.** The Art. 30(5) exemption (under 250 employees) survives if processing is *occasional* and not high-risk. A handful of named people using a demo is plausibly occasional. **But** resumes routinely disclose health, religion, trade-union membership and ethnic origin incidentally, which pushes toward the special-category limb. My advice: write the one-page record anyway. Eighty percent of it already exists across `/privacy` and `docs/openrouter-processing.md`; it costs an hour and it removes the argument.
- **DPIA (Art. 35).** Not required. No large-scale processing, no systematic monitoring, no automated decision with legal or similarly significant effect, a closed and tiny data subject population. Do not build one.
- **§5 DDG Impressum.** Very likely does not attach — see the Impressum section below.
- **Art. 13 practicalities.** You may rely on the recipients already knowing what the app is and who you are. The enumerated content of eu-1 is still required; the length and formality are not.
- **Art. 14 (data about people who are not the user).** The disproportionate-effort exemption at Art. 14(5)(b) is comfortable here, *provided* the "submit only your own data" instruction of eu-7 is actually on the page.

**In world (b)**, every one of those flips: Art. 30(5)'s "occasional" limb is lost once processing is continuous and open-ended; the §5 DDG argument weakens sharply; Art. 13 must be read as a public notice; and the SPEC's synthetic-data-only constraint (eu-2) is violated by the first stranger who signs up.

**Why it matters:** The compliance posture the owner described is the premise of half this report. If it is not real, the report's lightened conclusions are not real either.

**Contingent on the gate?** This finding *is* the gate.

**Fix — what makes the gate load-bearing.** Vercel Password Protection, if bought, is a second layer and **not a substitute**, because the app's own `/signup` is what admits accounts. The control that matters is at the identity provider:
1. Supabase Dashboard → Authentication → Providers → Email → turn **off** "Allow new users to sign up". Invite each named person via Authentication → Users → Invite user.
2. Attempt to register a throwaway address **on the live URL, in incognito, after deploying**. It must be refused. This is the verification step; without it you have a configured mechanism, not a working one.
3. Record that attempt — the request and the refusal — in `docs/eval/`, in the same shape as `docs/eval/audit-retention-evidence.md`. The owner's compliance posture rests on this fact, so the fact needs evidence, and this repository already has the convention for that.
4. Re-check it after **any** Supabase auth configuration change. The setting is a dashboard toggle nothing in the repository can enforce.
5. If the gate is later removed for any reason, this report's world-(a) conclusions lapse and eu-1, eu-2 and eu-7 all escalate.

---

### [MAJOR] eu-5 — `/privacy`'s contact-details paragraph is true as written but creates a materially misleading impression

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:31-42`, against `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/lib/prompts.ts:270-285`

**What:** First, the good news, because this claim is the one the scope asked me to verify hardest and it **holds completely**. The page says:

> They are **not** sent to the AI provider: the header is added to your resume after it has been written and checked, and it is removed again before any text is sent for a quality check or a re-score.

I verified this end to end and it is true:
- `src/lib/tailoring.ts:358-378` — `generateTailoredResume` calls `runGenerateWithJudge` first and applies `withHeader` to the returned drafts. The header goes on **after** both judge calls, not before.
- `src/lib/tailoring.ts:489` — the judge path routes through `resumeTextForModel` even where the text provably cannot carry a header yet, deliberately, so the guarantee survives a future reordering.
- `src/app/api/applications/[id]/judge/route.ts:140` and `src/app/api/applications/[id]/rescore/route.ts:115` — both strip.
- `src/lib/coverage.ts:175` — the re-score corpus parameter is typed `content: ModelResumeText`.
- `src/lib/resumeHeader.ts:290-316` — `ModelResumeText` is a branded type whose only producer is `resumeTextForModel`. There is no other cast and no escape hatch. **A call site that skips the strip does not compile.** The claim is enforced by the compiler exactly as advertised.

Now the problem. `src/lib/prompts.ts:285` is the import prompt, and its only slot is the whole document:

```
<resume>{{resumeText}}</resume>
```

A user who imports their CV PDF sends **the entire extracted text — including the real name, email address, phone number and postal address printed in its header** — to OpenRouter for splitting into career items. `src/lib/resumeHeader.ts:249-258` states this limitation with admirable honesty:

> What it does NOT do is redact a value that also appears inside a sentence […] The claim is therefore exact: the app stops ADDING contact details to a model payload. It does not, and cannot, promise that a city name the user wrote into their own history will not appear in one.

That caveat exists in a source comment and appears **nowhere on `/privacy`**. The page's bolded **not** sent, read next to the OpenRouter section, tells a user their contact details do not reach the AI provider. For anyone who used the import feature, that is the opposite of what happened.

**Why it matters:** Art. 5(1)(a) transparency is about the impression created, not the literal defensibility of each sentence. This one is literally defensible and practically misleading, and the code's own author already wrote the sentence that fixes it.

**Contingent on the gate?** No.

**Fix:** One sentence, adapted from the comment the code already contains: *"This applies to the contact details you save in Settings. If you import a resume PDF or paste resume text, that text is sent to the AI provider exactly as you supplied it — including any name, address, phone number or email printed inside it."* Consider putting a shortened version next to the import control as well, where the decision is actually made.

---

### [MAJOR] eu-6 — `docs/openrouter-processing.md` lists a data item as sent to model providers that is never sent

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/docs/openrouter-processing.md:37-40`

**What:** The "What is sent" paragraph reads:

> Sent: vacancy text as pasted by the user; career-item content or the resume text the user supplied for the scan; generated resume text on the judge and re-score paths; the display name saved in Settings, because a resume carries a name line; **the target role label**; the prompt template.

The target role label is not sent to any model. The complete inventory of prompt slots is:

```
prompts.ts:87   {{vacancyText}}
prompts.ts:92,155,164,208   {{candidateName}}
prompts.ts:156,220   {{parsedRequirementsJson}}
prompts.ts:157,221   {{retrievedChunksJson}}
prompts.ts:158,227   {{revisionFeedbackBlock}}
prompts.ts:219,285   {{resumeText}}
```

There is no target-role slot. `grep -rn "targetRole\|target_role"` across `src/` returns only validation, storage (`src/app/api/career/items/route.ts:98`), the import dialog and the provenance label `src/lib/copy.ts:355-356`. It is stored and rendered; it never leaves.

**Why it matters:** This is drift in the safe direction — the document over-declares — but it is drift in the **one document a reviewer, an examiner or a supervisory authority would read to establish what leaves the deployment**, and `/privacy` is silent on the point, so the two records disagree with each other and one of them disagrees with the code. Under this project's own rule that a stale annotation is an instruction to the next agent to do the wrong thing, an over-declaration here invites someone to "restore" a transfer that was never designed.

**Contingent on the gate?** No.

**Fix:** Delete `the target role label;` from `docs/openrouter-processing.md:40`. Optionally add it to the "Not sent" list, where its absence is a design property worth recording.

---

### [MAJOR] eu-7 — No "submit only your own data" instruction anywhere, contrary to the project's own edge-case decision

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx` (absent), against `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/SPEC.md:1255`

**What:** SPEC Block G, edge case G3:

> | G3 | Third-party resume pasted by the user (someone else's personal data) → out of app control; **/privacy instructs to submit only own data.** > Decision: no automated PII detection in MVP |

`/privacy` contains no such instruction. `grep -i "your own\|only your"` against the page returns nothing.

**Why it matters:** Users will put other people's data into this app, and not only by pasting someone else's CV. A job posting routinely carries a named recruiter and their contact details, and `applications.notes` (`supabase/migrations/001_init.sql:57`, up to 2,000 characters, surfaced in the UI) is exactly where someone writes *"spoke to Anna Weber, she said…"*. That is third-party personal data with no notice to the third party.

The **Art. 14(5)(b)** disproportionate-effort exemption is the right answer for a demo of this size, and in world (a) it is comfortable. But it is an exemption from *notifying the third party*, not a licence to be silent to the user — the instruction is what makes the user, rather than the operator, the party who decided to introduce that data, and it is the sentence the SPEC already committed to writing. The decision to have no automated PII detection in the MVP is fine and correctly documented; it makes the instruction more load-bearing, not less.

**Contingent on the gate?** Partially. In world (a) the exposure is bounded to a handful of people's paste habits. In world (b) it is unbounded and the instruction becomes the only control that exists.

**Fix:** Add to `/privacy`: *"Submit only your own data. Do not paste other people's resumes, and avoid putting other people's names or contact details into job postings, notes or career items. The app does not detect personal data belonging to others and cannot remove it for you."* Consider a shorter form near the notes field and the paste tab.

---

### [MAJOR] eu-8 — There is no way to erase individual records; erasure is all-or-nothing, and `/privacy` does not say so

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/supabase/migrations/001_init.sql:97-101`, and the RLS matrix in `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/CLAUDE.md`

**What:** The policy matrix is deliberately least-privilege, and the absent policies are documented as intentional:

```
-- RLS: owner-scoped, LEAST-PRIVILEGE. Absent policies are deliberate (CLAUDE.md
-- "Data access rules"): documents has no UPDATE (re-embed = delete-then-insert);
-- resume_versions and llm_calls are append-only (no UPDATE/DELETE);
-- vacancies/applications have no user DELETE in MVP (erasure = account deletion;
-- FK cascades are not blocked by RLS).
```

So a signed-in user can delete **career items only**. They cannot delete a vacancy, an application, a generated resume version, an import record or an LLM-call row. The only erasure path is deleting the entire account.

Concretely: a user who pastes a job posting containing a recruiter's name and phone number, or writes a colleague's name into `applications.notes`, has no way to remove it short of destroying their whole career base. That is the eu-7 scenario meeting a schema with no exit.

**Why it matters:** Art. 17 is a right to erasure of *personal data*, not a right to close an account. Where processing rests on Art. 6(1)(b), Art. 17(1)(a) — data no longer necessary for the purpose — is squarely available for a scan the user has finished with. "Delete everything or nothing" is not a satisfaction of that right, and it is also poor data minimisation: applications accumulate indefinitely with no retention limit and no pruning.

I am rating this MAJOR rather than BLOCKER because the design is deliberate, documented, and defensible as an MVP constraint for a closed demo — and because CLAUDE.md correctly requires an owner amendment before a policy is added, which is not something a review agent should do unilaterally. What is *not* defensible is that `/privacy` describes the erasure story as though it were complete.

**Contingent on the gate?** No, though the volume of affected data is far smaller in world (a).

**Fix:** Two options, and the first is free.
1. **Disclose it now.** Add to the erasure section: *"You can edit or delete individual career items at any time. Scans, job postings, generated resume versions and usage records cannot be deleted individually in this version — deleting your account removes all of them. If you need a specific record removed, contact us at the address in the Impressum."* An operator-executed manual deletion on request is a legitimate way to satisfy Art. 17 at this scale.
2. **Backlog:** a delete path for `applications` (cascading to `resume_versions` via the existing FK). That needs an owner amendment to CLAUDE.md's RLS matrix and is not a pre-deploy change.

Note that `llm_calls` and `resume_versions` being append-only is *correct* and I am not asking for it to change. An append-only audit log holding metadata only is proportionate under Art. 6(1)(f), and both cascade cleanly on account deletion — I verified every one of the eight FKs.

---

### [MAJOR] eu-9 — The erasure promise on a public page has no test evidence behind it

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/tests/e2e/` — `privacy.spec.ts` does not exist

**What:** CLAUDE.md's Privacy section states: *"Right to erasure: Settings → delete account removes the auth user and all owned rows (**verified by test**)."* SPEC Block H item 3 (`SPEC.md:1264`) names `privacy.spec.ts` — *"(user B gets 404 on user A's application id — cross-user privacy bonus; delete-account leaves 0 owned rows)"* — and SPEC.md:1253 says *"Playwright asserts 0 rows remain"*. A glob of `tests/` returns `auth.spec.ts`, `career.spec.ts`, `scan.spec.ts`, `generate.spec.ts` and fourteen unit tests. **There is no `privacy.spec.ts`.** SPEC's repository layout places it in Phase 7 — i.e. after this deploy.

To be fair to the implementation, I verified the cascade **statically and it is complete**. All eight tables carry `references auth.users(id) on delete cascade`: `career_items` (001:7), `documents` (001:23), `vacancies` (001:38), `applications` (001:50), `resume_versions` (001:68), `llm_calls` (001:80), `imports` (003:15), `profiles` (004:48). `src/app/api/account/route.ts:62` calls `deleteUser(userId)` with no second argument, so `shouldSoftDelete` defaults to false — the docblock at lines 22-24 explains precisely why a soft delete would turn erasure into a no-op. The design is right.

**Why it matters:** CLAUDE.md's own rule — *"A configured mechanism is not a working one […] a user-facing promise may not ship ahead of that evidence"* — applies to this promise more directly than to almost anything else in the repository, because `/privacy` is where the promise is *made to the data subject*. It is the same shape as vs-3 (the dev-route fence with a `NOT VERIFIED` evidence file) and as the audit-retention gate, which this project solved well: `docs/eval/audit-retention-evidence.md` carries a real succeeded run and `AUDIT_RETENTION_VERIFIED` at `src/lib/copy.ts:29` is `true` on the strength of it. Erasure has the promise without the equivalent proof.

**Contingent on the gate?** No.

**Fix:** Before deploying, run the deletion once by hand against the real project: create a throwaway account, create at least one row in each of the eight tables (a career item, an import, a scan, a generated version, a profile with contacts), delete the account, then query each table for that `user_id` in the SQL editor and confirm zero rows. Paste the queries and results into `docs/eval/` in the same shape as the audit-retention evidence. That is an hour and it converts the page's strongest promise from a design claim into a verified one. `privacy.spec.ts` in Phase 7 then automates what you have already proven.

---

### [MAJOR] eu-10 — Function region defaults to the US while the page says the data is in Frankfurt

**Where:** platform configuration — no file. `grep -rn "export const preferredRegion" src/` returns nothing (confirmed independently; also vs-6).

**What:** vs-6 flagged the technical fact and explicitly deferred the legal characterisation to this gate: *"Whether that matters legally is the eu-compliance reviewer's call, not mine."*

**Here is the call.** Storage location and processing location are distinct, and both are disclosable. A US-region function processing EU personal data is a **transfer to a third country under Chapter V**, not merely a latency choice — the data is transmitted to and processed on infrastructure in the US on every request. It would need a transfer basis (Vercel's DPA and its SCCs/DPF position would supply one, but only if you have accepted the DPA and can say so). More immediately, it makes two statements on `/privacy` and one in `src/lib/copy.ts:39` inaccurate as a description of the system: `page.tsx:22` says the database is *"hosted in the EU (Frankfurt)"* — true — while the code that reads and writes it would run in Virginia, which the page never mentions.

Unlike eu-2, **this one is trivially fixable and should simply be fixed rather than disclosed.** There is no reason for these functions to run in the US: the database, the operator and every intended user are in the EU, and vs-6 notes it also buys back roughly 1.4 s of transatlantic latency per scan on a route already fighting the `maxDuration` ceiling. Fixing the region is strictly better than papering over it in the privacy text.

**Contingent on the gate?** No.

**Fix:** Settings → Functions → Function Region → **Frankfurt (`fra1`)**, then redeploy (the setting applies to new deployments). Per vs-6, do not add a `vercel.json` for this — the dashboard setting is sufficient and the repo is deliberately clean of Vercel config. Verify after deploying that the region actually took effect before relying on the EU-processing statement.

---

### [MINOR] eu-11 — Four stored data categories are missing from the "What is stored" list

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:18-23`

**What:** The list is:

> the email address you sign up with, together with your career items, the name and optional target role you give each resume you import, job postings, scans, generated resumes and per-call AI usage metadata

Against the schema, not covered:

| Column | Where | Why it belongs on the list |
|---|---|---|
| `applications.notes` (≤2,000 chars) | `001_init.sql:57` | Free text the user writes about an application. Frequently contains third-party names — the eu-7 vector. |
| `applications.source_resume_text` | `001_init.sql:53` | The full resume text a user pastes or uploads for a scan. "Scans" does not convey that the resume itself is retained. |
| `documents.content` + `embedding` | `001_init.sql:21-28` | A second, derived copy of every career item, chunked, plus its vector. Up to 4,000 rows per user. Derived data is still personal data. |
| `applications.status` | `001_init.sql:56` | `applied / interview / offer / rejected` — a record of the user's job-search outcomes, and arguably the most sensitive inference in the database. |

**Why it matters:** Art. 13's categories-of-data element, and Art. 15's access right, both depend on the user being able to know what exists. The list is otherwise unusually good — it names import run names and target roles, which most privacy pages would not bother with — which makes these four look like oversights rather than choices.

**Contingent on the gate?** No.

**Fix:** Extend the sentence: *"…job postings, the resume text you paste or upload for a scan, your notes and status on each application, a search index built from your career items, generated resumes and per-call AI usage metadata."*

---

### [MINOR] eu-12 — SPEC G2 points at README for the retention decision; README does not contain it

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/README.md` (5 lines), against `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/SPEC.md:1254`

**What:** SPEC Block G, edge case G2:

> | G2 | User asks what leaves the device → /privacy states: Supabase (EU region) storage; resume/vacancy text sent to OpenRouter for processing; **retention decision documented in README** |

README.md in full is a title, a one-line description, and *"Status: in development — see SPEC.md for the full specification."* It contains the word "OpenRouter" once, at line 3, in a stack list. The retention decision is in `docs/openrouter-processing.md`, which is the better home for it — but nothing points there from the entry point of the repository, and SPEC still names README.

**Why it matters:** Small, but this is the pointer a reviewer or examiner follows first, and Block H item 8 makes a full README a deliverable anyway.

**Contingent on the gate?** No.

**Fix:** Either add a "Privacy and data processing" line to README linking `docs/openrouter-processing.md` and `/privacy`, or amend SPEC.md:1254 to name the doc instead of README. The first is better and takes a minute.

---

### [MINOR] eu-13 — No EU AI Act note anywhere in `docs/`

**Where:** repository-wide. `grep -rin "AI Act\|Annex III\|high-risk"` over `*.md`, `*.ts`, `*.tsx`, `*.sql` returns hits only in `.claude/agents/eu-compliance-reviewer.md` — i.e. only in this agent's own definition, not in the project's documentation.

**What:** The classification analysis is in the AI Act section below and the answer is favourable. It is not recorded anywhere a reader would find it, and the classification is not self-evident: an LLM scoring a CV against a job posting *looks* like Annex III(4)(a) at a glance, and the reason it is not is a fact about who the user is, not about what the model does.

**Why it matters:** The next person to touch this — a reviewer, an examiner, a future agent proposing an employer-facing feature — needs the reasoning and the tripwire, not just the conclusion.

**Contingent on the gate?** No.

**Fix:** Add a short `docs/ai-act-note.md` (or a section in the processing doc) carrying the AI Act paragraphs below verbatim, especially the four triggers that would change the answer.

---

### [MINOR] eu-14 — `/privacy` carries no version or last-updated date

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:14`

**What:** The page opens with `<h1>Privacy</h1>` and nothing else. There is no date and no version marker.

**Why it matters:** Not a hard requirement, but a privacy statement that changes over time and cannot be pinned to a date is one a data subject cannot reason about, and one an operator cannot prove the contents of on a given day. It costs one line and this project already versions everything else meticulously.

**Fix:** Add `Last updated: <date>` under the heading. A hardcoded constant in `src/lib/copy.ts`, not `new Date()` — the point is the date the *text* changed, not the date it was rendered.

---

### [NIT] eu-15 — The page ships a section whose body is the word "Placeholder"

**Where:** `d:/Claude BAI/3_sprint/mkosar-AFA.BAI.3.8/src/app/privacy/page.tsx:94-99`

```tsx
<section className="flex flex-col gap-2">
  <h2 className="text-lg font-medium">Impressum</h2>
  <p className="text-muted-foreground text-sm">
    Placeholder — completed in the legal phase.
  </p>
</section>
```

**What:** SPEC.md:927 anticipated exactly this: *"a REAL Impressum (§5 DDG; a placeholder is abmahnfähig once public)"*.

**Why it matters:** Subsumed by eu-1, but worth its own line because it is a distinct failure mode: a heading that announces a legal disclosure followed by an admission that it is absent is worse than the heading not being there. It documents the omission on the page itself.

**Fix:** Resolved by the Impressum work below. Until then, this section should not render.

---

## `/privacy` vs `docs/openrouter-processing.md` — disagreements

**What I compared.** Every factual assertion in `src/app/privacy/page.tsx:11-106` (including the copy constants it renders, `src/lib/copy.ts:29` and `36-42`) against every factual assertion in `docs/openrouter-processing.md:1-123`, sentence by sentence, and both against the code: `src/lib/prompts.ts` (complete slot inventory), `src/lib/openrouter/server.ts:297-303, 336-346, 460-470` (request bodies and headers), `src/lib/resumeHeader.ts`, `src/lib/tailoring.ts:355-500`, the judge, rescore and export routes, and `supabase/migrations/001_init.sql:78-95` (`llm_calls` columns).

### Disagreement 1 — the target role label

**`docs/openrouter-processing.md:37-40`:**
> Sent: vacancy text as pasted by the user; career-item content or the resume text the user supplied for the scan; generated resume text on the judge and re-score paths; the display name saved in Settings, because a resume carries a name line; **the target role label**; the prompt template.

**`src/app/privacy/page.tsx:19-21`:**
> {APP_NAME} stores the email address you sign up with, together with your career items, **the name and optional target role you give each resume you import**, job postings, scans, generated resumes and per-call AI usage metadata

**Adjudication: the doc is wrong and `/privacy` is right by omission.** The target role is stored and rendered (`src/lib/copy.ts:355-356`, `src/app/api/career/items/route.ts:98`) and is sent to no model. There is no prompt slot for it. See eu-6.

### Disagreement 2 — what "resume text" covers

**`docs/openrouter-processing.md:38-39`:**
> **career-item content** or the resume text the user supplied for the scan

**`src/app/privacy/page.tsx:47-49`:**
> **Resume and vacancy text** are personal data. They are sent to OpenRouter for processing

**Adjudication: both true, but the page understates the scope.** The doc is explicit that the *career base itself* — the retrieved chunks, via `{{retrievedChunksJson}}` at `prompts.ts:157` and `:221` — goes to the model on generation and judging. A user reading "resume text" would think of the document they pasted, not of their entire stored career history being drawn on for each generation. The page should adopt the doc's precision here.

### Disagreement 3 — model providers and where they are

**`docs/openrouter-processing.md:13-18`:** names four model slugs and three upstream providers — *"Anthropic (via Amazon Bedrock)"*, *"OpenAI"*, *"Google"* — and at `:30-33`: *"The generator is OpenAI's, the parser and judge are Anthropic's, and the fallback behind all of them is Google's"*.

**`src/app/privacy/page.tsx:45-54`:** names no model, no upstream provider, and no country. The only geography on the entire page is `:22` — *"hosted in the EU (Frankfurt)"* — and `src/lib/copy.ts:39` — *"in our EU database"*.

**Adjudication: a MAJOR drift, and the most consequential one on the page.** The doc knows the data reaches three US providers; the page tells the reader everything is in Frankfurt. See eu-3.

### Disagreement 4 — provider retention and training settings

**`docs/openrouter-processing.md:65-74`:**
> The API key used by this deployment must belong to an account configured as follows. […] 1. Prompt logging / training on prompts: disabled. 2. Prompt and completion retention: zero-retention routing where the provider offers it; otherwise transient-processing endpoints only. 3. No provider allowed that publishes prompts to a public dataset.

**`docs/openrouter-processing.md:111`:**
> Status: NOT VERIFIED

**`src/app/privacy/page.tsx`:** silent. There is no sentence anywhere on the page about retention or training at the model provider.

**Adjudication: a disagreement between the doc and SPEC, and a gap on the page.** `SPEC.md:927` required *"`docs/openrouter-processing.md` (+ **one sentence on /privacy**)"*. The doc was written; the sentence on `/privacy` never was. And the doc asserts requirements it simultaneously records as unverified. See eu-2.

### Disagreement 5 — whether this deployment may happen at all

**`docs/openrouter-processing.md:122-123`:**
> Until this section is filled in, the deployment is development-only and no URL is shared outside the owner.

**`SPEC.md:927`:**
> Consequence for the reference deployment: synthetic data only (the fictional persona).

**The owner's stated plan:** share the URL and a password with a portfolio reviewer, an examiner and a couple of friends.

**Adjudication: not a `/privacy` disagreement, but the sharpest contradiction I found, and it is between the plan and the repository's own committed record.** Either the record is amended with reasons, or the plan changes. Silence between the two is the one option this project's own rules forbid. See eu-2.

### Where the two agree — verified, not assumed

These four claims appear in both documents, say the same thing, and are true in code:

1. **Contact details are not transmitted.** Doc `:46-56` (*"Also not sent, by decision rather than by omission: **the contact details saved in Settings***… *"a call site that skips the strip does not compile"*) and page `:36-39` (*"They are **not** sent to the AI provider"*). Verified at `tailoring.ts:358-378`, `tailoring.ts:489`, `judge/route.ts:140`, `rescore/route.ts:115`, `coverage.ts:175`, `resumeHeader.ts:290-316`. The branded type is real and has no bypass.
2. **The display name does travel.** Doc `:39-40` and page `:49-50` (*"The name you save in Settings travels with them, because a resume needs a name line on it"*). Verified at `prompts.ts:155` and `:208` — `<candidate_name>` in P2 and P3, and nowhere else.
3. **`llm_calls` is metadata only.** Doc `:60-62` (*"records metadata only: step name, requested and returned model slug, token counts, `cost_usd_micro`, `ok`, `fallback_used`, timestamp. Prompt bodies and model outputs are not written to that table"*) and page `:21` (*"per-call AI usage metadata"*). Verified against `001_init.sql:78-95` — there is no content column.
4. **No account identifier reaches the provider.** Doc `:42-44` (*"Not sent: the account email address, the account identifier, the session token, or any Supabase row id"*). Verified: the chat body at `openrouter/server.ts:336-346` carries `models`, `messages`, `max_tokens`, `temperature` and optionally `response_format` — no `user` field; the embeddings body at `:468` carries `model` and `input` only; `authHeaders()` at `:297-303` sends `Authorization` and `Content-Type` and **no `HTTP-Referer` or `X-Title`**.

---

## Impressum — assessment and recommended copy

**Does name + email + "address on request" discharge the duty for a gated, non-commercial demo?**

**In world (a): most likely yes, because the duty most likely never attaches.** §5 DDG binds providers of *geschäftsmäßige, in der Regel gegen Entgelt angebotene Telemedien* — services offered on a business-like basis, typically for payment. A password-gated demo, not offered to the public, not monetised, with no pricing anywhere in the product (`SPEC.md:35` — *"Free tool — zero words about pricing"*), shown to a named handful of people for examination and portfolio purposes, sits outside that. `geschäftsmäßig` is broader than `gewerblich` and does not require profit — but it does require a sustained, outward-facing offering, and a closed demo is not one. On that reading, name + email is more than the law asks and "address on request" is unobjectionable.

**In world (b): no, and this is a live Abmahnung risk.** Once the URL is public and anyone can register, the "not an offering" argument collapses. German practice on a public site is unambiguous: §5 requires a **ladungsfähige Anschrift** — a street address at which the operator can be served. A Postfach does not satisfy it; nor does "address supplied on request". Missing or incomplete Impressum details are among the most commonly abgemahnt defects on German sites precisely because they are trivially verifiable at scale by anyone running a crawler. A portfolio site demonstrating professional capability is also the archetypal case where the "purely private" defence is weakest — the whole point of a portfolio is to attract professional opportunity.

**The part that is easy to miss, and it matters more than the §5 question.** Even where §5 DDG does *not* attach, **Art. 13(1)(a) GDPR independently requires the controller's identity and contact details**, and Art. 12(2) requires that the controller facilitate the exercise of data subject rights. The GDPR does not spell out "postal address" — but a controller identified only by a first name and a Gmail address is not meaningfully identified, and German supervisory authorities expect a postal address for a controller as a matter of course. So the address is doing GDPR work as well as §5 work, and the GDPR half applies in **both** worlds. Do not treat omitting the address as a purely §5-shaped risk.

**Two further points.** First, `/privacy` is served publicly in **both** worlds regardless of any gate — `src/middleware.ts:12` lists it in `PUBLIC_PATHS` and the matcher at `:107` excludes it outright, so it renders with no session. The Impressum page will be equally public. Whatever goes on it is world-readable from the first deploy. Second, if the deployment ever becomes commercial, §5 grows further items — VAT ID under §27a UStG where one exists, and for regulated professions the chamber, the professional title and the state that granted it. None apply here today.

**My recommendation:** put the postal address in. If the owner is unwilling to publish a home address — an entirely reasonable position for a private individual — the answer is not "address on request"; it is a **c/o or business address that is genuinely capable of receiving service**. If neither is available and the deployment stays gated, name + email with an honest availability statement is defensible for the demo period, and this should be revisited the day the gate comes off. **The §5 threshold for a public deployment is the second item in this report that warrants an actual lawyer**, particularly if the owner's circumstances make an address genuinely difficult.

### Recommended copy — `src/app/impressum/page.tsx`

Placeholders are marked `[[LIKE THIS]]` and are for the owner to fill. **I have not taken any value from git config or from anywhere else in the repository.**

```
# Impressum

Angaben gemäß § 5 DDG

[[FULL LEGAL NAME]]
[[STREET AND NUMBER]]
[[POSTCODE]] [[CITY]]
Germany

Kontakt
E-Mail: [[CONTACT EMAIL ADDRESS]]

Verantwortlich für den Inhalt: [[FULL LEGAL NAME]], address as above.

CV Insight is a non-commercial demonstration project. It is not offered as a
service, no payment is taken and no advertising is carried.

Datenschutz: see Privacy.
```

If the address is genuinely being withheld for the gated demo period, replace the address block with — and understand this is the weaker option, and is **not** sufficient once the deployment is public:

```
[[FULL LEGAL NAME]]
Postal address supplied on request to the email address below, without undue
delay and in any case within one month.

Kontakt
E-Mail: [[CONTACT EMAIL ADDRESS]]
```

**Implementation notes, so the route matches how this codebase already works:**
- Put it at `src/app/impressum/page.tsx`, a Server Component with static content, mirroring `src/app/privacy/page.tsx`.
- Add `'/impressum'` to `PUBLIC_PATHS` in `src/middleware.ts:12`, **and** add an exact-path exclusion to the matcher at `:107` alongside `privacy$`. The comment there is explicit that the exclusion must be anchored and that `/privacy` is excluded as an exact path, not a subtree — follow the same pattern: `impressum$`, not `impressum(?:/|$)`.
- Link it from both layouts next to the existing Privacy link (`src/app/(auth)/layout.tsx:25` and `src/app/(app)/layout.tsx:45`), so it is reachable from every screen.
- Link `/privacy` → `/impressum` and back, and replace the placeholder section at `privacy/page.tsx:94-99` with that link.
- The whole point of an Impressum is that the contact route works. If `[[CONTACT EMAIL ADDRESS]]` is an address nobody reads, the page is decorative.

---

## AI Act

**The clear answer: CV Insight is an AI system in scope of the AI Act, but it is not high-risk. It sits at the minimal-risk tier with light transparency duties that the product already over-satisfies.** No conformity assessment, no Art. 43 procedure, no registration, no risk-management system.

**Why not high-risk, specifically.** Annex III(4)(a) captures AI systems intended to be used *for the recruitment or selection of natural persons, in particular to place targeted job advertisements, to analyse and filter job applications, and to evaluate candidates.* The temptation is to stop at "evaluate candidates" and conclude that a system scoring a CV against a job posting is caught. That reading is wrong, and the reason is the identity of the user and the absence of a decision:

- **The user is the data subject.** The person scoring the CV is the person whose CV it is. There is no employer, no recruiter and no third party in the loop at any point. `SPEC.md:236` — *"No admin role. Do NOT build an admin panel."* `SPEC.md:38` — *"Single-user tool, no collaboration."* Every row is owner-scoped by RLS and no account can see another's data.
- **No candidate pool exists.** "Analyse and filter job applications" presupposes a set of applications from different people being ranked or sifted. This app has exactly one person's data per account and no cross-account read path.
- **No decision is produced about anyone.** The match score is advice to the data subject about their own document, before it is sent anywhere. Nothing turns on it that the user does not choose. Recital 57 ties the Annex III(4) risk to AI systems that *materially affect a person's access to employment as determined by another party* — the harm is a candidate being filtered out by a machine acting for an employer. That harm is structurally absent here.

**Art. 22 GDPR reaches the same conclusion by a different route.** There is no decision based solely on automated processing producing legal effects or similarly significantly affecting the user, because the user is the one deciding what to do with the output. Worth one line on `/privacy` (see eu-1) precisely because a reader might assume otherwise when they see a percentage score.

**What does apply, lightly:**

- **Art. 50 transparency.** Users must know they are interacting with an AI system. This app does not merely satisfy that — it goes conspicuously further: SPEC v2.22 made the result screen name the model that wrote each draft and flag when the fallback served, and `/quality` exists as a per-user observability dashboard over every model call. That is a stronger disclosure posture than the Article requires.
- **Art. 50(2) marking of synthetic text.** The obligation falls on providers of generative systems and is aimed at machine-readable marking of AI-generated content. It is not engaged in any practically meaningful way here: the output is a private document the user edits, takes responsibility for and sends themselves; the app disseminates nothing to the public. The user's own decision about whether to tell an employer their CV was AI-assisted is theirs, and it is not a duty this operator can discharge for them.
- **Art. 4 AI literacy** (applicable since 2 February 2025) concerns providers' and deployers' staff. A solo operator with no staff has essentially nothing to do.

**What would change the answer — the tripwires, and each is a STOP:**

1. **Any employer-facing or recruiter-facing mode.** An account type that sees more than one person's CV, ranks candidates, or screens a pool. That is Annex III(4)(a) directly, and it changes the classification to high-risk with the full conformity regime attached. `CLAUDE.md` already requires escalation if a feature turns the tool employer-facing; this is that rule's concrete trigger.
2. **Offering it to employers or recruiters at all**, even framed as "assistance" or "candidate matching for hiring teams". Intended purpose governs classification, and marketing copy is evidence of intended purpose.
3. **Any output that another party acts on** — a shareable score link, an ATS export carrying the match rating, an API for a job board. The moment a third party consumes the score to decide about the person, the structural argument above dissolves. Note `SPEC.md:326` already lists *"shareable public links"* as explicitly OUT of scope; that exclusion is now doing AI Act work as well as privacy work, and is worth recording as such.
4. **A claim that the score predicts hiring outcomes.** Prediction about a person's employment prospects is a different product with a different risk profile, regardless of who reads it.

If any of these is ever proposed, stop and get the classification re-done before writing code. This paragraph should live in `docs/` (eu-13) so the next person to touch it finds the tripwires and not just the verdict.

---

## Checked and clean

Coverage, so the absence of a finding is informative rather than an omission.

- **No trackers, no analytics, no third-party scripts, no pixels.** `grep -rin "localStorage|sessionStorage|next/font|fonts.googleapis|fonts.gstatic|<script|googletagmanager|analytics|posthog|plausible|sentry|vercel/analytics|speed-insights"` over `src/` returns four hits, all of them prose in comments or the `/privacy` copy itself. `package.json` carries **no** analytics, telemetry or error-reporting dependency — no `@vercel/analytics`, no `@sentry/*`. `src/app/globals.css:1-2` imports `tailwindcss` and `tw-animate-css`, both bundled at build; **no font CDN, no external stylesheet, no remote asset.** `src/app/layout.tsx` renders `<html>` and `<body>` with no script tag of any kind. There is no `public/` directory. **TTDSG §25 is satisfied and the no-consent-banner decision holds** — nothing has crept in, and I looked specifically for it.
- **Cookies are strictly necessary and correctly hardened.** `src/lib/supabase/cookie-options.ts:31-36` — `httpOnly: true`, `secure` in production, `sameSite: 'lax'`, `maxAge` 30 days. The only cookies written anywhere are Supabase auth cookies: `grep` for `cookies().set`, `Set-Cookie` and `document.cookie` across `src/` returns two hits, both comments. `createBrowserClient` is banned and R11 enforces it in the build. The `cappedMaxAge` workaround at `:55-58` cuts the library's 400-day default to 30 — and the reasoning at `:22-27` names data minimisation on a CV app as the reason, which is the correct reason.
- **Logging discipline is the strongest I have reviewed at this scale, and I checked all 28 sites.** `grep -rn "console\.(log|error|warn|info)"` over `src/` returns 28 lines. Not one writes resume text, vacancy text, career-item content, a display name, a contact value or an email address. Several carry the reason inline: `src/lib/profile/actions.ts:86` — *"Metadata only: the message could carry the name, which is personal data"*; `src/lib/coverage.ts:268` — *"Metadata only: counts, never the spans — they are fragments of the posting"*; `src/lib/openrouter/server.ts:363-366` — the response body of a 4xx is deliberately not read into the error *because OpenRouter echoes the prompt back*. That last one is a subtle leak most projects ship. **CLAUDE.md's "never log resume or vacancy CONTENT anywhere" holds without exception.**
- **No personal data reaches an error message.** `src/lib/chat.ts:358-389` — `parseJsonOutput` maps `z.ZodError.issues` to `path`, `code` and the schema-authored message only, with the docblock at `:361-364` explaining that `issues` carries the offending input on some issue types *"and here that input is the user's resume text"*. `src/app/error.tsx` renders Next's digest and never the message (SPEC Block A). `src/lib/errors.ts:148` logs a name, not a payload.
- **No personal data in URLs.** The only query-parameter mechanism is the `?notice=<key>` toast flash (`SPEC.md:911`), and the keys are `copy.ts` constant names such as `account_deleted`. No email, no id, no content in any path or query string.
- **Erasure cascade is complete across all eight tables.** Every one carries `references auth.users(id) on delete cascade`: `career_items` (001:7), `documents` (001:23), `vacancies` (001:38), `applications` (001:50), `resume_versions` (001:68), `llm_calls` (001:80), `imports` (003:15), `profiles` (004:48). `src/app/api/account/route.ts:62` passes no second argument, so `shouldSoftDelete` is false; the docblock at `:22-24` explains that a soft delete *"would silently turn GDPR erasure into a no-op"*. The handler takes **no `Request` parameter at all**, so there is no id for a caller to forge, and `requireApiUser()` runs before the service-role client is even constructed. The design is right — only the evidence is missing (eu-9).
- **The contact-details-never-reach-a-model claim is true, and enforced by the compiler.** Verified at every call site; detail under eu-5. The branded `ModelResumeText` has exactly one producer and no bypass cast. This is the strongest privacy control in the codebase and it deserves saying plainly: it works.
- **Data minimisation on the profile is genuine, not nominal.** All six contact columns are nullable and length-checked (`005_profile_contacts.sql:48-78`), and the migration's own comment at `:18-21` — *"A resume tool that made a phone number mandatory would be collecting personal data it does not need in order to work"* — is the correct principle applied to the correct decision. The header block collapses field by field, so the app genuinely works with an empty profile.
- **`llm_calls` holds metadata only.** `001_init.sql:78-95` — step, model, `fallback_used`, `ok`, token counts, `cost_usd_micro`, `cost_known`, `latency_ms`, timestamp. **There is no content column and nowhere for prompt text to go.** Append-only (S/I, no UPDATE/DELETE) is appropriate for an audit log, and it cascades on account deletion. Art. 6(1)(f) covers it comfortably.
- **The auth audit-log retention claim ships with real proof.** `docs/eval/audit-retention-evidence.md:43-51` records `status = succeeded`, a scheduled (not manual) run at 03:00 UTC on 2026-09-03, with `DELETE 0` correctly explained. `002_audit_retention.sql:8-9` grants the DELETE the job needs — the thing that silently fails otherwise. `AUDIT_RETENTION_VERIFIED` at `src/lib/copy.ts:29` is `true` and R12 gates it in the build. The disclosed categories at `copy.ts:39` — *"event type, your user id, email address and IP address"* — match what `auth.audit_log_entries` actually holds, and the page correctly states these rows **survive account deletion**, which is the uncomfortable truth most pages would omit. **This is the model the erasure claim (eu-9) and the OpenRouter verification (eu-2) should be held to.**
- **`/privacy` is genuinely reachable from everywhere.** Footer links in both layouts (`src/app/(auth)/layout.tsx:25`, `src/app/(app)/layout.tsx:45`), plus from the deletion dialog (`src/components/delete-account-dialog.tsx:82`). Public and excluded from the middleware matcher as an exact path, so it renders with no session and no auth round trip.
- **Deletion copy is honest at every surface.** `SPEC.md:918` forbids the phrase "all data" in any button, toast, dialog or heading while audit records survive, and the shipped copy obeys: the dialog names what goes and what stays and links to `/privacy`; the toast says *"Your account and the data you created were deleted."* The retention *period* appears in exactly one branch of one ternary and nowhere else. This is a two-truths defect the project found once and then mechanised against, and the mechanism is holding.
- **Prompt-injection containment doubles as a data-boundary control.** Every user-supplied value enters inside a tagged block explicitly marked as DATA (`prompts.ts:159`, `:209`, `:270-271`), system prompts are built server-side and never travel from the client, and no API accepts a `role` field or a prompt fragment. Relevant here because it is what stops one user's pasted text from redirecting a call.
- **No account identifier reaches OpenRouter.** Verified against both request bodies and the header builder; detail in the agreements list above.
- **No consent-based processing exists anywhere in the app**, which is the cleanest possible position and is worth stating affirmatively on the rewritten page.

---

## Scope not covered

- **I did not read `.env.local` and printed no secret value anywhere.** I read no `.env*` file at all.
- **I did not read `WORKLOG.md`** (CLAUDE.md: the owner's private file, off-limits regardless of task).
- **I modified no file.** This was a read-only audit, as instructed. Every recommended change above is described, not made.
- **I did not run the app, the build, the test suite or any migration.** The cascade verification (eu-9) is **static** — I read all eight foreign keys and the deletion handler and they are correct — but I did not observe a deletion actually leaving zero rows. That is precisely the gap eu-9 asks the owner to close, and it is a gap in my evidence as much as in the repository's.
- **Vercel and Supabase plan-tier facts are not mine to confirm.** I have relied on `docs/reviews/phase-6-vercel-security.md` for the Password Protection availability question and have deliberately not re-derived it. My world-(a)/world-(b) split exists because that question is open; **I have not resolved it and the owner must.** Every conclusion I marked as contingent depends on their answer.
- **Two items need a real lawyer, and I have flagged both inline:** (1) the Art. 28/Chapter V position arising from using an OpenRouter account belonging to a third party while processing named individuals' real CVs (eu-2) — a lawyer may well say informed written notice to five named people suffices, but that is their call; (2) the §5 DDG threshold and the postal-address question if the deployment becomes public or is used to demonstrate professional capability commercially.
- **I did not assess Supabase-side configuration** — RLS policy correctness at runtime, the `match_documents` invoker property, or whether the `pg_cron` job is still succeeding today. That is `supabase-security`'s remit. I read the migrations and the policy matrix as written and assumed they are applied as written; note that `SPEC.md:1267` makes RLS verification a separate Definition-of-Done item.
- **I did not re-audit the platform findings in `phase-6-vercel-security.md`.** vs-2 (`maxDuration`), vs-3 (dev-route evidence), vs-4 (preview environments sharing production secrets), vs-5 (security headers) and vs-7 (upload size) are that gate's, and they stand. Read the two reports together: **vs-1 is the same fact as my eu-4, and vs-6 is the same fact as my eu-10 — in both cases that report supplies the technical finding and this one supplies the legal characterisation.** vs-4 in particular has a privacy dimension I did not develop: a preview deployment pointed at the production Supabase project means a half-finished branch runs against real users' resumes, and the service-role key bypasses RLS entirely. Fix it for the reason vs-4 gives.
- **I did not read `docs/reviews/phase-6-nextjs-security.md` in full.** I confirmed only that it explicitly defers `/privacy` content, the Impressum and the GDPR disclosure text to this gate (its line 219), so there is no gap between us.
- **I did not draft the replacement `/privacy` text.** eu-1 enumerates what must be in it and the Impressum section gives copy for that page, but writing the full privacy statement is the owner's — and, for the two flagged items, a lawyer's — task, not a review agent's.
