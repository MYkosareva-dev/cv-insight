import Link from 'next/link';

import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Create account — CV Insight' };

export default function SignupPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signUp}</h1>
      <p className="text-muted-foreground text-sm">
        Placeholder — the sign-up form is built in the auth phase.
      </p>
      <Link href="/login" className="text-primary text-sm underline-offset-4 hover:underline">
        {AUTH.signIn}
      </Link>
    </div>
  );
}
