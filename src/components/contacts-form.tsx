'use client';

import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SETTINGS } from '@/lib/copy';
import { saveContactsAction } from '@/lib/profile/actions';
import type { ResumeContacts } from '@/lib/resumeHeader';
import {
  EMPTY_CONTACTS_STATE,
  MAX_CONTACT_EMAIL_CHARS,
  MAX_LINK_CHARS,
  MAX_LOCATION_CHARS,
  MAX_PHONE_CHARS,
} from '@/lib/validation';

/**
 * The Settings contact-details block (SPEC v2.20, Block E).
 *
 * SIX OPTIONAL FIELDS, and every part of the form says so: the hint calls them
 * optional, no input carries `required`, and an empty field is a save rather than
 * a refusal — clearing one is how a user takes it back. The app works with all of
 * them empty; the resume's header block simply collapses.
 *
 * A client component only for `useActionState`, so the server's own answer
 * renders inline — per field where the failure is a field's, and once at the
 * bottom where the save itself did not happen. The write is a Server Action: no
 * fetch, no endpoint, and no client-side validation pretending to be the gate.
 *
 * `defaultValue` and not `value`: the inputs are uncontrolled, so what the user
 * typed survives the action's round trip, and a successful save re-renders the
 * Server Component with the stored row behind it.
 *
 * THE LINKS ARE NEVER RENDERED AS ANCHORS, here or anywhere. They are text in a
 * text input, text on the resume and a plain run in the .docx — so there is no
 * href for a scheme to be smuggled into, and the `https://`-only check at the Zod
 * boundary is a rule about what may be STORED rather than a patch over a link the
 * app builds.
 */
export function ContactsForm({
  contacts,
  readFailed,
}: {
  contacts: ResumeContacts;
  /**
   * The stored row could not be READ. Distinct from every field being null,
   * which means the user filled nothing in — blank fields with no explanation
   * read as "the app forgot my details", and only one of those is true.
   */
  readFailed: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveContactsAction, EMPTY_CONTACTS_STATE);
  const quiet = !state.formError && !state.notice && Object.keys(state.fieldErrors).length === 0;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">{SETTINGS.contactsHeading}</h2>
        <p id="contacts-hint" className="text-muted-foreground text-sm">
          {SETTINGS.contactsHint}
        </p>
      </div>

      {/* Two columns at 1280, one at 375 — nothing overflows at either width. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          id="contactEmail"
          label={SETTINGS.contactEmailLabel}
          hint={SETTINGS.contactEmailHint}
          placeholder={SETTINGS.contactEmailPlaceholder}
          defaultValue={contacts.email ?? ''}
          maxLength={MAX_CONTACT_EMAIL_CHARS}
          /**
           * `type="text"`, not `type="email"`. The auth forms keep `noValidate`
           * for exactly this reason (SPEC Block F): the browser's native bubble
           * fires first and would pre-empt `contactEmailInvalid`, which is the
           * string this app promises. The server re-validates regardless, and
           * that is the gate.
           */
          autoComplete="email"
          error={state.fieldErrors.contactEmail}
        />
        <Field
          id="phone"
          label={SETTINGS.phoneLabel}
          placeholder={SETTINGS.phonePlaceholder}
          defaultValue={contacts.phone ?? ''}
          maxLength={MAX_PHONE_CHARS}
          autoComplete="tel"
          error={state.fieldErrors.phone}
        />
        <Field
          id="location"
          label={SETTINGS.locationLabel}
          placeholder={SETTINGS.locationPlaceholder}
          defaultValue={contacts.location ?? ''}
          maxLength={MAX_LOCATION_CHARS}
          autoComplete="address-level2"
          error={state.fieldErrors.location}
        />
        <Field
          id="linkedinUrl"
          label={SETTINGS.linkedinLabel}
          hint={SETTINGS.linkHint}
          placeholder={SETTINGS.linkPlaceholder}
          defaultValue={contacts.linkedin ?? ''}
          maxLength={MAX_LINK_CHARS}
          autoComplete="url"
          error={state.fieldErrors.linkedinUrl}
        />
        <Field
          id="githubUrl"
          label={SETTINGS.githubLabel}
          placeholder={SETTINGS.linkPlaceholder}
          defaultValue={contacts.github ?? ''}
          maxLength={MAX_LINK_CHARS}
          autoComplete="url"
          error={state.fieldErrors.githubUrl}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="openToRemote" className="flex items-center gap-2 text-sm font-medium">
          <input
            id="openToRemote"
            name="openToRemote"
            type="checkbox"
            defaultChecked={contacts.openToRemote}
            className="accent-primary size-4"
            aria-describedby="openToRemote-hint"
          />
          {SETTINGS.openToRemoteLabel}
        </label>
        <p id="openToRemote-hint" className="text-muted-foreground pl-6 text-xs">
          {SETTINGS.openToRemoteHint}
        </p>
      </div>

      <Button type="submit" variant="outline" className="self-start" disabled={pending}>
        {pending ? SETTINGS.contactsSaving : SETTINGS.contactsSave}
      </Button>

      {/*
        The read failed, shown before the user touches anything: the fields below
        are blank for a reason they cannot otherwise see. Saving still works — the
        write is a separate round trip — so the copy says so rather than implying
        the form is dead. Suppressed once the form has an answer of its own, which
        is newer information.
      */}
      {readFailed && quiet ? (
        <p role="alert" className="text-destructive text-sm">
          {SETTINGS.contactsLoadFailed}
        </p>
      ) : null}
      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
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

/** One labelled optional field, with its own inline error. */
function Field({
  id,
  label,
  hint,
  error,
  ...input
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
} & React.ComponentProps<'input'>) {
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      <Input
        id={id}
        name={id}
        type="text"
        aria-describedby={hintId}
        aria-invalid={error ? true : undefined}
        {...input}
      />
      {error ? (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
