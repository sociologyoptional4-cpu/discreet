'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, RotateCw, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useSmartVideoUpload } from '@/hooks/useSmartVideoUpload';
import { smartUploadQueue } from '@/lib/media/smartUploadQueue';
import type { UploadDraft } from '@/lib/media/optimisticUpload';

const LABEL: Record<UploadDraft['status'], string> = {
  processing: 'Optimising your vibe',
  uploading: 'Posting',
  published: 'Posted',
  failed: 'Couldn’t post',
};

/** One floating status for background posts: progress while it works, Retry when it cannot, a tick when it is live. */
export function UploadStatusPill() {
  const { drafts, retry, cancel } = useSmartVideoUpload();
  const router = useRouter();
  const pathname = usePathname();
  const celebrated = useRef(new Set<string>());

  useEffect(() => { void smartUploadQueue.resume(); }, []);

  const draft = drafts.find((d) => d.status === 'failed') ?? drafts.find((d) => d.status !== 'published') ?? drafts[0];

  useEffect(() => {
    if (draft?.status === 'published' && !celebrated.current.has(draft.id)) {
      celebrated.current.add(draft.id);
      if (pathname === '/feed') router.replace('/feed?posted=1');
    }
  }, [draft, pathname, router]);

  return (
    <AnimatePresence>
      {draft && (
        <motion.div
          key={draft.id}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
          transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          className="fixed left-1/2 z-[65] flex w-[min(92vw,340px)] -translate-x-1/2 items-center gap-3 overflow-hidden rounded-full border border-white/70 bg-white/80 py-2 pl-2 pr-3 text-slate-900 shadow-[0_10px_30px_rgba(15,23,42,.16)] backdrop-blur-xl"
          style={{ bottom: 'calc(max(0.75rem, env(safe-area-inset-bottom)) + 5.25rem)' }}
        >
          <span className="relative size-9 shrink-0 overflow-hidden rounded-full bg-slate-200">
            {draft.localThumbnailUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={draft.localThumbnailUrl} alt="" className="size-full object-cover" />
              : <video src={draft.localVideoUrl} muted playsInline preload="metadata" aria-hidden className="size-full object-cover" />}
            {draft.status === 'published' && <span className="absolute inset-0 grid place-items-center bg-emerald-500/80 text-white"><Check aria-hidden className="size-4" /></span>}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold">{LABEL[draft.status]}{draft.status === 'processing' || draft.status === 'uploading' ? ` · ${draft.progress}%` : ''}</span>
            {draft.error && <span className="block truncate text-[11px] text-rose-600">{draft.error}</span>}
          </span>
          {draft.status === 'failed' && (
            <>
              <button type="button" onClick={() => retry(draft.id)} aria-label="Retry posting" className="flex size-8 items-center justify-center rounded-full bg-slate-900 text-white"><RotateCw aria-hidden className="size-4" /></button>
              <button type="button" onClick={() => cancel(draft.id)} aria-label="Discard this post" className="flex size-8 items-center justify-center rounded-full border border-slate-200 text-slate-600"><X aria-hidden className="size-4" /></button>
            </>
          )}
          {(draft.status === 'processing' || draft.status === 'uploading') && (
            <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-slate-900/10">
              <span className="block h-full origin-left bg-gradient-to-r from-violet-400 to-sky-400 transition-transform duration-300" style={{ transform: `scaleX(${draft.progress / 100})` }} />
            </span>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
