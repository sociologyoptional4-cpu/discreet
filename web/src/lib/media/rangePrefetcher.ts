/**
 * Adaptive HTTP byte-range prefetcher. Framework-agnostic: no React, no path aliases, no app imports.
 *
 * It warms the browser's HTTP cache with the first few hundred KB of upcoming videos (`Range: bytes=0-N`), so a
 * `<video>` that later requests the same URL starts from cache. The video must be a "faststart" MP4 (moov atom first),
 * and the host must answer ranges with `206 Partial Content`, allow the `Range` header in CORS, and send a long
 * `Cache-Control` so the cached bytes stay valid. Measured in Chromium against Cloudflare R2: first data in about
 * 20 ms with a prefetch versus 540-810 ms cold.
 */

export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  /** Downlink estimate in Mbps. */
  downlink?: number;
}

export interface PrefetchConfig {
  /** Bytes to fetch on fast connections. Default 512 KB (the moov atom plus about 1.7 s of video at 2.2 Mbps). */
  fastChunkBytes?: number;
  /** Bytes to fetch on slow (3G-like) connections. Default 256 KB. */
  slowChunkBytes?: number;
  /** Simultaneous background fetches. Default 2. */
  maxConcurrent?: number;
  /** URLs remembered as warm (LRU). Default 60. */
  maxCacheEntries?: number;
  /** Only URLs for which this returns true are fetched (for example "our own CORS-enabled media host"). */
  allowUrl?: (url: string) => boolean;
  /** How long a URL that failed is left alone. Default 30 s. */
  failureCooldownMs?: number;
  /** Longest a fetch may be held back by the pause gate before it goes ahead anyway. Default 4 s. */
  maxPauseMs?: number;
  /** How often a held-back queue re-checks the pause gate. Default 250 ms. */
  gatePollMs?: number;
  /** Injection points for tests and non-browser hosts. */
  fetchImpl?: typeof fetch;
  getNetwork?: () => NetworkInformationLike | undefined;
  now?: () => number;
}

export interface PrefetchStats {
  prefetchedCount: number;
  abortedCount: number;
  failedCount: number;
  totalBytesFetched: number;
  inFlightCount: number;
  queuedCount: number;
}

interface InFlightTask {
  controller: AbortController;
}

const DEFAULT_FAST_BYTES = 512 * 1024;
const DEFAULT_SLOW_BYTES = 256 * 1024;
const SLOW_DOWNLINK_MBPS = 1.5;

/** Reads `bytes <start>-<end>/<total>` from a Content-Range header. */
function parseContentRange(value: string | null): { start: number; end: number; total: number | null } | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(value?.trim() ?? '');
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: match[3] === '*' ? null : Number(match[3]) };
}

export class ByteRangePrefetcher {
  private readonly fastChunkBytes: number;
  private readonly slowChunkBytes: number;
  private readonly maxConcurrent: number;
  private readonly maxCacheEntries: number;
  private readonly failureCooldownMs: number;
  private readonly maxPauseMs: number;
  private readonly gatePollMs: number;
  private readonly allowUrl?: (url: string) => boolean;
  private readonly fetchImpl?: typeof fetch;
  private readonly getNetwork?: () => NetworkInformationLike | undefined;
  private readonly now: () => number;

  /** Warm URLs, oldest first (a Set keeps insertion order, so re-adding makes an entry the newest). */
  private readonly completed = new Set<string>();
  private readonly inFlight = new Map<string, InFlightTask>();
  private readonly failedUntil = new Map<string, number>();
  /** Hosts that answered a range request with a full 200: asking them again only wastes bandwidth. */
  private readonly noRangeOrigins = new Set<string>();
  private queue: string[] = [];
  private pauseGate: (() => boolean) | null = null;
  private heldSince: number | null = null;
  private gateTimer: ReturnType<typeof setTimeout> | null = null;
  private stats = { prefetchedCount: 0, abortedCount: 0, failedCount: 0, totalBytesFetched: 0 };

  constructor(config: PrefetchConfig = {}) {
    this.fastChunkBytes = config.fastChunkBytes ?? DEFAULT_FAST_BYTES;
    this.slowChunkBytes = config.slowChunkBytes ?? DEFAULT_SLOW_BYTES;
    this.maxConcurrent = Math.max(1, config.maxConcurrent ?? 2);
    this.maxCacheEntries = Math.max(10, config.maxCacheEntries ?? 60);
    this.failureCooldownMs = config.failureCooldownMs ?? 30_000;
    this.maxPauseMs = config.maxPauseMs ?? 4_000;
    this.gatePollMs = config.gatePollMs ?? 250;
    this.allowUrl = config.allowUrl;
    this.fetchImpl = config.fetchImpl;
    this.getNetwork = config.getNetwork;
    this.now = config.now ?? (() => Date.now());
  }

  /**
   * While the gate returns true, no new fetch starts, so background work never competes with the video that is
   * playing right now. A gate cannot hold the queue longer than `maxPauseMs`.
   */
  public setPauseGate(gate: (() => boolean) | null): void {
    this.pauseGate = gate;
  }

  /** 0 means "do not prefetch": Data Saver, 2G, offline or a hidden tab. */
  private chunkSize(): number {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return 0;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0;
    const connection = this.getNetwork ? this.getNetwork() : typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
    if (!connection) return this.fastChunkBytes;
    if (connection.saveData) return 0;
    if (connection.effectiveType === 'slow-2g' || connection.effectiveType === '2g') return 0;
    if (connection.effectiveType === '3g' || (typeof connection.downlink === 'number' && connection.downlink > 0 && connection.downlink < SLOW_DOWNLINK_MBPS)) return this.slowChunkBytes;
    return this.fastChunkBytes;
  }

