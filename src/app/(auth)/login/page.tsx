import Link from 'next/link';

import { AUTH } from '@/lib/copy';

export const metadata = { title: 'Sign in — CV Insight' };

export default function LoginPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{AUTH.signIn}</h1>
      <p className="text-muted-foreground text-sm">
        Placeholder — the sign-in form is built in the auth phase.
      </p>
      <Link href="/signup" className="text-primary text-sm underline-offset-4 hover:underline">
        {AUTH.signUp}
      </Link>
    </div>
  );
}
