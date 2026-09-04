'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AUTH } from '@/lib/copy';
import {
  type AuthState,
  type FieldErrors,
  EMPTY_AUTH_STATE,
  credentialsSchema,
  fieldErrorsOf,
} from '@/lib/validation';

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
}: {
  action: (state: AuthState, formData: FormData) => Promise<AuthState>;
  submitLabel: string;
  pendingLabel: string;
  /**
   * The link to the OTHER auth form, and both halves are optional together
   * (v2.25). On a deployment registration is closed, so /login must not invite
   * anyone to "Create one" — a link whose destination exists only to say no is
   * worse than no link. Omitting both renders nothing; passing one without the
   * other is a type error rather than a half-rendered link.
   */
  altHref?: string;
  altLabel?: string;
}) {
  const [state, formAction] = useActionState(action, EMPTY_AUTH_STATE);
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});

  /**
   * SPEC Block F: "inline, block submit". The same Zod schema the action uses
   * runs here first, so an obviously bad email or a 7-character password never
   * costs a round trip. This is a convenience, NOT a gate — the action
   * re-validates, because a Server Action is a public endpoint and this check
   * lives in the browser where anyone can skip it.
   *
   * Why the form below carries `noValidate` (SPEC v2.4): the browser's native
   * constraint validation runs BEFORE submit, so with it enabled a malformed
   * address is caught by `type="email"` and the browser's own bubble — this
   * handler never runs for that field and `AUTH.invalidEmail` is never seen.
   * The password case still reached Zod (a 5-character password is natively
   * valid), which is exactly why the gap was invisible: one path rendered our
   * copy, the other quietly did not. `required` stays on each field for its
   * semantics; `noValidate` is what keeps the copy ours.
   */
  function validateBeforeSubmit(event: React.FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const parsed = credentialsSchema.safeParse({
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    });
    if (parsed.success) {
      setClientErrors({});
      return;
    }
    event.preventDefault();
    setClientErrors(fieldErrorsOf(parsed.error));
  }

  // A field shows its client error until the server replies about that field.
  const errorFor = (field: keyof FieldErrors) => state.fieldErrors[field] ?? clientErrors[field];

  return (
    <form
      action={formAction}
      onSubmit={validateBeforeSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      <Field
        id="email"
        name="email"
        type="email"
        label={AUTH.emailLabel}
        autoComplete="email"
        error={errorFor('email')}
      />
      <Field
        id="password"
        name="password"
        type="password"
        label={AUTH.passwordLabel}
        autoComplete={submitLabel === AUTH.signIn ? 'current-password' : 'new-password'}
        error={errorFor('password')}
      />

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}

      <Submit label={submitLabel} pendingLabel={pendingLabel} />

      {altHref && altLabel ? (
        <Link
          href={altHref}
          className="text-primary self-start text-sm underline-offset-4 hover:underline"
        >
          {altLabel}
        </Link>
      ) : null}
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
