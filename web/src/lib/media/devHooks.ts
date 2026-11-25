/** Development-only: adds a named tool to `window.__vybeMedia` without replacing what other modules registered. */
export function registerVybeMedia(name: string, tool: unknown): void {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return;
  const w = window as unknown as { __vybeMedia?: Record<string, unknown> };
  w.__vybeMedia = { ...w.__vybeMedia, [name]: tool };
}
