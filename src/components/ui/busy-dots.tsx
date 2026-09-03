/**
 * Three pulsing dots, for a button that will be busy long enough to worry
 * someone (SPEC v2.17).
 *
 * `aria-hidden`, and that is the whole accessibility story here: this is
 * decoration for the eye. The BUTTON already carries the state a screen reader
 * needs — the label changes to "Generating" and `disabled` is announced — so
 * reading three dots out would add noise, not information.
 *
 * The motion lives in `globals.css` next to its reduced-motion fallback, because
 * a media query is not something a Tailwind class can express here and the
 * fallback is the half that would otherwise be forgotten.
 *
 * No state, no handlers, no dependency: it renders the same in a server or a
 * client tree.
 */
export function BusyDots() {
  return (
    <span className="cv-dots" aria-hidden>
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
