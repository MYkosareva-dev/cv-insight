# AI Code Review: feature/compliance-and-docs, 2026-10-12

Verdict: **APPROVE**

Scope: `git diff main...HEAD`, 7 commits, 14 files (617+/103-). I read every changed file in full, plus the files the diff made suspect: `src/lib/resumeHeader.ts`, `src/app/privacy/page.tsx`, the export route's call site, `src/app/globals.css`, `docs/backlog.md`, `package.json`, the `docs/reviews/full-review-*` headers and SPEC.md lines 1187, 1259–1287 and 1688.
The review was read-only. The tree is clean after the run (`git status --short` is empty). I opened no `.env*` file and did not open WORKLOG.md. Every recursive grep used `--exclude='.env*'`.

Commands run:
- `node scripts/check.mjs` printed "check passed (13 rules): .from( and .rpc( confined to lib/db; no security definer; NEXT_PUBLIC_ hygiene incl. .env.example; no openrouter.ai URL or connection import outside the gates; every secret reader imports server-only; … no getSession() in src/; service-role key pinned to lib/supabase/admin.ts; createServerClient pinned … every backticked repo path in the docs/ shelf resolves against the tree."
- `npm test` gave `tests 393 · pass 393 · fail 0`. That includes the new `export-lines.test.mjs` and `impressum.test.mjs`.
- `npx tsc --noEmit --incremental false` exited 0.
- `npx eslint` on the 6 changed source and spec files produced no findings.
- I did not run `npm run build`, as instructed. Note that `prebuild` = `npm run check && npm test`, so the claim in `docs/deploy.md` step 21 that the Impressum guard "fails the build" is accurate.

## Blockers
None.

## Majors
None.

## Minors
1. **MINOR: `docs/backlog.md:113-114` is now stale.** It still says "`IMPRESSUM_FILLED` is still `false`, so `/impressum` correctly states the operator is not published". This branch sets the switch to `true` at `src/lib/copy.ts:110`. README:697 calls `docs/backlog.md` "the maintained list of everything else", so this entry now tells the next reader something that is no longer true.
   - Fix: mark the Impressum half of item 7 as closed by this branch. The Speed Insights half still stands.
   - `docs/backlog.md:684` is a NIT inside a dated Phase-6 review section. As a historical record it can stay, or it can get a one-word "CLOSED (v3.0)" marker.
2. **MINOR: the comment at `src/lib/copy.ts:94` is stale within this same branch.** It reads "TRUE FROM v3.0, WITH THE NAME FILLED AND THE EMAIL THE OWNER'S TO TYPE." Commit 92c17aa has since filled the email. Under the documentation-voice and stale-annotation rules, a comment that describes a pending state that no longer exists should be updated, e.g. "…WITH BOTH VALUES FILLED BY THE OWNER."
   - Also at `copy.ts:84`: the reflow left one comment line at about 125 characters while the rest of the block wraps at about 80. Cosmetic only.

## Notes
3. **NOTE: typographic quotes vs the SPEC's verbatim copy.**
   - `RESULT.aiGeneratedLine` (`copy.ts:671`) uses "author’s" with U+2019. SPEC:1187 has a straight `'`.
   - `IMPRESSUM.addressPlaceholder` (`copy.ts:124`) uses “…” where SPEC:1274 has straight `"…"`.
   - `addressRule` uses ’ in "operator’s".
   - The words are identical, and typographic quotes are the existing convention in `copy.ts` (e.g. `IMPRESSUM.unfilled`), so I do not count this as a copy defect. I record it so a future verbatim-diff check does not flag it.
4. **NOTE: `src/lib/utils.ts` now imports `@/lib/copy` and `@/lib/resumeHeader`.**
   - `utils.ts` is the shadcn `cn` module imported by every UI primitive, so both modules are now in the client graph of every component.
   - There is no security consequence. `copy.ts` has no imports and is already imported by client components (`app-sidebar.tsx`, `notes-form.tsx`, `error.tsx`). `resumeHeader.ts` is pure, has no imports and states that it is deliberately not `server-only`. Neither reads `process.env`. I found no import cycle.
   - It does couple the generic class-name helper to product copy. If that grows, a dedicated pure module (e.g. `lib/exportLines.ts`) would keep `utils.ts` generic. That module is also not `server-only`, so it is still testable.
