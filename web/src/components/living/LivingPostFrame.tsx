'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchLivingHtml, getCachedLivingHtml } from '@/lib/living/livingHtmlCache';
import { injectLivingPostSecurity } from '@/lib/living/livingPostValidator';

export interface LivingPostFrameProps {
  html?: string | null;
  livingHtmlUrl?: string | null;
  thumbnailUrl?: string | null;
  isActive: boolean;
  studioPreview?: boolean;
  prompt?: string;
  postId?: string;
  onIframeElement?: (el: HTMLIFrameElement | null) => void;
  onRuntimeError?: (error: string) => void;
  className?: string;
}

/**
 * Captures a `.webp` thumbnail Blob directly from a Studio preview `<canvas>` via `VYBE_CAPTURE_THUMB`.
 * Returns `null` if the canvas is empty or the iframe doesn't respond within `timeoutMs`.
 */
export function captureLivingThumbnail(
  iframe: HTMLIFrameElement | null,
  timeoutMs = 700,
): Promise<Blob | null> {
  if (!iframe?.contentWindow) return Promise.resolve(null);

  return new Promise((resolve) => {
    let done = false;
    const finish = (blob: Blob | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve(blob);
    };

    const onMsg = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (!event.data || event.data.type !== 'VYBE_THUMB_RESULT') return;
      const dataUrl = typeof event.data.dataUrl === 'string' ? event.data.dataUrl : '';
      const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
      if (!match) {
        finish(null);
        return;
      }
      try {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        finish(new Blob([bytes], { type: match[1] || 'image/webp' }));
      } catch {
        finish(null);
      }
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMsg);
    iframe.contentWindow?.postMessage({ type: 'VYBE_CAPTURE_THUMB' }, '*');
  });
}

function PosterLayer({
  thumbnailUrl,
  hidden,
}: {
  thumbnailUrl?: string | null;
  hidden: boolean;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${
        hidden ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-950 via-violet-950/70 to-black text-xs font-medium text-white/65">
          <Sparkles aria-hidden className="size-5 text-violet-300" />
          <span>Interactive Living World</span>
        </div>
      )}
    </div>
  );
}

