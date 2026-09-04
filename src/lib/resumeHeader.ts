/**
 * The resume's contact header block (SPEC v2.20, Phase-5 owner feedback).
 *
 * PURE, and deliberately NOT `server-only`, for the reason that moved
 * `lib/pricing.ts`, `lib/budget.ts` and `lib/judge.ts`: `tests/` is in scope for
 * check.mjs R6, so anything a unit test has to reach cannot sit behind the gates.
 * This module decides what goes at the top of a document the user sends to an
 * employer, and getting a field order or a collapse rule wrong is exactly the
 * kind of thing a test should hold still. Nothing here reads a secret, a request
 * or the database.
 *
 * WHY THE APP BUILDS THIS BLOCK AND NOT THE MODEL. The contact details are the
 * one part of a resume where a paraphrase is a defect: a reformatted phone
 * number, a shortened URL or a "helpfully" corrected address is a document that
 * reaches the wrong person or nobody. P2 is a WRITER — it compresses and rewrites
 * by instruction — so handing it six values to reproduce character for character
 * is asking the wrong party. It is told not to write contact details at all, and
 * the block is composed here from the profile row.
 *
 * WHERE THE BLOCK GOES, AND WHERE IT MUST NOT GO (owner decision, v2.21).
 *
 * It is inserted into the resume version that is STORED, so the editor shows it,
 * the .docx carries it, and the user can edit it — the header is part of their
 * resume, not a decoration the app owns.
 *
 * IT NEVER REACHES A MODEL. Neither writing a bullet nor judging whether a claim
 * is grounded depends on a phone number, so sending the block to OpenRouter would
 * widen the set of personal data leaving to a third party for no gain — the
 * opposite of data minimisation. So the header is added AFTER the judge has
 * spoken, and any text on its way to a model goes through `resumeTextForModel`
 * first, which takes it back out of a stored version that carries it inline.
 *
 * The DISPLAY NAME is the exception and stays: P2 rule 4's layout needs a name
 * line, an invented one is what v2.17 was raised for, and it travels sanitised
 * and inside a tagged `<candidate_name>` block.
 */

/**
 * The profile's contact fields, normalised: every absent, blank or
 * not-yet-migrated value is `null`, and `openToRemote` is a plain boolean because
 * the only rendering difference is a line that appears or does not.
 */
export type ResumeContacts = {
  email: string | null;
  phone: string | null;
  location: string | null;
  linkedin: string | null;
  github: string | null;
  openToRemote: boolean;
};

export const EMPTY_CONTACTS: ResumeContacts = {
  email: null,
  phone: null,
  location: null,
  linkedin: null,
  github: null,
  openToRemote: false,
};

/** A stored value, or null. Blank and whitespace-only collapse to null. */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/**
 * A `profiles` row — or the absence of one — as contacts.
 *
 * THE ARGUMENT IS DELIBERATELY LOOSE (`undefined` fields allowed) because that is
 * the shape reality hands over: `select('*')` on a database where
 * `005_profile_contacts.sql` has not been applied returns a row with none of
 * these keys, and a null profile is what a user who has never saved anything
 * has. Both mean "no contact details", the app works with all of them empty, and
 * this is the single place that says so.
 */
export function contactsOf(
  profile: {
    contact_email?: string | null;
    phone?: string | null;
    linkedin_url?: string | null;
    github_url?: string | null;
    location?: string | null;
    open_to_remote?: boolean | null;
  } | null,
): ResumeContacts {
  if (!profile) return EMPTY_CONTACTS;
  return {
    email: text(profile.contact_email),
    phone: text(profile.phone),
    location: text(profile.location),
    linkedin: text(profile.linkedin_url),
    github: text(profile.github_url),
    // null — "the user has not said" — renders exactly like false. The
    // distinction is kept in the column so the field can round-trip a blank
    // checkbox; it has no third rendering.
    openToRemote: profile.open_to_remote === true,
  };
}

export function hasAnyContact(contacts: ResumeContacts): boolean {
  return contactLines(contacts).length > 0;
}

/**
 * Every saved contact value as a flat list — what must never reach a model, and
 * what the export checks the document for.
 *
 * `OPEN_TO_REMOTE` is in it because the phrase is a value the app prints, not a
 * label it renders: a header line can consist of nothing else.
 */
