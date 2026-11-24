'use client';

import type { CameraKit, CameraKitSession, Lens } from '@snap/camera-kit';

export type SnapLensItem = {
  id: string;
  groupId: string;
  name: string;
  iconUrl?: string;
  snapcodeUrl?: string;
  vendorData?: Record<string, string>;
};

const CACHE_KEY = 'vybe_snap_lens_catalog_v1';

class SnapCameraKitAdapter {
  private kit: CameraKit | null = null;
  private session: CameraKitSession | null = null;
  private lensMap = new Map<string, Lens>();
  private catalog: SnapLensItem[] = [];
  private initPromise: Promise<SnapLensItem[]> | null = null;
  private boundStream: MediaStream | null = null;
  private activeLensId: string | null = null;
  private isPlaying = false;

  isConfigured(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(
      process.env.NEXT_PUBLIC_SNAP_CAMERA_KIT_TOKEN &&
        process.env.NEXT_PUBLIC_SNAP_LENS_GROUP_ID
    );
  }

  getCachedCatalog(): SnapLensItem[] {
    if (this.catalog.length > 0) return this.catalog;
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SnapLensItem[];
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  }

  async initialize(): Promise<SnapLensItem[]> {
    if (typeof window === 'undefined' || !this.isConfigured()) return [];
    if (this.catalog.length > 0) return this.catalog;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const apiToken = process.env.NEXT_PUBLIC_SNAP_CAMERA_KIT_TOKEN!;
        const groupId = process.env.NEXT_PUBLIC_SNAP_LENS_GROUP_ID!;
        const { bootstrapCameraKit } = await import('@snap/camera-kit');

        const kit = await bootstrapCameraKit({ apiToken });
        this.kit = kit;

        const session = await kit.createSession();
        session.mute(true);
        session.events.addEventListener('error', (evt) => {
          console.warn('[SnapCameraKit] Session error:', evt.detail?.error);
        });
        this.session = session;

        const { lenses } = await kit.lensRepository.loadLensGroups([groupId]);
        this.lensMap.clear();
        const items: SnapLensItem[] = lenses.map((lens) => {
          this.lensMap.set(lens.id, lens);
          return {
            id: lens.id,
            groupId: lens.groupId || groupId,
            name: lens.name || 'Snap Lens',
            iconUrl: lens.iconUrl,
            snapcodeUrl: lens.snapcode?.imageUrl,
            vendorData: lens.vendorData,
          };
        });

        this.catalog = items;
        try {
          window.localStorage.setItem(CACHE_KEY, JSON.stringify(items));
        } catch {
          // ignore quota errors
        }
        return items;
      } catch (err) {
        console.warn('[SnapCameraKit] Init failed:', err);
        this.initPromise = null;
        return [];
      }
    })();

    return this.initPromise;
  }

  async attachStream(stream: MediaStream | null, facing: 'user' | 'environment'): Promise<void> {
    if (!this.session || !stream || typeof window === 'undefined') return;
    if (this.boundStream === stream) return;
    try {
      const { createMediaStreamSource, Transform2D } = await import('@snap/camera-kit');
      const source = createMediaStreamSource(stream, {
        cameraType: facing,
        transform: Transform2D.Identity,
        disableSourceAudio: true,
      });
      await this.session.setSource(source);
      this.boundStream = stream;
      if (this.activeLensId && !this.isPlaying) {
        await this.session.play('live');
        this.isPlaying = true;
      }
    } catch (err) {
      console.warn('[SnapCameraKit] attachStream failed:', err);
    }
  }

  async preloadAdjacent(activeIndex: number): Promise<void> {
    if (!this.kit || this.catalog.length === 0) return;
    const indices = [activeIndex - 1, activeIndex, activeIndex + 1].filter(
      (i) => i >= 0 && i < this.catalog.length
    );
    const toCache = indices
      .map((i) => this.lensMap.get(this.catalog[i].id))
      .filter((l): l is Lens => Boolean(l));

    if (toCache.length === 0) return;
    try {
      await this.kit.lensRepository.cacheLensContent(toCache, ['required']);
    } catch {
      // non-fatal preload failure
    }
  }

  async applyLens(lensId: string, stream: MediaStream | null, facing: 'user' | 'environment'): Promise<boolean> {
    if (!this.session || !this.kit) {
      await this.initialize();
    }
    if (!this.session || !this.kit) return false;

    const lens = this.lensMap.get(lensId);
    if (!lens) return false;

    try {
      await this.attachStream(stream, facing);
      if (!this.isPlaying) {
        await this.session.play('live');
        this.isPlaying = true;
      }
      const applied = await this.session.applyLens(lens);
      if (applied) this.activeLensId = lensId;
      return applied;
    } catch (err) {
      console.warn('[SnapCameraKit] applyLens failed:', err);
      return false;
    }
  }

  async clearLens(): Promise<void> {
    this.activeLensId = null;
    if (!this.session) return;
    try {
      await this.session.removeLens();
      if (this.isPlaying) {
        await this.session.pause('live');
        this.isPlaying = false;
      }
    } catch {
      // ignore cleanup errors
    }
  }

  getOutputCanvas(): HTMLCanvasElement | null {
    if (!this.session || !this.activeLensId || !this.isPlaying) return null;
    return this.session.output.live;
  }

  getActiveLensId(): string | null {
    return this.activeLensId;
  }
}

export const snapCameraKitAdapter = new SnapCameraKitAdapter();