function ActiveLivingMount({
  html,
  livingHtmlUrl,
  thumbnailUrl,
  studioPreview = false,
  prompt,
  postId,
  onIframeElement,
  onRuntimeError,
}: Omit<LivingPostFrameProps, 'isActive' | 'className'>) {
  const localIframeRef = useRef<HTMLIFrameElement | null>(null);
  const setIframeNode = (el: HTMLIFrameElement | null) => {
    localIframeRef.current = el;
    onIframeElement?.(el);
  };

  const inlineSecured = useMemo(
    () => (html ? injectLivingPostSecurity(html, { studioPreview }) : null),
    [html, studioPreview],
  );

  const cachedRemote = useMemo(
    () => (!inlineSecured && livingHtmlUrl ? getCachedLivingHtml(livingHtmlUrl) ?? null : null),
    [inlineSecured, livingHtmlUrl],
  );

  const [fetchedHtml, setFetchedHtml] = useState<string | null>(null);
  const [settled, setSettled] = useState(studioPreview);
  const [ready, setReady] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [crashedInFeed, setCrashedInFeed] = useState(false);

  const resolvedHtml = inlineSecured ?? cachedRemote ?? fetchedHtml;

  // 120ms swipe settle delay in /feed so rapid swipes do not boot an iframe mid-fling
  useEffect(() => {
    if (studioPreview) return;
    const id = window.setTimeout(() => setSettled(true), 120);
    return () => window.clearTimeout(id);
  }, [studioPreview]);

  // Fetch remote R2 .html if not already warm in cache
  useEffect(() => {
    if (inlineSecured || cachedRemote || !livingHtmlUrl) return;
    const ctrl = new AbortController();
    fetchLivingHtml(livingHtmlUrl, ctrl.signal)
      .then((secured) => {
        if (!ctrl.signal.aborted) setFetchedHtml(secured);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setCrashedInFeed(true);
      });
    return () => ctrl.abort();
  }, [inlineSecured, cachedRemote, livingHtmlUrl]);

  // Listen for VYBE_LIVING_READY and VYBE_LIVING_ERROR from the sandboxed iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== localIframeRef.current?.contentWindow) return;
      const data = event.data as { type?: string; error?: unknown } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'VYBE_LIVING_READY') {
        setReady(true);
      } else if (data.type === 'VYBE_LIVING_ERROR') {
        const msg = String(data.error ?? 'Unknown runtime error').slice(0, 400);
        if (studioPreview) {
          onRuntimeError?.(msg);
        } else {
          setCrashedInFeed(true);
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRuntimeError, studioPreview]);

  // Fallback crossfade reveal if a static/SVG Living Post has no rAF loop
  useEffect(() => {
    if (!settled || !resolvedHtml || ready || crashedInFeed) return;
    const id = window.setTimeout(() => setReady(true), 650);
    return () => window.clearTimeout(id);
  }, [settled, resolvedHtml, ready, crashedInFeed]);

  // Free WebGL context, AudioContext, and rAF immediately on unmount
  useEffect(() => {
    return () => {
      localIframeRef.current?.contentWindow?.postMessage({ type: 'VYBE_TEARDOWN' }, '*');
    };
  }, []);

  const canInteract = studioPreview || interacting;
  const contain = (e: { stopPropagation: () => void }) => {
    if (!studioPreview && canInteract) e.stopPropagation();
  };

  return (
    <div
      className="relative size-full overflow-hidden bg-black"
      style={{ touchAction: canInteract ? 'none' : 'pan-y' }}
      onPointerDown={contain}
      onPointerUp={contain}
      onClick={contain}
      onDoubleClick={contain}
    >
      {settled && resolvedHtml && !crashedInFeed && (
        <iframe
          ref={setIframeNode}
          title="Vybe Living Post"
          srcDoc={resolvedHtml}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          allow="accelerometer; gyroscope"
          className={`h-full w-full border-0 ${canInteract ? 'pointer-events-auto' : 'pointer-events-none'}`}
        />
      )}

      <PosterLayer thumbnailUrl={thumbnailUrl} hidden={ready && !crashedInFeed} />

      {!studioPreview && ready && !crashedInFeed && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-[4.25rem] right-4 z-20 flex items-center gap-2"
        >
          {prompt && (
            <Link
              href={`/create/living?prompt=${encodeURIComponent(prompt)}${postId ? `&remixPostId=${encodeURIComponent(postId)}` : ''}`}
              className="rounded-full border border-white/25 bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-black/70"
            >
              Remix
            </Link>
          )}
          <button
            type="button"
            aria-pressed={interacting}
            onClick={() => setInteracting((v) => !v)}
            className="rounded-full border border-white/30 bg-black/55 px-3.5 py-1.5 text-xs font-semibold text-white backdrop-blur-md transition hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white"
          >
            {interacting ? 'Done' : '✨ Tap to Interact'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Zero-trust sandboxed Living Post renderer.
 * Displays the real `.webp` thumbnail when inactive or settling, prefetches/caches R2 HTML,
 * crossfades seamlessly on `VYBE_LIVING_READY`, prevents mobile scroll-hijack via a
 * `pointer-events-none` shield until the user taps Interact, and sends `VYBE_TEARDOWN` on unmount.
 */
export default function LivingPostFrame({
  isActive,
  className = '',
  thumbnailUrl,
  html,
  livingHtmlUrl,
  studioPreview = false,
  ...rest
}: LivingPostFrameProps) {
  const mountKey = livingHtmlUrl || (html ? `${html.length}:${html.slice(0, 64)}` : 'empty');

  return (
    <div className={`relative h-full w-full overflow-hidden bg-black ${className}`}>
      {isActive ? (
        <ActiveLivingMount
          key={mountKey}
          html={html}
          livingHtmlUrl={livingHtmlUrl}
          thumbnailUrl={thumbnailUrl}
          studioPreview={studioPreview}
          {...rest}
        />
      ) : (
        <PosterLayer thumbnailUrl={thumbnailUrl} hidden={false} />
      )}
    </div>
  );
}
