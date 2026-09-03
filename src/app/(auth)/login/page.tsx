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
 */
export default function LoginPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signIn}</h1>
      <AuthForm
        action={signInAction}
        submitLabel={AUTH.signIn}
        pendingLabel={AUTH.signingIn}
        altHref="/signup"
        altLabel={AUTH.toSignUp}
      />
    </div>
  );
}
