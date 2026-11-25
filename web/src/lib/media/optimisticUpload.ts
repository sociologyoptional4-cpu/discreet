/**
 * Local-first upload queue: a clip shows up instantly from a local Blob URL while it is optimised and uploaded in the
 * background. Every job is saved (IndexedDB in the browser) before any work starts, so closing the tab does not lose
 * it: `resume()` picks it up again, skipping the already-finished processing step. Framework-agnostic, no app imports.
 */

export type UploadStatus = 'processing' | 'uploading' | 'published' | 'failed';

export interface UploadDraft {
  id: string;
  caption: string;
  /** Plays at once, straight from the recording. */
  localVideoUrl: string;
  /** Set when the thumbnail has been made. */
  localThumbnailUrl: string | null;
  status: UploadStatus;
  /** 0..100 across processing (first 60) and upload (last 40). */
  progress: number;
  error: string | null;
  attempts: number;
}

export interface PendingRecord<M> {
  id: string;
  stage: 'raw' | 'processed';
  video: Blob;
  thumbnail: Blob | null;
  meta: M;
  caption: string;
  attempts: number;
  createdAt: number;
}

export interface PendingStorage<M> {
  put(record: PendingRecord<M>): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<PendingRecord<M>[]>;
}

/** Throw this from a pipeline for errors that will not go away by trying again (validation, quota). */
export class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface UploadPipeline<M> {
  process(video: Blob, meta: M, ctx: { onProgress: (percent: number) => void; signal: AbortSignal }): Promise<{ video: Blob; thumbnail: Blob | null }>;
  publish(job: { id: string; video: Blob; thumbnail: Blob | null; meta: M }, ctx: { onProgress: (fraction: number) => void; signal: AbortSignal }): Promise<void>;
}

export interface QueueOptions {
  maxAttempts?: number;
  retryDelayMs?: (attempt: number) => number;
  /** How long a finished draft stays visible before it is removed. Default 2500 ms. */
  settleMs?: number;
  sleep?: (ms: number) => Promise<void>;
  randomId?: () => string;
  urls?: { create: (blob: Blob) => string; revoke: (url: string) => void };
}

type Listener = (drafts: UploadDraft[]) => void;

const PROCESS_SHARE = 60;

export function createMemoryStorage<M>(): PendingStorage<M> {
  const records = new Map<string, PendingRecord<M>>();
  return {
    put: async (record) => void records.set(record.id, record),
    delete: async (id) => void records.delete(id),
    list: async () => [...records.values()],
  };
}