5. **NOTE: the e2e assertions in `tests/e2e/generate.spec.ts:532-536` and `:714-718` were not run.** Those specs make paid model calls; this is declared. They look correct: `getByText` targets the fixed `<p>` outside the textarea, and `inputValue()` cannot contain it.
6. **NOTE: grammar in `README.md:573`.** "In practice the pass has been run with this project's own agents, three of the four `docs/reviews/full-review-*` reports name their agent in the header" is a comma splice; use a semicolon or a colon. I checked the claim itself and it is accurate:
   - The architecture, nextjs-security and supabase-security reports name their agent.
   - The code-quality report does not.

## SPEC / CLAUDE.md conformance (spot-checked)
- **G5 / Block E v3.0 (SPEC:1187, :1688): conforms.**
  - The line renders as fixed text outside the `<Textarea>`, above it (`resume-editor.tsx:108-113`), as a React text node.
  - `exportLines` (`utils.ts`) appends it once, last, muted, never bold, after the user's untouched lines.
  - `resumeToDocx` renders it as a body paragraph in `6B7280`, which matches `--text-muted` at `globals.css:12`.
  - The export route still passes the editor's `content` to `resumeToDocx` (`route.ts:161`) and stores `content` unmodified, so the line is never stored in a version.
  - Unit tests pin last position, exactly-once, muted/not-bold, input immutability and not-a-heading.
- **The `isHeading` move is behaviour-preserving.** It is the same constants, the same logic and the same `FIELD_SEPARATOR` import (re-pointed comment at `resumeHeader.ts:126`). The `docx` import is no longer needed in `docx.ts` and was removed; no dead code is left.
- **Impressum (SPEC:1261-1287): conforms, apart from the owner-approved deferrals.**
  - The filled branch renders name, Contact `mailto:`, Responsible, and Postal address with a bold, marked placeholder, in SPEC order.
  - `addressRule` matches SPEC:1280 word for word.
  - The single `sk_test_` trigger is beside the constant (`copy.ts:107-108`).
  - The deferral of the "Free and Pro plan" sentence (SPEC:1278) is recorded at `copy.ts:126-131` and in the architect report.
  - `IMPRESSUM.email` is a published contact address the owner filled by hand. It is not a secret, and I do not reproduce it here.
  - The guard test now also checks email shape and a non-empty name, which closes eu-compliance F3. F1, F2, F4 and F5 are owner-deferred and not flagged.
- **`/privacy` "Who is responsible"** (`privacy/page.tsx:33-39`) defers to "the operator named in the Impressum". That is now true, because the switch is on.
- **Docs.**
  - The README "How this codebase is built" section lists all 6 agents in `.claude/agents/` and both commands in `.claude/commands/`. I globbed both directories and the set is complete.
  - The "Not built" / "Specified in v3.0 and not yet built" split is accurate: no Stripe or agentic code exists in `src/`.
  - The deploy.md step 21 rewrite and the record bullet are accurate.
- **Review reports.** Both `docs/reviews/compliance-and-docs-*.md` files are present with their original headers and verdict lines.
- **Not touched by this diff:** routes, DALs, migrations, RLS, model calls, Zod schemas and the llm_calls path. The export route change is comment-only. B1 scoring is unchanged.

Checked: secrets ✓ (no secret names or values in the diff, no new env var, no `NEXT_PUBLIC_` change), RLS ✓ (no `supabase/` change), chokepoints ✓ (`check.mjs` passes 13 rules), zod ✓ (no new API input or LLM output), llm_calls logging ✓ (no model-call path changed; the export makes no model call)

Files referenced:
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\copy.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\utils.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\lib\docx.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\components\applications\resume-editor.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\src\app\impressum\page.tsx
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\unit\export-lines.test.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\unit\impressum.test.mjs
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\tests\e2e\generate.spec.ts
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\README.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\deploy.md
- D:\Claude BAI\3_sprint\mkosar-AFA.BAI.3.8\docs\backlog.md
