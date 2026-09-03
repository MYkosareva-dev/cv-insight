import { z } from 'zod';

import { AUTH, CAREER, SCAN } from '@/lib/copy';
import { MAX_CAREER_ITEMS } from '@/lib/db/limits';

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

/** POST /api/career/import — the pasted-text branch. The PDF branch is multipart. */
export const importTextSchema = z.object({
  text: z.string().trim().min(100, SCAN.resumeRequired).max(20_000),
});

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