const request = <T>(req: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

/** IndexedDB storage; falls back to memory where IndexedDB is missing or blocked (private mode, old WebViews). */
export function createPersistentStorage<M>(dbName = 'vybe-pending-uploads'): PendingStorage<M> {
  const memory = createMemoryStorage<M>();
  let db: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    db ??= new Promise((resolve, reject) => {
      const opening = indexedDB.open(dbName, 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('pending', { keyPath: 'id' });
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    return db;
  };
  const store = async (mode: IDBTransactionMode) => (await open()).transaction('pending', mode).objectStore('pending');
  const available = typeof indexedDB !== 'undefined';
  return {
    async put(record) {
      if (!available) return memory.put(record);
      try { await request((await store('readwrite')).put(record)); } catch { await memory.put(record); }
    },
    async delete(id) {
      await memory.delete(id);
      if (!available) return;
      try { await request((await store('readwrite')).delete(id)); } catch { /* nothing stored */ }
    },
    async list() {
      const fromMemory = await memory.list();
      if (!available) return fromMemory;
      try {
        const stored = (await request((await store('readonly')).getAll())) as PendingRecord<M>[];
        return [...stored, ...fromMemory.filter((m) => !stored.some((s) => s.id === m.id))];
      } catch {
        return fromMemory;
      }
    },
  };
}

export class UploadQueue<M> {
  private readonly drafts = new Map<string, UploadDraft>();
  private readonly records = new Map<string, PendingRecord<M>>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Set<Listener>();
  private chain: Promise<void> = Promise.resolve();
  private readonly maxAttempts: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly settleMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly randomId: () => string;
  private readonly urls: NonNullable<QueueOptions['urls']>;
  private readonly pipeline: UploadPipeline<M>;
  private readonly storage: PendingStorage<M>;

  constructor(pipeline: UploadPipeline<M>, storage: PendingStorage<M>, options: QueueOptions = {}) {
    this.pipeline = pipeline;
    this.storage = storage;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.retryDelayMs = options.retryDelayMs ?? ((attempt) => Math.min(30_000, 1000 * 2 ** (attempt - 1)));
    this.settleMs = options.settleMs ?? 2500;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.randomId = options.randomId ?? (() => crypto.randomUUID());
    this.urls = options.urls ?? { create: (blob) => URL.createObjectURL(blob), revoke: (url) => URL.revokeObjectURL(url) };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getAll());
    return () => void this.listeners.delete(listener);
  }

  getAll(): UploadDraft[] {
    return [...this.drafts.values()];
  }

  /** Saves the clip, shows it at once and starts working on it. Resolves with the job id as soon as it is safe on disk. */
  async enqueue(video: Blob, meta: M, caption: string): Promise<string> {
    const record: PendingRecord<M> = { id: this.randomId(), stage: 'raw', video, thumbnail: null, meta, caption, attempts: 0, createdAt: Date.now() };
    await this.storage.put(record);
    this.adopt(record);
    this.schedule(record.id);
    return record.id;
  }

  /** Picks up jobs left behind by an earlier page load (closed tab, crash, no network). Safe to call more than once. */
  async resume(): Promise<void> {
    for (const record of await this.storage.list()) {
      if (this.records.has(record.id)) continue;
      this.adopt(record);
      this.schedule(record.id);
    }
  }

  /** Tries a failed job again from where it stopped. */
  retry(id: string): void {
    const record = this.records.get(id);
    if (!record || this.drafts.get(id)?.status !== 'failed') return;
    this.records.set(id, { ...record, attempts: 0 });
    this.patch(id, { status: record.stage === 'raw' ? 'processing' : 'uploading', error: null, attempts: 0 });
    this.schedule(id);
  }

  /** Abandons a job and forgets it, including its saved copy. */
  async cancel(id: string): Promise<void> {
    this.controllers.get(id)?.abort();
    await this.storage.delete(id);
    this.forget(id);
  }

  private adopt(record: PendingRecord<M>): void {
    this.records.set(record.id, record);
    this.drafts.set(record.id, {
      id: record.id,
      caption: record.caption,
      localVideoUrl: this.urls.create(record.video),
      localThumbnailUrl: record.thumbnail ? this.urls.create(record.thumbnail) : null,
      status: record.stage === 'raw' ? 'processing' : 'uploading',
      progress: record.stage === 'raw' ? 2 : PROCESS_SHARE,
      error: null,
      attempts: record.attempts,
    });
    this.emit();
  }

  private schedule(id: string): void {
    this.chain = this.chain.then(() => this.run(id)).catch(() => undefined);
  }

  private async run(id: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(id, controller);
    try {
      for (;;) {
        const record = this.records.get(id);
        if (!record || controller.signal.aborted) return;
        try {
          if (record.stage === 'raw') {
            this.patch(id, { status: 'processing', error: null });
            const processed = await this.pipeline.process(record.video, record.meta, {
              signal: controller.signal,
              onProgress: (percent) => this.patch(id, { progress: Math.round((percent / 100) * PROCESS_SHARE) }),
            });
            const next: PendingRecord<M> = { ...record, stage: 'processed', video: processed.video, thumbnail: processed.thumbnail };
            await this.storage.put(next);
            this.records.set(id, next);
            const old = this.drafts.get(id)?.localThumbnailUrl;
            if (old) this.urls.revoke(old);
            this.patch(id, { localThumbnailUrl: processed.thumbnail ? this.urls.create(processed.thumbnail) : null, progress: PROCESS_SHARE });
          }
          const ready = this.records.get(id)!;
          this.patch(id, { status: 'uploading', error: null });
          await this.pipeline.publish({ id, video: ready.video, thumbnail: ready.thumbnail, meta: ready.meta }, {
            signal: controller.signal,
            onProgress: (fraction) => this.patch(id, { progress: Math.round(PROCESS_SHARE + fraction * (100 - PROCESS_SHARE)) }),
          });
          await this.storage.delete(id);
          this.patch(id, { status: 'published', progress: 100, error: null });
          void this.sleep(this.settleMs).then(() => this.forget(id));
          return;
        } catch (error) {
          if (controller.signal.aborted || (error as { name?: string } | null)?.name === 'AbortError') return;
          const attempts = (this.records.get(id)?.attempts ?? 0) + 1;
          const message = error instanceof Error ? error.message : 'Upload failed.';
          const current = this.records.get(id);
          if (current) {
            const updated = { ...current, attempts };
            this.records.set(id, updated);
            await this.storage.put(updated);
          }
          if (error instanceof NonRetryableError || attempts >= this.maxAttempts) {
            this.patch(id, { status: 'failed', error: message, attempts });
            return;
          }
          this.patch(id, { error: `${message} Retrying…`, attempts });
          await this.sleep(this.retryDelayMs(attempts));
        }
      }
    } finally {
      this.controllers.delete(id);
    }
  }

  private patch(id: string, patch: Partial<UploadDraft>): void {
    const draft = this.drafts.get(id);
    if (!draft) return;
    this.drafts.set(id, { ...draft, ...patch });
    this.emit();
  }

  private forget(id: string): void {
    const draft = this.drafts.get(id);
    if (draft) {
      this.urls.revoke(draft.localVideoUrl);
      if (draft.localThumbnailUrl) this.urls.revoke(draft.localThumbnailUrl);
    }
    this.drafts.delete(id);
    this.records.delete(id);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getAll();
    for (const listener of this.listeners) listener(snapshot);
  }
}
