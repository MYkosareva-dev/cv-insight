'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUTH } from '@/lib/copy';
import { type AuthState, EMPTY_AUTH_STATE } from '@/lib/validation';

/**
 * The shared sign-in / sign-up card (SPEC Block E: centered 400 px card, Email
 * and Password, primary green button, link to the other form, Privacy footer).
 *
 * The action is a Server Action, so the browser never holds an access decision:
 * validation, the Supabase call and the cookie write all happen server-side and
 * the reply is just the field errors to render. On success the action redirects
 * and this component never re-renders.
 */
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  altHref,
  altLabel,
  notice,
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  altHref: string;
  altLabel: string;
  notice?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_AUTH_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {notice ? (
        <p
          role="status"
          className="border-border bg-muted text-muted-foreground rounded-md border px-3 py-2 text-sm"
        >
          {notice}
        </p>
      ) : null}

      <Field
        id="email"
        name="email"
        type="email"
        label={AUTH.emailLabel}
        autoComplete="email"
        error={state.fieldErrors.email}
      />
      <Field
        id="password"
        name="password"
        type="password"
        label={AUTH.passwordLabel}
        autoComplete={submitLabel === AUTH.signIn ? 'current-password' : 'new-password'}
        error={state.fieldErrors.password}
      />

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      <Submit label={submitLabel} pendingLabel={pendingLabel} />

      <Link
        href={altHref}
        className="text-primary self-start text-sm underline-offset-4 hover:underline"
      >
        {altLabel}
      </Link>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; error?: string }) {
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <Input
        id={id}
        required
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
      />
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Separate component so useFormStatus reads THIS form's pending state. */
function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
