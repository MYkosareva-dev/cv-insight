import Link from 'next/link';

import { AuthForm } from '@/components/auth-form';
import { signUpAction } from '@/lib/auth/actions';
import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Create account — CV Insight' };

/**
 * REGISTRATION IS CLOSED ON A DEPLOYMENT, AND THIS PAGE SAYS SO (v2.25, gate
 * finding `vs-1`).
 *
 * The deployment was to be gated by Vercel Password Protection. That is a Pro
 * feature, so the gate moved: the URL is reachable, and what keeps strangers out
 * is **new sign-ups disabled in the Supabase dashboard**, with accounts created
 * by hand for named people. That setting lives outside this repository and
 * nothing here can enforce it — but this page can stop lying about it.
 *
 * With registration closed, `signUpAction` cannot succeed: Supabase refuses the
 * call. Rendering the form anyway would offer a control whose only outcome is a
 * refusal, which is the same defect class as a button that spends money and says
 * nothing — the app claiming a capability it does not have.
 *
 * WHY `NODE_ENV` AND NOT A NEW ENVIRONMENT VARIABLE. It is the discriminator
 * this codebase already uses for "this is a deployment" — the `/api/dev/*` fence
 * is the same line, and that fence is now witnessed against a production build
 * (Block H item 9). A dedicated `REGISTRATION_OPEN` flag would be a second
 * source of truth about the same fact, settable to the wrong value, and it would
 * still not be the actual gate. The actual gate is the Supabase setting; this is
 * the page telling the truth about it.
 *
 * THE FORM SURVIVES IN DEVELOPMENT, and that is deliberate: the Playwright suite
 * creates a throwaway account per run through this form, and it only ever runs
 * against a development server. Note the limit of that — the suite talks to the
 * SAME Supabase project, so once sign-ups are disabled there the suite cannot
 * create accounts either, whatever this page renders. That consequence is the
 * deploy notes' problem, not this file's, and it is written down there rather
 * than left to be discovered.
 */
export default function SignupPage() {
  if (process.env.NODE_ENV === 'production') {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{AUTH.registrationClosedTitle}</h1>
        <p className="text-muted-foreground text-sm">{AUTH.registrationClosedBody}</p>
        <p className="text-muted-foreground text-sm">{AUTH.registrationClosedSignIn}</p>
        <Link href="/login" className="text-primary text-sm underline-offset-4 hover:underline">
          {AUTH.signIn}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signUp}</h1>
      <AuthForm
        action={signUpAction}
        submitLabel={AUTH.signUp}
        pendingLabel={AUTH.creatingAccount}
        altHref="/login"
        altLabel={AUTH.toSignIn}
      />
    </div>
  );
}
