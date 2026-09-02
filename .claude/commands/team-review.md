---
description: Multi-agent review of the current branch using CV Insight's own subagents (code, security, architecture), with consolidated findings.
---
Perform a comprehensive multi-agent review of: $ARGUMENTS (default: the current branch diff against main, `git diff main...HEAD`).

[This command fans the review out to this project's OWN subagents defined in .claude/agents/. Each reviews independently against SPEC.md and CLAUDE.md; findings are then consolidated. Never print secret values during review — variable names only.]

## Review process

### 1. Code quality & SPEC conformance
Use Task tool with subagent_type="ai-code-reviewer":
"Review the diff of: $ARGUMENTS. Run all four passes from your instructions (secrets, security & access, correctness against SPEC, quality). Return your standard report."

### 2. Security review
Run BOTH, independently:
- Task tool with subagent_type="supabase-security": "Audit the current state of supabase/ and all data access touched by: $ARGUMENTS. Return your standard table-by-table report."
- Task tool with subagent_type="nextjs-security": "Audit the server/client boundary, secret exposure paths and session checks touched by: $ARGUMENTS. Return your standard report."

### 3. Architecture review
Use Task tool with subagent_type="ai-architect":
"Review the design of: $ARGUMENTS against SPEC.md and CLAUDE.md. Check chokepoints (gates, DALs), server/client boundary, metered-call discipline, and undeclared SPEC deviations. Return your standard verdict."

### 4. Compliance (conditional)
If the diff touches personal-data flows, cookies/storage, third-party calls, or public pages, also run Task tool with subagent_type="eu-compliance-reviewer": "Review: $ARGUMENTS for GDPR/TTDSG impact. Return your standard report."

## Consolidated output

Merge all findings, deduplicated, into:
1. **Blockers — must fix before merge**: secret exposure, RLS gaps, broken chokepoints, auth bypasses, undeclared SPEC deviations.
2. **Important — fix in this branch**: correctness against SPEC contracts, missing validation, missing llm_calls logging, missing UI states.
3. **Minor — may defer**: style, naming, docs gaps (file as TODOs, do not block).
4. **Positive findings** — practices worth keeping.

End with a single verdict: MERGE | FIX BLOCKERS FIRST. Save the consolidated report to docs/reviews/<branch-name>-multi.md.
