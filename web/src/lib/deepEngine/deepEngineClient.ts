'use client';

import { loadDeepEngineState, saveDeepEngineState } from '@/lib/deepEngine/deepEngineStore';
import { HebbianVibeGraph } from '@/lib/deepEngine/hebbianGraph';
import { MarkovActionPredictor, type UserActionState } from '@/lib/deepEngine/markovPredictor';
import { triggerMicroHaptic } from '@/lib/deepEngine/microHaptics';
import { computeMicroSignalReward, type MicroSignalInput } from '@/lib/deepEngine/microSignals';
import { RotatingBloomFilter } from '@/lib/deepEngine/rotatingBloom';
import { supabase } from '@/lib/supabase';

const FLUSH_EVERY_SWIPES = 10;

class DeepEngineRuntime {
  public readonly bloom = new RotatingBloomFilter();
  public readonly markov = new MarkovActionPredictor();
  public readonly hebbian = new HebbianVibeGraph();

  private initialized = false;
  private swipesSinceFlush = 0;
  private lastActiveTag: string | null = null;
  private prefetchedProfiles = new Set<string>();
  private prefetchedComments = new Set<string>();

  // Passive velocity tracking (refs only — zero React state)
  private entryVelocityPxMs = 0;
  private exitVelocityPxMs = 0;
  private heldScreen = false;

  public init(): () => void {
    if (typeof window === 'undefined') return () => {};
    if (!this.initialized) {
      this.initialized = true;
      void loadDeepEngineState().then((persisted) => {
        if (persisted.bloom) this.bloom.importState(persisted.bloom);
        if (persisted.markov) this.markov.importState(persisted.markov);
        if (persisted.hebbian) this.hebbian.importState(persisted.hebbian);
      });
    }

    const onVisibility = () => {
      if (document.hidden) void this.flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void this.flush();
    };
  }

  public async flush(): Promise<void> {
    this.swipesSinceFlush = 0;
    await saveDeepEngineState({
      bloom: this.bloom.exportState(),
      markov: this.markov.exportState(),
      hebbian: this.hebbian.exportState(),
    });
  }

  public setTouchMetrics(metrics: {
    entryVelocityPxMs?: number;
    exitVelocityPxMs?: number;
    heldScreen?: boolean;
  }): void {
    if (metrics.entryVelocityPxMs !== undefined) this.entryVelocityPxMs = metrics.entryVelocityPxMs;
    if (metrics.exitVelocityPxMs !== undefined) this.exitVelocityPxMs = metrics.exitVelocityPxMs;
    if (metrics.heldScreen !== undefined) this.heldScreen = metrics.heldScreen;
  }

  public consumeTouchMetrics(): {
    entryVelocityPxMs: number;
    exitVelocityPxMs: number;
    heldScreen: boolean;
  } {
    const snap = {
      entryVelocityPxMs: this.entryVelocityPxMs,
      exitVelocityPxMs: this.exitVelocityPxMs,
      heldScreen: this.heldScreen,
    };
    this.entryVelocityPxMs = this.exitVelocityPxMs;
    this.exitVelocityPxMs = 0;
    this.heldScreen = false;
    return snap;
  }

  public onSlideSettled(
    postId: string,
    tag: string | null | undefined,
    creatorUsername: string | null | undefined,
    action: UserActionState = 'SWIPE_NEXT',
  ): void {
    triggerMicroHaptic('swipe_snap');
    this.bloom.add(postId);
    this.markov.record(action);
    if (tag) this.lastActiveTag = tag;

    const prediction = this.markov.predictNext(0.55);
    if (prediction) {
      this.speculativePrefetch(prediction.action, postId, creatorUsername ?? null);
    }

    this.swipesSinceFlush++;
    if (this.swipesSinceFlush >= FLUSH_EVERY_SWIPES) {
      void this.flush();
    }
  }

  public onSlideFinished(input: {
    tag: string | null | undefined;
    watchMs: number;
    durationMs: number;
    openedComments?: boolean;
  }): number {
    const touch = this.consumeTouchMetrics();
    const loops = input.durationMs > 0 ? input.watchMs / input.durationMs : 0;
    const afkDetected = loops > 2.5 && !touch.heldScreen && touch.exitVelocityPxMs === 0;

    const microInput: MicroSignalInput = {
      watchMs: input.watchMs,
      durationMs: input.durationMs,
      activeLoops: Math.floor(loops),
      entryVelocityPxMs: touch.entryVelocityPxMs,
      exitVelocityPxMs: touch.exitVelocityPxMs,
      openedComments: Boolean(input.openedComments),
      heldScreen: touch.heldScreen,
      afkDetected,
    };

    const reward = computeMicroSignalReward(microInput);
    if (input.tag) {
      this.hebbian.observe(input.tag, reward);
    }
    return reward;
  }

  public getHebbianBoost(candidateTag: string | null | undefined): number {
    if (!this.lastActiveTag || !candidateTag) return 0;
    return this.hebbian.getAffinityBoost(this.lastActiveTag, candidateTag);
  }

  private speculativePrefetch(
    action: UserActionState,
    postId: string,
    creatorUsername: string | null,
  ): void {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData === true) return;

    if (action === 'OPEN_PROFILE' && creatorUsername && !this.prefetchedProfiles.has(creatorUsername)) {
      this.prefetchedProfiles.add(creatorUsername);
      void fetch(`/api/users/${encodeURIComponent(creatorUsername)}`, { credentials: 'omit' }).catch(() => {});
    } else if (action === 'OPEN_COMMENTS' && !this.prefetchedComments.has(postId)) {
      this.prefetchedComments.add(postId);
      void Promise.resolve(
        supabase
          .from('post_comments')
          .select('id')
          .eq('post_id', postId)
          .limit(20),
      ).catch(() => {});
    }
  }
}

export const deepEngine = new DeepEngineRuntime();
