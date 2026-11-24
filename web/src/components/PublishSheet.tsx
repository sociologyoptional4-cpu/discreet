'use client';
import { AnimatePresence, motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Clock, Ghost, Infinity as InfinityIcon } from 'lucide-react';
import { publishPost, type PublishInput } from '@/lib/publishPost';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { ExpiryTier, RecordedSnapPayload } from '@/types/privacy';

type Props = {
  /** Called when Upload is tapped, so it reads the latest recording at that moment. Return null to do nothing. */
  buildInput: (expiry: ExpiryTier, isIncog: boolean) => PublishInput | null;
  onRetake: () => void;
  /** Runs after the post is live, just before the redirect to /feed. */
  onPublished?: (postId: string) => void;
  /** Optional local download URL & filename for the circular Download button. */
  downloadUrl?: string;
  downloadName?: string;
  /** Extra secondary button if needed. */
  extra?: ReactNode;
  /**
   * When given, Upload hands the finished clip to this function instead of publishing a feed post: no expiry or Incog
   * choices are shown and nothing redirects. Used for stories and chat snaps.
   */
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
};

type Status = { phase: 'idle' | 'uploading'; progress: number; error: string | null };

const EXPIRY_OPTIONS: { id: ExpiryTier; short: string; label: string; angle: number }[] = [
  { id: '1d', short: '1D', label: '1D', angle: -36 },
  { id: '1w', short: '1W', label: '1W', angle: -12 },
  { id: '1y', short: '1Y', label: '1Y', angle: 12 },
  { id: 'never', short: '∞', label: 'Never', angle: 36 },
];

const frosted = 'backdrop-blur-xl bg-white/75 border border-white/90 shadow-lg text-slate-900';

export const secondaryButton =
  'flex size-11 items-center justify-center rounded-full backdrop-blur-xl bg-white/75 border border-white/90 shadow-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-40';

