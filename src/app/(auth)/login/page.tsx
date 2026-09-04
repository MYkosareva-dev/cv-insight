import { AuthForm } from '@/components/auth-form';
import { signInAction } from '@/lib/auth/actions';
import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Sign in — CV Insight' };

/**
 * A member never reaches this page: src/middleware.ts redirects a signed-in
 * visitor to /scan before it renders.
 *
 * Post-deletion messaging arrives as `?notice=account_deleted` and is shown by
 * <FlashToast /> in the (auth) layout — one toast mechanism for the whole app
 * (SPEC Block E), not a per-page notice.
 *
 * The "No account? Create one" link is DEVELOPMENT-ONLY (v2.25, gate finding
 * `vs-1`). On a deployment registration is closed, and inviting a visitor to
 * create an account that cannot be created is the same dishonesty as the sign-up
 * form itself — one click further away. /signup still exists and still explains;
 * this page just stops sending anyone there expecting a form.
 */
export default function LoginPage() {
  const registrationOpen = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signIn}</h1>
      <AuthForm
        action={signInAction}
        submitLabel={AUTH.signIn}
        pendingLabel={AUTH.signingIn}
        altHref={registrationOpen ? '/signup' : undefined}
        altLabel={registrationOpen ? AUTH.toSignUp : undefined}
      />
    </div>
  );
}
