import { NO_SCORE, RESULT } from '@/lib/copy';
import { SCORE_BAND_VAR, scoreBand } from '@/lib/scoring';

/**
 * The Match Rate ring and the score chip (SPEC Block E).
 *
 * Both take the ALREADY-DECIDED score: `renderableScore()` in lib/scoring.ts
 * owns the "is there a number to show" question, so the list and the detail
 * screen cannot disagree about one row ("Same rule everywhere a score renders").
 * A null renders `NO_SCORE` — never a 0, which would be the app reporting a
 * measurement it did not take (rule B1b, edge case N4).
 *
 * Server components: no interactivity, so no `'use client'` and no JavaScript
 * shipped for either.
 */

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ScoreRing({ score }: { score: number | null }) {
  const colour = score === null ? 'var(--text-muted)' : SCORE_BAND_VAR[scoreBand(score)];
  // A null score draws no arc at all. A 0-length arc for "unknown" and for
  // "zero" would look identical, and only one of them is a measurement.
  const filled = score === null ? 0 : (score / 100) * CIRCUMFERENCE;

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 120" className="size-32" role="img" aria-label={RESULT.matchRate}>
        <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--border)" strokeWidth="10" />
        {score === null ? null : (
          <circle
            cx="60"
            cy="60"
            r={RADIUS}
            fill="none"
            stroke={colour}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
            // Start at twelve o'clock rather than three.
            transform="rotate(-90 60 60)"
          />
        )}
        <text
          x="60"
          y="60"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="26"
          fontWeight="600"
          fill={colour}
        >
          {score === null ? NO_SCORE : `${score}%`}
        </text>
      </svg>
      <p className="text-sm font-medium">{RESULT.matchRate}</p>
    </div>
  );
}

/** The same rule, chip-sized, for the `/applications` table. */
export function ScoreChip({ score }: { score: number | null }) {
  const colour = score === null ? 'var(--text-muted)' : SCORE_BAND_VAR[scoreBand(score)];
  return (
    <span
      className="inline-flex min-w-12 items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ color: colour, backgroundColor: 'var(--bg-subtle)', border: `1px solid ${colour}` }}
    >
      {score === null ? NO_SCORE : `${score}%`}
    </span>
  );
}
