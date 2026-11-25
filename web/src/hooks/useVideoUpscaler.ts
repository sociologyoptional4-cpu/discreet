'use client';
import { useEffect, useState, type RefObject } from 'react';
import { getFeedUpscaler, optionsForMode } from '@/lib/media/feedUpscaler';
import { readUpscaleMode } from '@/lib/media/upscaleMode';
import type { BypassReason } from '@/lib/media/videoUpscaler';

type Params = {
  video: HTMLVideoElement | null;
  /** The element the video lives in; the shared upscale canvas is placed right after it. */
  host: RefObject<HTMLElement | null>;
  active: boolean;
};

/**
 * Upscales the active slide's video. Only the playing card ever holds the shared canvas; everything else shows its
 * native <video>. If the upscaler bypasses itself (sharp source, no CORS, dropped frames) the canvas hides again.
 */
export function useVideoUpscaler({ video, host, active }: Params): { upscaling: boolean; bypassReason: BypassReason | null } {
  const [result, setResult] = useState<{ video: HTMLVideoElement; live: boolean; reason: BypassReason | null } | null>(null);

  useEffect(() => {
    const hostEl = host.current;
    if (!video || !hostEl || !active) return;
    const mode = readUpscaleMode(window.location.search);
    if (mode === 'off') return;
    const shared = getFeedUpscaler();
    if (!shared) return;

    shared.engine.updateOptions(optionsForMode(mode));
    shared.canvas.style.opacity = '0';
    hostEl.appendChild(shared.canvas);
    const attached = shared.engine.attach(video, {
      onFirstFrame: () => {
        shared.canvas.style.opacity = '1';
        setResult({ video, live: true, reason: null });
      },
      onBypass: (reason) => {
        shared.canvas.style.opacity = '0';
        setResult({ video, live: false, reason });
      },
    });
    if (!attached) hostEl.removeChild(shared.canvas);
    return () => {
      shared.engine.detach();
      shared.canvas.style.opacity = '0';
      if (shared.canvas.parentNode === hostEl) hostEl.removeChild(shared.canvas);
    };
  }, [video, host, active]);

  const current = result && result.video === video ? result : null;
  return { upscaling: !!current?.live, bypassReason: current?.reason ?? null };
}
