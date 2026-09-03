'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SETTINGS } from '@/lib/copy';
import { saveDisplayNameAction } from '@/lib/profile/actions';
import { EMPTY_DISPLAY_NAME_STATE, MAX_DISPLAY_NAME_CHARS } from '@/lib/validation';

/**
 * The Settings display-name field (SPEC v2.17, Block E).
 *
 * ONE OPTIONAL FIELD, and everything about it says so: the hint calls it
 * optional, the input has no `required`, and an empty value is a save rather
 * than a refusal — a settings field a user cannot empty is one they cannot take
 * back. The app works without it, so this asks and never insists; a name is
 * personal data, and a field that looks mandatory collects it from people who
 * would rather not give it.
 *
 * A client component only for `useActionState`, which is what lets the server's
 * own answer render inline instead of as a toast the user may have dismissed
 * before reading. The write itself is a Server Action: no fetch, no endpoint, no
 * client-side validation pretending to be a gate.
 *
 * `defaultValue` and not `value`: the input is uncontrolled, so the user's
 * typing survives the action's round trip, and a successful save re-renders the
 * Server Component with the stored name behind it.
 */
export function DisplayNameForm({ displayName }: { displayName: string | null }) {
  const [state, formAction, pending] = useActionState(
    saveDisplayNameAction,
    EMPTY_DISPLAY_NAME_STATE,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <label htmlFor="displayName" className="text-sm font-medium">
        {SETTINGS.displayNameLabel}
      </label>
      <p id="displayName-hint" className="text-muted-foreground text-sm">
        {SETTINGS.displayNameHint}
      </p>
      <div className="flex flex-wrap items-start gap-2">
        <Input
          id="displayName"
          name="displayName"
          type="text"
          className="max-w-xs"
          defaultValue={displayName ?? ''}
          placeholder={SETTINGS.displayNamePlaceholder}
          maxLength={MAX_DISPLAY_NAME_CHARS}
          aria-describedby="displayName-hint"
          aria-invalid={state.error ? true : undefined}
          autoComplete="name"
        />
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? SETTINGS.displayNameSaving : SETTINGS.displayNameSave}
        </Button>
      </div>
      {/*
        The server's own answer, inline. `role="status"` for the success side and
        `role="alert"` for the failure, so a screen reader is told which of the
        two it is rather than hearing one sentence in one voice.
      */}
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-muted-foreground text-sm">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
