'use client';

export type SentimentFilter = 'all' | 'positive' | 'negative';

type Props = {
  positiveCount: number;
  negativeCount: number;
  neutralCount: number;
  activeFilter: SentimentFilter;
  onFilterChange: (filter: SentimentFilter) => void;
};

/** Share of positive reviews among the ones that took a side, as whole percentages that always add up to 100. */
export function verdictPercentages(positive: number, negative: number): { positive: number; negative: number } | null {
  const opinionated = positive + negative;
  if (opinionated === 0) return null;
  const positivePct = Math.round((positive / opinionated) * 100);
  return { positive: positivePct, negative: 100 - positivePct };
}

/** Live verdict for a search: a green/red split bar with the exact ratio, and All / Positives / Negatives filter pills. */
export function SentimentVerdictBar({ positiveCount, negativeCount, neutralCount, activeFilter, onFilterChange }: Props) {
  const total = positiveCount + negativeCount + neutralCount;
  const split = verdictPercentages(positiveCount, negativeCount);
  const summary = split
    ? `${split.positive}% Positive • ${split.negative}% Negative across ${total} ${total === 1 ? 'review' : 'reviews'}`
    : `No clear verdict yet • ${total} ${total === 1 ? 'review' : 'reviews'}`;

  const pills: { id: SentimentFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: total },
    { id: 'positive', label: 'Positives', count: positiveCount },
    { id: 'negative', label: 'Negatives', count: negativeCount },
  ];

  return (
    <section aria-label="Review verdict" className="rounded-3xl border border-white/15 bg-white/[0.07] p-4 shadow-[0_8px_30px_rgba(0,0,0,0.4)] backdrop-blur-xl">
      <p className="text-sm font-semibold text-white">{summary}</p>
      {split && neutralCount > 0 && <p className="mt-0.5 text-xs text-white/60">{neutralCount} neutral not counted in the split</p>}

      <div role="img" aria-label={summary} className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-white/10">
        {split && (
          <>
            <div className="h-full bg-emerald-400" style={{ width: `${split.positive}%` }} />
            <div className="h-full bg-rose-400" style={{ width: `${split.negative}%` }} />
          </>
        )}
      </div>

      <div role="group" aria-label="Filter reviews" className="mt-4 flex flex-wrap gap-2">
        {pills.map((pill) => {
          const on = activeFilter === pill.id;
          return (
            <button
              key={pill.id}
              type="button"
              aria-pressed={on}
              onClick={() => onFilterChange(pill.id)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 motion-reduce:transition-none ${
                on ? 'bg-white text-[#0A0A0A]' : 'border border-white/15 bg-white/10 text-white/85 hover:bg-white/15'
              }`}
            >
              {pill.label} <span className="tabular-nums opacity-70">{pill.count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
