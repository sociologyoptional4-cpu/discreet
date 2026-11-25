import { registerVybeMedia } from '@/lib/media/devHooks';
import { isWebGL2UpscalerSupported, RealTimeVideoUpscaler, type UpscalerOptions } from '@/lib/media/videoUpscaler';
import type { UpscaleMode } from '@/lib/media/upscaleMode';

type Shared = { canvas: HTMLCanvasElement; engine: RealTimeVideoUpscaler };

let shared: Shared | null | undefined;

/**
 * One canvas and one WebGL context for the whole feed. Phones allow very few contexts (the 3D scenes need one too),
 * so the canvas is moved into whichever card is playing instead of each card owning its own.
 */
export function getFeedUpscaler(): Shared | null {
  if (shared !== undefined) return shared;
  if (typeof document === 'undefined' || !isWebGL2UpscalerSupported()) return (shared = null);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.feedUpscaler = '';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 120ms';
  const engine = new RealTimeVideoUpscaler(canvas);
  if (!engine.canRun) return (shared = null);
  shared = { canvas, engine };
  registerVybeMedia('upscaler', {
    stats: () => engine.getStats(),
    /** Left of x (0..1) is upscaled, the rest is native-looking. 1 shows only the upscaled image. */
    setSplit: (x: number) => engine.updateOptions({ split: x, force: true }),
    update: (patch: UpscalerOptions) => engine.updateOptions(patch),
  });
  return shared;
}

/** Engine options for a mode, always complete so a previous mode never leaks into the next. */
export function optionsForMode(mode: UpscaleMode): UpscalerOptions {
  return { force: mode === 'on' || mode === 'split', split: mode === 'split' ? 0.5 : 1 };
}
