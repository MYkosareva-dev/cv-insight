import { AuthForm } from '@/components/auth-form';
import { signInAction } from '@/lib/auth/actions';
import { AUTH, SETTINGS } from '@/lib/copy';

export const metadata = { title: 'Sign in — CV Insight' };

/**
 * A member never reaches this page: src/middleware.ts redirects a signed-in
 * visitor to /scan before it renders.
 *
 * `?deleted=1` is set by the account-deletion flow, which cannot hand a toast
 * across a full sign-out and navigation. The notice carries the exact SPEC copy.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { deleted } = await searchParams;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signIn}</h1>
      <AuthForm
        action={signInAction}
        submitLabel={AUTH.signIn}
        pendingLabel={AUTH.signingIn}
        altHref="/signup"
        altLabel={AUTH.toSignUp}
        notice={deleted === '1' ? SETTINGS.deleted : undefined}
      />
    </div>
  );
}
