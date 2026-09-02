/**
 * Phase-0 placeholder. Every route in the SPEC routes table exists and is
 * reachable; the real screens (with their three mandatory states) land in the
 * feature phases.
 */
export function Placeholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      <p className="border-border bg-muted text-muted-foreground w-fit rounded-md border px-3 py-2 text-xs">
        Placeholder — built in {phase}.
      </p>
    </section>
  );
}