export function contactValues(contacts: ResumeContacts): string[] {
  return [
    contacts.email,
    contacts.phone,
    contacts.location,
    contacts.linkedin,
    contacts.github,
    contacts.openToRemote ? OPEN_TO_REMOTE : null,
  ].filter((field): field is string => field !== null);
}

/**
 * The separator between contact fields on one line.
 *
 * EXPORTED, because `lib/docx.ts` needs it: `isHeading` refuses a line that
 * contains it, so a location typed in capitals is not bolded as a section
 * heading. A second copy of the character over there would have meant changing
 * the separator here silently disabled that guard.
 */
export const FIELD_SEPARATOR = ' · ';

/**
 * The header block, as lines, in the order a recruiter reads them.
 *
 * TWO LINES AT MOST, grouped by what the reader is looking for: how to reach you,
 * then where to read more about you.
 *
 *   Line 1  email · phone · location · Open to remote
 *   Line 2  linkedin · github
 *
 * ABSENT FIELDS COLLAPSE WITHOUT LEAVING EMPTY LINES, which is the requirement
 * this function exists to satisfy and the one a naive template gets wrong: an
 * empty value must take its separator with it, and a group whose every member is
 * absent must take its whole LINE with it. A profile with nothing but a GitHub
 * URL yields exactly one line, and an empty profile yields none — not two blank
 * ones under the name.
 *
 * "Open to remote" sits with the location because that is the question it
 * answers. It is a phrase and not a field label, so it reads as part of the same
 * line rather than as a form.
 *
 * The URLs go in as TEXT, exactly as stored. They are never wrapped in markup
 * here and never turned into a link by any caller — the .docx writes plain runs
 * and the editor is a textarea, so there is no anchor for a scheme to be
 * smuggled into. The Zod boundary has already refused anything but `https://`.
 */
export function contactLines(contacts: ResumeContacts): string[] {
  const reach = [
    contacts.email,
    contacts.phone,
    contacts.location,
    contacts.openToRemote ? OPEN_TO_REMOTE : null,
  ].filter((field): field is string => field !== null);

  const links = [contacts.linkedin, contacts.github].filter(
    (field): field is string => field !== null,
  );

  return [reach, links]
    .filter((group) => group.length > 0)
    .map((group) => group.join(FIELD_SEPARATOR));
}

/**
 * The phrase, not a label. Exported so `lib/copy.ts` stays the only other place
 * user-facing words live and this one has a single definition — it is printed
 * INTO a document rather than rendered by a component, which is why it is here
 * with the composition rather than there with the UI strings.
 */
export const OPEN_TO_REMOTE = 'Open to remote';

/**
 * Put the contact block into a generated resume, under the name and target title.
 *
 * WHERE, EXACTLY: immediately before the FIRST BLANK LINE. P2 rule 4 asks for
 * "NAME, TARGET TITLE, SUMMARY (3 lines max), EXPERIENCE, …" as a plain-text
 * layout, so the first blank line is the end of the name-and-title header and the
 * start of the body — which is precisely where a reader expects the contacts and
 * where an ATS parser looks for them. Inserting after the NAME line alone was the
 * first attempt and it reads wrong: it puts the phone number between the person's
 * name and the role they are applying for.
 *
 * With no blank line anywhere (a one-paragraph answer, which a model can return),
 * the block goes after the first line and takes a blank line with it, so the
 * document still has a header rather than a name welded to a summary.
 *
 * NOTHING IS INSERTED when there are no contact details, and the text comes back
 * byte for byte — the app works with an empty profile, and this is the line that
 * makes that true rather than a claim.
 *
 * IT DOES NOT INSERT TWICE. If the first contact line is already in the text, the
 * text is returned unchanged: a regenerate, a re-export or a second call on the
 * same string must not stack two headers, and comparing the line the app is about
 * to write is a cheaper and more honest test than a marker comment the user could
 * delete while editing.
 */
