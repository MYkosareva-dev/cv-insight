'use server';

import { redirect } from 'next/navigation';

import { AUTH } from '@/lib/copy';
import { createClient } from '@/lib/supabase/server';
import {
  type AuthState,
  credentialsSchema,
  fieldErrorsOf,
} from '@/lib/validation';

/**
 * Sign up / sign in / sign out as Server Actions.
 *
 * Why actions rather than calling the browser client from the form: a Server
 * Action is a public endpoint, so the Zod parse here is the real gate — a
 * client-side check alone validates nothing. It also keeps the cookie write on
 * the server, where `cookies().set()` actually works (a Server Component's
 * write is swallowed; see lib/supabase/server.ts).
 *
 * Supabase Auth does all password handling: signUp / signInWithPassword /
 * signOut and nothing else. No hashing, no comparison, no homemade tokens
 * (CLAUDE.md, Authentication rule 1).
 */

function parse(formData: FormData) {
  return credentialsSchema.safeParse({
    email: String(formData.get('email') ?? ''),
    password: String(formData.get('password') ?? ''),
  });
}

/**
 * Registration. Email confirmation is disabled in the Supabase dashboard, so
 * signUp returns a session immediately and the cookie is set here (SPEC Block F
 * Auth flows). Lands on /career: a new account's base is empty, and that screen
 * is where the first import starts (US-1 step 1).
 */
export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), formError: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);

  if (error) {
    return { fieldErrors: {}, formError: signUpMessage(error.code, error.status) };
  }

  // With confirmation off a session is always returned. If the project is ever
  // switched to require confirmation, there is no session and redirecting to a
  // member route would bounce straight back to /login — say so instead of
  // pretending the sign-up failed.
  if (!data.session) {
    return { fieldErrors: {}, formError: AUTH.checkEmail };
  }

  redirect('/career');
}

/** Login. Any credential failure is one message — never reveal which half was wrong. */
export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error), formError: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { fieldErrors: {}, formError: AUTH.badCredentials };
  }

  redirect('/scan');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Supabase reports a duplicate registration in more than one shape depending on
 * project settings, so match on both the error code and the 4xx status rather
 * than on the message text, which is not a stable contract.
 */
function signUpMessage(code: string | undefined, status: number | undefined): string {
  const duplicate =
    code === 'user_already_exists' || code === 'email_exists' || status === 422;
  return duplicate ? AUTH.emailTaken : AUTH.signUpFailed;
}
