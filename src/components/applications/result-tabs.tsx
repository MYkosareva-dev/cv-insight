'use client';

import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RESULT, SCAN } from '@/lib/copy';
import type { CoverageEntry, CoverageStatus, KeywordRow, ParsedVacancy } from '@/lib/db/types';

/**
 * The result screen's tabs (SPEC Block E, US-2 steps 3–4 and US-3).
 *
 * Analysis · Base matches · Vacancy. The Tailored-resume tab is Phase 4 —
 * `resume_versions` has no rows and no editor exists, so a fourth tab would be
 * an empty promise (declared in SPEC v2.12).
 *
 * Everything rendered here comes from the STORED coverage map, which is what
 * makes the screen honest about time: the score, the statuses, the item titles
 * and the keyword counts were all measured in the same run (edge case D4). No
 * career item is joined live and no chunk text was ever sent to the browser —
 * retrieved chunks are data for a model call, never echoed to the client
 * (CLAUDE.md, Retrieval).
 *
 * A client component only for the tab state and the clipboard.
 */
export function ResultTabs({
  entries,
  keywords,
  parsed,
  rawText,
  sourceIsBase,
}: {
  entries: CoverageEntry[];
  keywords: KeywordRow[];
  /** The vacancy parse, for the Vacancy tab's requirement list. */
  parsed: ParsedVacancy | null;
  rawText: string;
  /** True when the scan's own source WAS the career base. */
  sourceIsBase: boolean;
}) {
  return (
    <Tabs defaultValue="analysis">
      <TabsList>
        <TabsTrigger value="analysis">{RESULT.tabAnalysis}</TabsTrigger>
        <TabsTrigger value="base">{RESULT.tabBaseMatches}</TabsTrigger>
        <TabsTrigger value="vacancy">{RESULT.tabVacancy}</TabsTrigger>
      </TabsList>

      <TabsContent value="analysis">
        <div className="flex flex-col gap-8">
          <CoverageTable entries={entries} />
          <KeywordTable keywords={keywords} />
        </div>
      </TabsContent>

      <TabsContent value="base">
        <BaseMatches entries={entries} sourceIsBase={sourceIsBase} />
      </TabsContent>

      <TabsContent value="vacancy">
        <VacancyTab parsed={parsed} rawText={rawText} />
      </TabsContent>
    </Tabs>
  );
}

const STATUS_LABEL: Record<CoverageStatus, string> = {
  covered: RESULT.statusCovered,
  gap_in_resume_covered_by_base: RESULT.statusBaseOnly,
  gap: RESULT.statusGap,
};