export function withContactHeader(content: string, contacts: ResumeContacts): string {
  const lines = contactLines(contacts);
  if (lines.length === 0) return content;
  if (content.includes(lines[0]!)) return content;

  const rows = content.split('\n');
  const blank = rows.findIndex((row, index) => index > 0 && row.trim().length === 0);

  if (blank === -1) {
    // No header/body boundary to find: give the block one.
    return [rows[0] ?? '', ...lines, '', ...rows.slice(1)].join('\n');
  }
  return [...rows.slice(0, blank), ...lines, ...rows.slice(blank)].join('\n');
}

// ---------------------------------------------------------------------------
// The model boundary (owner decision, v2.21)
// ---------------------------------------------------------------------------

/**
 * Characters that may sit BETWEEN contact fields on a header line and belong to
 * no field's value: the block's own separator, the ones a user is likely to type
 * when editing it by hand, and whitespace.
 *
 * Used only to decide whether a line is NOTHING BUT contact fields. The values
 * are removed from the line first, so a comma inside "Hamburg, Germany" goes with
 * the value it belongs to rather than being treated as a separator.
 */
const HEADER_GLUE = /[·•|,;/\\\-–—()\s]/gu;

/** A line that consists of saved contact values and glue, and nothing else. */
function isContactOnlyLine(line: string, values: readonly string[]): boolean {
  if (line.trim().length === 0) return false;
  let rest = line;
  for (const value of values) rest = rest.split(value).join('');
  return rest.replace(HEADER_GLUE, '').length === 0;
}

/**
 * A stored resume with its contact header taken back out.
 *
 * LINE-BASED, AND THE SCOPE IS STATED RATHER THAN OVERSOLD. What this removes is
 * the app's own header: a line made of nothing but saved contact values and the
 * glue between them, whether the app composed it or the user has since edited,
 * reordered or split it. What it does NOT do is redact a value that also appears
 * inside a sentence — a career item that says "Nordlicht Digital, Hamburg" keeps
 * saying it, and that text was already going to the model as a career item long
 * before this feature existed. The claim is therefore exact: the app stops ADDING
 * contact details to a model payload. It does not, and cannot, promise that a
 * city name the user wrote into their own history will not appear in one.
 *
 * A BLANK LINE LEFT BEHIND IS REMOVED TOO, but only where the block was: two
 * blank lines in a row after the cut become one, so the text the judge reads has
 * the shape the model wrote rather than a gap where the header stood. Blank lines
 * elsewhere are untouched — they are the document's own paragraph breaks.
 *
 * Pure, and it returns the input unchanged when there are no saved contacts,
 * which is the state most users are in.
 */
export function stripContactHeader(content: string, contacts: ResumeContacts): string {
  const values = contactValues(contacts);
  if (values.length === 0) return content;

  const rows = content.split('\n');
  const kept: string[] = [];
  let cut = false;
  for (const row of rows) {
    if (isContactOnlyLine(row, values)) {
      cut = true;
      continue;
    }
    // Collapse the gap the removed line left, and only that gap.
    if (cut && row.trim().length === 0 && kept[kept.length - 1]?.trim().length === 0) {
      cut = false;
      continue;
    }
    cut = false;
    kept.push(row);
  }
  return kept.join('\n');
}

declare const MODEL_TEXT: unique symbol;

/**
 * Resume text that has been through `resumeTextForModel`, as a TYPE.
 *
 * "Prove it, do not assert it" — this is the half a comment cannot do. Every
 * parameter that carries resume text to a model is declared as this type, and the
 * only function that produces one is the strip below, so a caller handing a model
 * the raw contents of a stored version is a BUILD ERROR rather than a defect
 * nobody notices. A branded string, so it costs nothing at runtime.
 */
export type ModelResumeText = string & { readonly [MODEL_TEXT]: true };

/**
 * The only way to obtain resume text a model may see.
 *
 * Applied at every such call site, including the ones whose text cannot carry a
 * header today: the generate pipeline judges the model's own output, which the app
 * has not touched yet — and routing it through here anyway is what keeps the
 * guarantee true if the header insertion is ever moved back in front of the judge.
 */
export function resumeTextForModel(
  content: string,
  contacts: ResumeContacts,
): ModelResumeText {
  return stripContactHeader(content, contacts) as ModelResumeText;
}
