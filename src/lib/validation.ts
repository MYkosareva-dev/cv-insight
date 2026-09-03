import { z } from 'zod';

import { AUTH, CAREER, SCAN } from '@/lib/copy';
import { MAX_CAREER_ITEMS } from '@/lib/limits';

/**
 * Zod schemas shared by the client form and the server that receives it.
 *
 * Deliberately NOT `server-only`: the SAME schema runs in both places, and both
 * runs matter for different reasons.
 *  - On the client (`components/auth-form.tsx`, on submit) it blocks the submit
 *    and renders the inline error, which is what SPEC Block F means by "inline,
 *    block submit".
 *  - On the server (`lib/auth/actions.ts`) it is the actual GATE. A Server
 *    Action is a public endpoint; nothing stops a caller from invoking it
 *    without ever rendering the form, so the client parse is a convenience and
 *    the server parse is the security boundary. Never drop the server one.
 *
 * Messages come from `lib/copy.ts`, so the string a test asserts on is the
 * string the field renders (SPEC Block F validation tables).
 */

/** Sign up / Sign in. Rules in SPEC Block F order: required, then shape. */
export const credentialsSchema = z.object({
  email: z.email({ message: AUTH.invalidEmail }),
  password: z.string().min(8, { message: AUTH.shortPassword }),
});

export type Credentials = z.infer<typeof credentialsSchema>;

/** Field name → first error message, for rendering under the input. */
export type FieldErrors = Partial<Record<keyof Credentials, string>>;

export function fieldErrorsOf(error: z.ZodError<Credentials>): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field === 'email' || field === 'password') && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}

/**
 * The reply a Server Action sends back to the auth form.
 *
 * It lives here rather than in `lib/auth/actions.ts` because a `'use server'`
 * module may export ONLY async functions — a constant there is a build error,
 * not a lint warning. Keeping the shape next to the schema that produces its
 * `fieldErrors` is the right home anyway.
 */
export type AuthState = {
  fieldErrors: FieldErrors;
  /** Form-level failure — a credential or account error, not a field-shape one. */
  formError: string | null;
};

export const EMPTY_AUTH_STATE: AuthState = { fieldErrors: {}, formError: null };

// ---------------------------------------------------------------------------
// Career base (SPEC US-1, Block C constraints, Block D endpoints 1-3)
// ---------------------------------------------------------------------------

/**
 * `career_items.type` — the CHECK constraint in 001_init.sql, in Zod form.
 *
 * Block F calls this "Select — cannot violate", which is true of the FORM and
 * false of the endpoint: a route handler is a public surface and the enum is
 * re-checked here regardless.
 */
export const careerItemTypeSchema = z.enum([
  'role',
  'project',
  'achievement',
  'skill_block',
  'education',
  'certification',
]);

/**
 * The bounds are the DATABASE's, not a second opinion about them: `title` 1-200
 * and `content` 1-4000 are CHECK constraints in 001_init.sql. Validating to the
 * same numbers means a violation surfaces as a 400 with the Block F copy the
 * field renders, instead of as a Postgres constraint error mapped to a 500.
 */
const careerItemFields = {
  type: careerItemTypeSchema,
  title: z.string().trim().min(1, CAREER.titleRequired).max(200, CAREER.titleRequired),
  content: z.string().trim().min(1, CAREER.contentRequired).max(4000, CAREER.contentRequired),
  /** Free text by design (Block C): "01/2025 – present" is not a parseable date range. */
  period: z.string().trim().max(120).nullable(),
};

/**
 * One item as the LLM returns it from an import (step `import_resume`).
 *
 * Strict on the same bounds as the table, deliberately. When the model emits an
 * item over the limit the ONE repair retry gets the Zod error appended and is
 * told what to fix (CLAUDE.md exception (a), edge case N3) — which is the honest
 * repair. Truncating to fit would silently drop a piece of the user's own career
 * history, and accepting it would just move the failure to the INSERT, where the
 * CHECK constraint answers with a 500 instead of something a user can act on.
 */
export const extractedItemSchema = z.object(careerItemFields);

/**
 * The whole import payload. `.max(MAX_CAREER_ITEMS)` is not rule B9 — B9 is
 * enforced against the user's stored count in the save handler, which is the only
 * place that knows it. This bound just stops one runaway response from becoming a
 * 4,000-element review list.
 */
export const extractedItemsSchema = z.object({
  items: z.array(extractedItemSchema).max(MAX_CAREER_ITEMS),
});

export type ExtractedItem = z.infer<typeof extractedItemSchema>;

