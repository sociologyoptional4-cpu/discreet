import {
  injectLivingPostSecurity,
  isTrustedLivingHtmlUrl,
  validateLivingPostHtml,
} from './livingPostValidator.ts';

const MAX_CACHE_ENTRIES = 24;
const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function remember(url: string, html: string): void {
  if (cache.has(url)) cache.delete(url);
  cache.set(url, html);
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function getCachedLivingHtml(url: string): string | undefined {
  return cache.get(url);
}

/**
 * Fetches, security-validates, hardens, and caches a Living Post HTML document from R2.
 */
export async function fetchLivingHtml(url: string, signal?: AbortSignal): Promise<string> {
  if (!isTrustedLivingHtmlUrl(url)) {
    throw new Error('Untrusted Living Post URL');
  }
  const hit = cache.get(url);
  if (hit) {
    remember(url, hit);
    return hit;
  }

  let pending = inflight.get(url);
  if (!pending) {
    pending = fetch(url, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load Living Post (${res.status})`);
        return res.text();
      })
      .then((raw) => {
        const secured = injectLivingPostSecurity(raw, { studioPreview: false });
        const check = validateLivingPostHtml(secured);
        if (!check.ok) throw new Error(check.errors[0] || 'Unsafe Living Post HTML');
        remember(url, secured);
        return secured;
      })
      .finally(() => {
        inflight.delete(url);
      });
    inflight.set(url, pending);
  }

  return pending;
}

/** Warms up upcoming Living Post `.html` slides in the background. */
export function prefetchLivingHtml(url: string): void {
  if (!isTrustedLivingHtmlUrl(url) || cache.has(url) || inflight.has(url)) return;
  void fetchLivingHtml(url).catch(() => {});
}
