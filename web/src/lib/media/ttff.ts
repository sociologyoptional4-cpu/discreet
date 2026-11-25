/**
 * Development-only "time to first frame" meter: how long a slide takes from becoming the active one until its video
 * reports `playing`, and whether the range prefetcher had warmed it. Does nothing in production builds.
 */
export interface TtffSample {
  id: string;
  ms: number;
  prefetched: boolean;
}

const enabled = process.env.NODE_ENV !== 'production';
const pending = new Map<string, number>();
const samples: TtffSample[] = [];
const MAX_SAMPLES = 100;

export function markSlideActive(id: string): void {
  if (enabled && typeof performance !== 'undefined') pending.set(id, performance.now());
}

/** Records the first `playing` after `markSlideActive`; later `playing` events (loops, stalls) are ignored. */
export function recordFirstFrame(id: string, prefetched: boolean): void {
  if (!enabled) return;
  const start = pending.get(id);
  if (start === undefined) return;
  pending.delete(id);
  samples.push({ id, ms: Math.round(performance.now() - start), prefetched });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export function getTtffSamples(): readonly TtffSample[] {
  return samples;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

export function summarizeTtff(): { prefetched: { count: number; medianMs: number | null }; cold: { count: number; medianMs: number | null } } {
  const warm = samples.filter((s) => s.prefetched).map((s) => s.ms);
  const cold = samples.filter((s) => !s.prefetched).map((s) => s.ms);
  return { prefetched: { count: warm.length, medianMs: median(warm) }, cold: { count: cold.length, medianMs: median(cold) } };
}