/**
 * Upper bound on the resume text that may reach a model call (SPEC v2.10).
 *
 * SPEC bounded the vacancy (100–20,000) and the pasted scan resume (100–15,000)
 * but never the career import, on either branch. That gap has a price attached:
 * a 5 MB text-dense PDF is legal under the file-size cap and extracts to
 * megabytes of characters, which would go out as ONE very large metered prompt.
 * Edge case S7 is explicit that oversized input is rejected BEFORE any LLM spend,
 * so both branches are bounded here rather than trusted.
 *
 * 20,000 characters is roughly ten résumé pages — comfortably above any real CV
 * and far below a runaway extraction.
 */
export const MAX_IMPORT_TEXT_CHARS = 20_000;

/**
 * POST /api/career/import — the pasted-text branch. The PDF branch is multipart
 * and its extracted text is validated with `importedResumeText` below.
 */
export const importTextSchema = z.object({
  text: z.string().trim().min(100, SCAN.resumeRequired).max(MAX_IMPORT_TEXT_CHARS),
});

/**
 * The same bound applied to text that came out of a PDF rather than a textarea.
 *
 * A separate function because the two branches fail differently: a paste that is
 * too short is the user's typo and gets the Block F copy, whereas an extraction
 * that is too short means the PDF had no usable text layer — which is 422
 * UNREADABLE_PDF, not 400. `lib/pdf.ts` owns that lower bound; this owns the
 * upper one, where an over-long extraction is truncated rather than refused: the
 * user did nothing wrong, and the first 20,000 characters of a CV are the part
 * that matters.
 *
 * It REPORTS the truncation rather than performing it quietly. A silent cut is
 * the same defect the chunker refuses when it merges overflow instead of dropping
 * it — part of the user's career history disappears while the result still looks
 * complete — except here it disappears before the model ever sees it, so the only
 * symptom would be fewer items than the CV contains and no reason given. The
 * caller turns the flag into a dialog notice.
 */
export function importedResumeText(extracted: string): {
  text: string;
  truncated: boolean;
} {
  if (extracted.length <= MAX_IMPORT_TEXT_CHARS) return { text: extracted, truncated: false };
  return { text: extracted.slice(0, MAX_IMPORT_TEXT_CHARS), truncated: true };
}

/**
 * Is this upload a PDF at all?
 *
 * Block F lists `.pdf` as rule 1 of the upload validation, and it is not
 * ceremony: without it a `.docx` reaches `unpdf`, which throws, and the user gets
 * "We couldn't read text from this PDF. It may be scanned" about a file that is
 * not a PDF and never was. DOCX and Markdown import are also on the Prohibited
 * list, so refusing them here is the rule being enforced rather than a UX nicety.
 *
 * Extension AND media type, with either sufficient: browsers disagree about the
 * type they attach to a file input, and some send `application/octet-stream`.
 */
export function isPdfUpload(file: { name: string; type: string }): boolean {
  return file.name.toLowerCase().endsWith('.pdf') || file.type === 'application/pdf';
}

/**
 * POST /api/career/items — the reviewed items the user chose to keep.
 *
 * The client sends items it may have EDITED in the review list, so every field is
 * re-validated here; nothing is trusted because it once came from our own parse.
 */
export const saveCareerItemsSchema = z.object({
  items: z.array(extractedItemSchema).min(1, CAREER.nothingSelected).max(MAX_CAREER_ITEMS),
});

/**
 * PATCH /api/career/items/[id] — a partial edit.
 *
 * `id` is NOT in the body: it comes from the route segment and is never trusted
 * as an ownership claim either way. RLS scopes the UPDATE to auth.uid(), so
 * another user's id simply matches no row and the handler answers 404 (S6).
 */
export const patchCareerItemSchema = z
  .object(careerItemFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update.' });

export type PatchCareerItem = z.infer<typeof patchCareerItemSchema>;

/** Which fields of a career item can carry an inline message (Block F). */
export type ItemFieldErrors = Partial<Record<'title' | 'content', string>>;

/**
 * Field → first error message for ONE career item, for the review list and the
 * Edit dialog.
 *
 * The client twin of the server parse, exactly as `fieldErrorsOf` is for the auth
 * form and for the same split of duties: this blocks the submit and renders the
 * Block F string inline, while the route handler's parse is the actual gate. Both
 * run the SAME schema, so the message a test asserts on is the message the field
 * shows — and neither can drift from `career_items`' CHECK constraints, since the
 * bounds are those constraints.
 *
 * Without it the DB check answers instead, and a 4,001-character item comes back
 * as a Postgres constraint error the user cannot act on.
 */
export function fieldErrorsForItem(item: {
  type: string;
  title: string;
  content: string;
  period: string | null;
}): ItemFieldErrors {
  const result = extractedItemSchema.safeParse({
    ...item,
    // An empty period box means "no period", not an empty string.
    period: item.period === null || item.period.trim() === '' ? null : item.period,
  });
  if (result.success) return {};

  const errors: ItemFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if ((field === 'title' || field === 'content') && !errors[field]) {
      errors[field] = issue.message;
    }
  }
  return errors;
}