/** Minimal frosted acrylic controls: curved right-edge expiry wheel + slim bottom floating dock. */
export function PublishSheet({ buildInput, onPublished, downloadUrl, downloadName, submit }: Props) {
  const router = useRouter();
  const [expiry, setExpiry] = useState<ExpiryTier>('1d');
  const [incog, setIncog] = useState(false);
  const [wheelOpen, setWheelOpen] = useState(false);
  const [status, setStatus] = useState<Status>({ phase: 'idle', progress: 0, error: null });
  const busy = status.phase === 'uploading';
  const percent = Math.round(status.progress * 100);
  const activeExpiry = EXPIRY_OPTIONS.find((o) => o.id === expiry) ?? EXPIRY_OPTIONS[0];

  const toggleIncog = () => {
    const next = !incog;
    setIncog(next);
    if (next) {
      setExpiry('1d');
      setWheelOpen(false);
    }
  };

  const post = async () => {
    if (busy) return;
    const input = buildInput(submit ? '1d' : expiry, submit ? false : incog);
    if (!input) return;
    if (submit) {
      setStatus({ phase: 'uploading', progress: 0, error: null });
      try {
        await submit(input.payload);
        setStatus({ phase: 'idle', progress: 0, error: null });
      } catch (error) {
        setStatus({ phase: 'idle', progress: 0, error: error instanceof Error ? error.message : 'Could not send. Try again.' });
      }
      return;
    }
    setStatus({ phase: 'uploading', progress: 0, error: null });
    try {
      const { postId } = await publishPost(input, (progress) => setStatus((s) => ({ ...s, progress })));
      onPublished?.(postId);
      router.push('/feed?posted=1');
    } catch (error) {
      setStatus({ phase: 'idle', progress: 0, error: error instanceof Error ? error.message : 'Could not publish your post.' });
    }
  };

  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;

  return (
    <>
      {/* Curved Side Wheel Expiry Picker (Right Edge) */}
      {!submit && !incog && (
        <div className="absolute right-3 top-1/2 z-40 -translate-y-1/2">
          {!wheelOpen ? (
            <motion.button
              type="button"
              onClick={() => setWheelOpen(true)}
              onPanStart={() => setWheelOpen(true)}
              aria-label={`Expiry: ${activeExpiry.label}. Tap to change`}
              className={`${frosted} flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold tracking-wide focus-visible:outline-2 focus-visible:outline-slate-900`}
              whileTap={{ scale: 0.94 }}
            >
              {activeExpiry.id === 'never' ? <InfinityIcon aria-hidden className="size-3.5" /> : <Clock aria-hidden className="size-3.5" />}
              <span>{activeExpiry.short}</span>
            </motion.button>
          ) : (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: 16 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: 16 }}
                transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                className="relative h-56 w-36 select-none"
                role="radiogroup"
                aria-label="Snap expiry"
              >
                {/* Delicate vertical arc track + center notch */}
                <svg aria-hidden viewBox="0 0 100 220" className="pointer-events-none absolute inset-y-0 right-0 h-full w-24">
                  <path d="M 88 12 A 140 140 0 0 0 88 208" fill="none" stroke="rgba(255,255,255,0.65)" strokeWidth="2" />
                  <rect x="76" y="107" width="16" height="6" rx="3" fill="#0f172a" />
                </svg>

                {EXPIRY_OPTIONS.map((opt) => {
                  const rad = (opt.angle * Math.PI) / 180;
                  const arcR = 112;
                  const x = Math.round((1 - Math.cos(rad)) * arcR);
                  const y = Math.round(Math.sin(rad) * arcR);
                  const selected = opt.id === expiry;
                  return (
                    <motion.button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setExpiry(opt.id);
                        setWheelOpen(false);
                      }}
                      style={{ top: `calc(50% + ${y}px)`, right: `${18 + x}px` }}
                      className={`absolute -translate-y-1/2 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition-transform focus-visible:outline-2 focus-visible:outline-slate-900 ${
                        selected
                          ? 'bg-slate-900 text-white shadow-lg scale-105'
                          : `${frosted} opacity-90 hover:opacity-100`
                      }`}
                      whileTap={{ scale: 0.92 }}
                    >
                      {opt.id === 'never' ? <InfinityIcon aria-hidden className="size-3.5" /> : <Clock aria-hidden className="size-3.5" />}
                      <span>{opt.label}</span>
                    </motion.button>
                  );
                })}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      )}

      {/* Error toast */}
      {status.error && (
        <p role="alert" className="absolute inset-x-4 bottom-24 z-40 mx-auto w-fit max-w-[90%] rounded-full bg-rose-600/90 px-4 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-md">
          {status.error}
        </p>
      )}

      {/* Ultra-Compact Bottom Floating Dock */}
      <div className="absolute inset-x-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center justify-between">
        {/* Left: Incog Burner (ghost icon + compact toggle only) */}
        {!submit ? (
          <button
            type="button"
            role="switch"
            aria-checked={incog}
            aria-label="Incog Burner"
            onClick={toggleIncog}
            disabled={busy}
            className={`${frosted} flex h-11 items-center gap-2.5 rounded-full px-3.5 focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-50`}
          >
            <Ghost aria-hidden className={`size-4 ${incog ? 'text-violet-600' : 'text-slate-700'}`} />
            <span
              aria-hidden
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${incog ? 'bg-slate-900' : 'bg-slate-300/90'}`}
            >
              <span className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${incog ? 'translate-x-4.5' : 'translate-x-1'}`} />
            </span>
          </button>
        ) : (
          <div />
        )}

        {/* Right: Download + Upload circular frosted buttons */}
        <div className="flex items-center gap-2.5">
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={downloadName ?? 'snap.webm'}
              aria-label="Download local copy"
              className={`${frosted} flex size-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-slate-900`}
            >
              <ArrowDown aria-hidden className="size-5" />
            </a>
          )}

          <button
            type="button"
            onClick={() => void post()}
            disabled={busy}
            aria-label={busy ? `Uploading ${percent}%` : 'Upload'}
            className={`${frosted} relative flex size-12 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-slate-900 disabled:opacity-90`}
          >
            {busy && (
              <svg aria-hidden viewBox="0 0 48 48" className="pointer-events-none absolute inset-0 size-full -rotate-90">
                <circle cx="24" cy="24" r={radius} fill="none" stroke="rgba(15,23,42,0.15)" strokeWidth="3" />
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  fill="none"
                  stroke="#0f172a"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
            )}
            <ArrowUp aria-hidden className="size-5" />
          </button>
        </div>
      </div>
    </>
  );
}
