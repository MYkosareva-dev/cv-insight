import { AuthForm } from '@/components/auth-form';
import { signUpAction } from '@/lib/auth/actions';
import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Create account — CV Insight' };

/**
 * Email confirmation is off (SPEC Block F decision), so a successful sign-up
 * lands straight on /career with a session — US-1 step 1.
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
    </div>
  );
}
