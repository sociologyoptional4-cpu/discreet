export type UpscaleMode = 'auto' | 'on' | 'off' | 'split';

/**
 * Reads `?upscale=` from a query string. `on` forces the upscaler even for sharp sources, `off` disables it,
 * `split` forces it and shows upscaled | native side by side. Anything else is `auto`. Works on a phone, no dev tools needed.
 */
export function readUpscaleMode(search: string): UpscaleMode {
  const value = new URLSearchParams(search).get('upscale');
  return value === 'on' || value === 'off' || value === 'split' ? value : 'auto';
}