  /**
   * Sets the URLs to keep warm, most useful first. Anything in flight or queued that is not in this list is dropped
   * (aborted if running), so a fast swipe never spends bandwidth on videos the viewer already skipped. An empty list
   * cancels everything.
   */
  public prefetchWindow(urls: readonly string[]): void {
    const wanted = [...new Set(urls)].filter((url) => url.length > 0 && (!this.allowUrl || this.allowUrl(url)));
    const keep = new Set(wanted);

    for (const [url, task] of this.inFlight) {
      if (!keep.has(url)) {
        task.controller.abort();
        this.inFlight.delete(url);
        this.stats.abortedCount += 1;
      }
    }

    const size = this.chunkSize();
    if (size <= 0) {
      this.abortAll();
      return;
    }

    const now = this.now();
    this.queue = wanted.filter((url) => !this.completed.has(url) && !this.inFlight.has(url) && (this.failedUntil.get(url) ?? 0) <= now && !this.noRangeOrigins.has(this.originOf(url)));
    this.heldSince = null;
    this.drain();
  }

  private originOf(url: string): string {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  }

  private drain(): void {
    if (this.gateTimer) {
      clearTimeout(this.gateTimer);
      this.gateTimer = null;
    }
    while (this.queue.length > 0 && this.inFlight.size < this.maxConcurrent) {
      if (this.pauseGate && this.pauseGate()) {
        const now = this.now();
        this.heldSince ??= now;
        if (now - this.heldSince < this.maxPauseMs) {
          this.gateTimer = setTimeout(() => this.drain(), this.gatePollMs);
          return;
        }
      }
      const url = this.queue.shift();
      if (!url || this.completed.has(url) || this.inFlight.has(url)) continue;
      const size = this.chunkSize();
      if (size <= 0) return;
      this.start(url, size);
    }
  }

  private start(url: string, size: number): void {
    const controller = new AbortController();
    const task: InFlightTask = { controller };
    this.inFlight.set(url, task);
    void this.run(url, size, controller).finally(() => {
      // Only remove our own entry: the same URL may have been aborted and started again in the meantime.
      if (this.inFlight.get(url) === task) this.inFlight.delete(url);
      this.drain();
    });
  }

  private async run(url: string, size: number, controller: AbortController): Promise<void> {
    const doFetch = this.fetchImpl ?? fetch;
    try {
      const response = await doFetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'force-cache',
        headers: { Range: `bytes=0-${size - 1}` },
        signal: controller.signal,
      });

      if (response.status !== 206 && response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        this.fail(url);
        return;
      }

      // Cross-origin, JavaScript sees only safelisted response headers: Content-Length yes, Content-Range only if the
      // host lists it in Access-Control-Expose-Headers. So 206 plus Content-Length is the check; Content-Range is a bonus.
      const declared = Number(response.headers.get('content-length') ?? NaN);
      const expected = Number.isFinite(declared) ? declared : null;
      const range = response.status === 206 ? parseContentRange(response.headers.get('content-range')) : null;
      if (range && range.start !== 0) {
        await response.body?.cancel().catch(() => undefined);
        this.fail(url);
        return;
      }

      // A 200 means the server ignored Range and is sending the whole file. Stop right away and remember the host,
      // unless the whole file is small enough to be the range we asked for anyway.
      if (response.status === 200 && expected !== null && expected > size) {
        await this.rejectNoRange(url, response);
        return;
      }

      // Read the body to the end so the browser commits the bytes to its HTTP cache, but keep none of them.
      let received = 0;
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (response.status === 200 && expected === null && received >= size) {
            await reader.cancel().catch(() => undefined);
            this.noRangeOrigins.add(this.originOf(url));
            this.fail(url);
            return;
          }
        }
      } else {
        received = (await response.arrayBuffer()).byteLength;
      }
      const wanted = expected ?? (range ? range.end - range.start + 1 : null);
      if (received === 0 || (wanted !== null && received < wanted)) {
        this.fail(url);
        return;
      }
      this.stats.totalBytesFetched += received;
      this.stats.prefetchedCount += 1;
      this.markCompleted(url);
    } catch (error) {
      if ((error as { name?: string } | null)?.name !== 'AbortError') this.fail(url);
    }
  }

  private async rejectNoRange(url: string, response: Response): Promise<void> {
    this.noRangeOrigins.add(this.originOf(url));
    await response.body?.cancel().catch(() => undefined);
    this.fail(url);
  }

  private fail(url: string): void {
    this.stats.failedCount += 1;
    this.failedUntil.set(url, this.now() + this.failureCooldownMs);
  }

  private markCompleted(url: string): void {
    this.completed.delete(url);
    this.completed.add(url);
    if (this.completed.size > this.maxCacheEntries) {
      const oldest = this.completed.values().next().value;
      if (oldest !== undefined) this.completed.delete(oldest);
    }
  }

  /** True once the first range of this URL was fully fetched (and so is very likely in the HTTP cache). */
  public isPrefetched(url: string): boolean {
    return this.completed.has(url);
  }

  public abortAll(): void {
    for (const task of this.inFlight.values()) {
      task.controller.abort();
      this.stats.abortedCount += 1;
    }
    this.inFlight.clear();
    this.queue = [];
    if (this.gateTimer) {
      clearTimeout(this.gateTimer);
      this.gateTimer = null;
    }
  }

  public getStats(): PrefetchStats {
    return { ...this.stats, inFlightCount: this.inFlight.size, queuedCount: this.queue.length };
  }
}

let shared: ByteRangePrefetcher | null = null;

/** One prefetcher for the whole page, created on first use. */
export function getFeedPrefetcher(config?: PrefetchConfig): ByteRangePrefetcher {
  shared ??= new ByteRangePrefetcher(config);
  return shared;
}
