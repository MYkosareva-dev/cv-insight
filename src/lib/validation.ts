import { z } from 'zod';

import { AUTH } from '@/lib/copy';

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
