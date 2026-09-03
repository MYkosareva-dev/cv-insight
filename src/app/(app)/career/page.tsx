import { FolderKanban } from 'lucide-react';

import { CareerItemCard } from '@/components/career/career-item-card';
import { ImportResumeDialog } from '@/components/career/import-resume-dialog';
import { CAREER, CAREER_ITEM_TYPE_LABEL, CAREER_ITEM_TYPE_ORDER } from '@/lib/copy';
import { listCareerItems } from '@/lib/db/careerItems';
import { listImports } from '@/lib/db/imports';
import type { CareerItem, Import } from '@/lib/db/types';

export const metadata = { title: 'Career base — CV Insight' };

/**
 * `/career` — SPEC Block E, US-1.
 *
 * A Server Component: the list is read through the DAL under the user's own
 * session, so RLS scopes it to `auth.uid()` and no ownership filter appears in
 * this file. The member layout has already verified the session with getUser().
 *
 * Block E's three mandatory states live in three places, which is worth naming
 * because only one of them is visible here:
 *   - LOADING  → `loading.tsx` beside this file. An awaited query in a Server
 *                Component renders nothing at all until it resolves, so the
 *                skeleton has to be a Suspense fallback rather than a branch in
 *                this function.
 *   - EMPTY    → the `items.length === 0` branch below, with the exact copy.
 *   - ERROR    → a throw from the DAL reaches `app/error.tsx`; the import
 *                dialog renders its OWN inline errors, which is what Block E
 *                asks for ("Error (import failed): inline in dialog").
 */
export default async function CareerPage() {
  /**
   * Two reads, resolved together, rather than one embedded join.
   *
   * `listCareerItems()` and `listImports()` each stay inside their own DAL, which
   * is what "one DAL per table" means in practice — a nested PostgREST select
   * would put a second table's shape inside the `career_items` DAL. The join is
   * a Map built here, over at most 200 items and a handful of imports.
   */
  const [items, imports] = await Promise.all([listCareerItems(), listImports()]);
  const importsById = new Map(imports.map((row) => [row.id, row]));

  return (
    <section className="flex flex-col gap-6">
      {/* Wraps at 375 px instead of pushing the button off-screen. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Career base</h1>
          <p className="text-muted-foreground text-sm">{CAREER.itemCount(items.length)}</p>
        </div>
        <ImportResumeDialog itemCount={items.length} importCount={imports.length} />
      </header>

      {items.length === 0 ? (
        <EmptyState importCount={imports.length} />
      ) : (
        <GroupedItems items={items} importsById={importsById} />
      )}
    </section>
  );
}

/**
 * Block E: illustration + copy + [Import resume].
 *
 * Both strings render, not just the body: US-1 step 1 shows the heading "Your
 * career base is empty" and Block E gives the longer sentence, so dropping
 * either would leave a SPEC-enumerated constant dead in copy.ts.
 */
function EmptyState({ importCount }: { importCount: number }) {
  return (
    <div className="border-border flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <FolderKanban className="size-6" aria-hidden />
      </div>
      <h2 className="text-lg font-medium">{CAREER.emptyTitle}</h2>
      <p className="text-muted-foreground max-w-prose text-sm">{CAREER.emptyBody}</p>
      <ImportResumeDialog itemCount={0} importCount={importCount} />
    </div>
  );
}

/** Cards grouped by type, in the Block E group order. */
function GroupedItems({
  items,
  importsById,
}: {
  items: CareerItem[];
  importsById: Map<string, Import>;
}) {
  const groups = CAREER_ITEM_TYPE_ORDER.map((type) => ({
    type,
    label: CAREER_ITEM_TYPE_LABEL[type],
    items: items.filter((item) => item.type === type),
  })).filter((group) => group.items.length > 0);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <div key={group.type} className="flex flex-col gap-3">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {group.label} · {group.items.length}
          </h2>
          {/* One column at 375 px, two from md — nothing overflows at either. */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {group.items.map((item) => (
              <CareerItemCard
                key={item.id}
                item={item}
                source={item.import_id ? (importsById.get(item.import_id) ?? null) : null}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
