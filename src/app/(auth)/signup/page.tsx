import Link from 'next/link';

import { AuthForm } from '@/components/auth-form';
import { signUpAction } from '@/lib/auth/actions';
import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Create account — CV Insight' };

/**
 * REGISTRATION IS OPEN IN EVERY ENVIRONMENT (SPEC v3.0, superseding v2.25).
 *
 * v2.25 closed sign-ups on the deployment because an account could spend
 * without limit and the only fence was the door. v3.0 moves the fence to where
 * every other limit in this app already lives: the Free plan bounds what one
 * account can spend, enforced inside the two gates (`lib/chat.ts`,
 * `lib/retrieval.ts`) and never on this page. So the form renders on a
 * deployment as it does in development, and there is no `NODE_ENV` branch here.
 *
 * What that fence does NOT cover is stated in SPEC's v3.0 decision rather than
 * hidden: the provider key carries no credit limit, so the total across many
 * accounts is unbounded, and the per-account caps are not race-safe under
 * concurrent requests. Both are owner-accepted and in the backlog.
 *
 * Email confirmation stays OFF in the Supabase dashboard: this app sends no mail
 * of its own, and the Playwright suite registers through this form.
 *
 * The privacy line sits INSIDE the card, at the point of collection, and not only
 * in the layout footer (owner amendment, v3.0c). It informs; it asks for nothing.
 */
export default function SignupPage() {
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
      <p className="text-muted-foreground text-sm">
        {AUTH.signUpPrivacyBefore}
        <Link href="/privacy" className="text-primary underline-offset-4 hover:underline">
          {AUTH.signUpPrivacyLink}
        </Link>
        {AUTH.signUpPrivacyAfter}
      </p>
    </div>
  );
}
