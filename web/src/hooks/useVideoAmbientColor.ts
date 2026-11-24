'use client';
import { useEffect, type RefObject } from 'react';

const SAMPLE_MS = 600;
const SIZE = 8;
export const FALLBACK_RGB = '165 180 252';

/** The average of an 8x8 sample, pushed towards saturation so dull frames still give a usable tint. */
export function accentFromPixels(data: Uint8ClampedArray): string {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  }
  if (n === 0) return FALLBACK_RGB;
  [r, g, b] = [r / n, g / n, b / n];
  const mean = (r + g + b) / 3;
  const boost = (c: number) => Math.round(Math.min(255, Math.max(40, mean + (c - mean) * 1.8 + 30)));
  return `${boost(r)} ${boost(g)} ${boost(b)}`;
}

/**
 * Writes the active video's dominant colour into `--feed-accent-rgb` on `targetRef`, so glass tints and glows follow
 * the video (green forest, pink set, blue night). Writes `fallback` when there is no readable frame: a 3D post,
 * a paused tab, or a cross-origin video without CORS (the canvas is tainted and reading it throws).
 */
export function useVideoAmbientColor(targetRef: RefObject<HTMLElement | null>, scopeRef: RefObject<HTMLElement | null>, activeId: string | undefined, fallback: string): void {
  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;
    target.style.setProperty('--feed-accent-rgb', fallback);
    if (!activeId) return;
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    const sample = () => {
      const video = scopeRef.current?.querySelector<HTMLVideoElement>(`[data-post-id="${CSS.escape(activeId)}"] video`);
      if (!video || video.readyState < 2 || document.hidden) return;
      try {
        ctx.drawImage(video, 0, 0, SIZE, SIZE);
        target.style.setProperty('--feed-accent-rgb', accentFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data));
      } catch {
        target.style.setProperty('--feed-accent-rgb', fallback);
      }
    };
    sample();
    const id = window.setInterval(sample, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [targetRef, scopeRef, activeId, fallback]);
}