/** Requirement | Must/Nice | Status | Best match + similarity % (Block E). */
function CoverageTable({ entries }: { entries: CoverageEntry[] }) {
  if (entries.length === 0) {
    // N4: the parse ran and the posting stated no requirements. Said in words,
    // because an empty table reads as "nothing is missing".
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {SCAN.noRequirements}
      </p>
    );
  }

  return (
    // Wide content scrolls inside its own box; the page never scrolls sideways.
    <div className="overflow-x-auto">
      <table className="w-full min-w-160 text-left text-sm">
        <thead className="text-muted-foreground text-xs uppercase">
          <tr>
            <th scope="col" className="py-2 pr-3 font-medium">
              {RESULT.colRequirement}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {RESULT.colKind}
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              {RESULT.colStatus}
            </th>
            <th scope="col" className="py-2 font-medium">
              {RESULT.colBestMatch}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => (
            <tr key={`${entry.requirement}-${index}`} className="border-border border-t">
              <td className="py-2 pr-3">{entry.requirement}</td>
              <td className="py-2 pr-3">
                <Badge variant={entry.kind === 'must' ? 'accent' : 'default'}>
                  {entry.kind === 'must' ? RESULT.kindMust : RESULT.kindNice}
                </Badge>
              </td>
              <td className="py-2 pr-3">
                <StatusBadge status={entry.status} />
              </td>
              <td className="text-muted-foreground py-2">
                {entry.careerItemTitle ?? RESULT.statusGap} · {percent(entry.similarity)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: CoverageStatus }) {
  return (
    <Badge variant={status === 'covered' ? 'primary' : status === 'gap' ? 'default' : 'accent'}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Keyword | In resume | In vacancy, sorted by GAP first (Block E: "sortable by
 * gap" — the default order is the one worth looking at).
 */
function KeywordTable({ keywords }: { keywords: KeywordRow[] }) {
  if (keywords.length === 0) return null;
  const sorted = [...keywords].sort(
    (a, b) => b.inVacancy - b.inResume - (a.inVacancy - a.inResume),
  );

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{RESULT.categoryKeywords}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-96 text-left text-sm">
          <thead className="text-muted-foreground text-xs uppercase">
            <tr>
              <th scope="col" className="py-2 pr-3 font-medium">
                {RESULT.colKeyword}
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                {RESULT.colInResume}
              </th>
              <th scope="col" className="py-2 font-medium">
                {RESULT.colInVacancy}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.keyword} className="border-border border-t">
                <td className="py-2 pr-3">{row.keyword}</td>
                <td className={`py-2 pr-3 ${row.inResume === 0 ? 'text-destructive' : ''}`}>
                  {row.inResume}
                </td>
                <td className="py-2">{row.inVacancy}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * US-3: requirements the career base covers but the SOURCE resume does not.
 *
 * Each card names the career item the match came from — which is the whole point
 * of the tab — and carries the similarity that was measured. It does NOT carry a
 * phrased bullet: US-3 step 3's "ready-to-insert bullet" needs either a model
 * call or the chunk text itself, and neither is available to this phase (the
 * first is a spend nobody asked for, the second may not reach the client).
 * Deferred to Phase 4 with the editor, and declared.
 */
function BaseMatches({
  entries,
  sourceIsBase,
}: {
  entries: CoverageEntry[];
  sourceIsBase: boolean;
}) {
  if (sourceIsBase) {
    // Not an empty state: for this scan the status cannot exist, because the
    // base was the source. `RESULT.noHiddenMatches` would claim the resume
    // already uses everything relevant, which is a different (and unmeasured)
    // statement.
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {RESULT.baseIsSource}
      </p>
    );
  }

  const hidden = entries.filter((entry) => entry.status === 'gap_in_resume_covered_by_base');
  if (hidden.length === 0) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {RESULT.noHiddenMatches}
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {hidden.map((entry, index) => (
        <BaseMatchCard key={`${entry.requirement}-${index}`} entry={entry} />
      ))}
    </div>
  );
}

function BaseMatchCard({ entry }: { entry: CoverageEntry }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(entry.requirement);
      setCopied(true);
      toast.success(RESULT.copied);
    } catch {
      // A denied clipboard permission or an insecure context. Told, not swallowed.
      toast.error(RESULT.copyFailed);
    }
  }

  return (
    <article className="border-border flex flex-col gap-2 rounded-lg border p-4">
      <p className="text-sm font-medium">{entry.requirement}</p>
      {entry.careerItemTitle ? (
        <p className="text-muted-foreground text-sm">{RESULT.foundInItem(entry.careerItemTitle)}</p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <Badge variant="primary">{percent(entry.similarity)}</Badge>
        {/*
          Labelled for what it DOES. `RESULT.addToResume` is US-3 step 4's
          promise to insert the bullet into the tailored-resume editor, and that
          editor arrives in Phase 4 — reusing the label now would name an action
          the app does not perform.
        */}
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? RESULT.copied : RESULT.copyBullet}
        </Button>
      </div>
    </article>
  );
}

/** Raw posting (collapsed) + the parsed requirement list (Block E). */
function VacancyTab({ parsed, rawText }: { parsed: ParsedVacancy | null; rawText: string }) {
  return (
    <div className="flex flex-col gap-6">
      {parsed && parsed.requirements.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{RESULT.vacancyParsedHeading}</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {parsed.requirements.map((requirement, index) => (
              <li key={`${requirement.text}-${index}`} className="flex items-start gap-2">
                <Badge variant={requirement.kind === 'must' ? 'accent' : 'default'}>
                  {requirement.kind === 'must' ? RESULT.kindMust : RESULT.kindNice}
                </Badge>
                <span>{requirement.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <details className="border-border rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {RESULT.vacancyRawHeading}
        </summary>
        {/*
          A React text node, never dangerouslySetInnerHTML: a posting containing
          <script> or HTML is rendered literally (edge case S2).
        */}
        <pre className="mt-3 text-sm break-words whitespace-pre-wrap">{rawText}</pre>
      </details>
    </div>
  );
}

const percent = (similarity: number) => `${Math.round(similarity * 100)}%`;
