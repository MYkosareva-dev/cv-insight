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
    return { fieldErrors: {}, formError: signUpMessage(error.code) };
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
    return { fieldErrors: {}, formError: signInMessage(error.code) };
  }

  redirect('/scan');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}

/**
 * Branch on `error.code`, NEVER on the HTTP status. GoTrue returns 422 for a
 * duplicate address AND for `weak_password`, so a status check would tell
 * someone whose password the project rejected that their email is already
 * registered — wrong copy, and a false account-enumeration signal from an
 * account that may not exist.
 *
 * `weak_password` is only reachable when the Supabase project sets a policy
 * stricter than the Zod min-8 (a longer minimum, or leaked-password
 * protection); when it does, the user gets the Block F password copy.
 */
function signUpMessage(code: string | undefined): string {
  switch (code) {
    case 'user_already_exists':
    case 'email_exists':
      return AUTH.emailTaken;
    case 'weak_password':
      return AUTH.shortPassword;
    default:
      return AUTH.signUpFailed;
  }
}

/**
 * Four outcomes (SPEC Block E), never collapsed. Collapsing them would tell a user
 * with a perfectly good password that it is wrong, when what actually happened
 * is that Supabase rate-limited us or was unreachable — the app reporting a
 * result it never obtained.
 *
 * Non-enumeration still holds: only the credential branch is specific, and it
 * is identical for an unknown email and a wrong password. The other two say
 * nothing about whether the account exists.
 */
function signInMessage(code: string | undefined): string {
  switch (code) {
    case 'invalid_credentials':
      return AUTH.badCredentials;
    // FOURTH outcome. The credentials were RIGHT — saying "incorrect" here would
    // be the app reporting something it did not observe, and it sends the user
    // to re-check a password that was never the problem.
    case 'email_not_confirmed':
      return AUTH.emailNotConfirmed;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return AUTH.rateLimited;
    default:
      // Network failure, 5xx, an unrecognised code — anything we did not
      // actually verify. Never claim the credentials were wrong.
      return AUTH.signInUnavailable;
  }
}
