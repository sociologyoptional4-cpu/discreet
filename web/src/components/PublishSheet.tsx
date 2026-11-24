'use client';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { RotateCcw, Send } from 'lucide-react';
import { ExpirySelector } from '@/components/ExpirySelector';
import { IncogToggle } from '@/components/IncogToggle';
import { publishPost, type PublishInput } from '@/lib/publishPost';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { ExpiryTier, RecordedSnapPayload } from '@/types/privacy';

type Props = {
  /** Called when Post is tapped, so it reads the latest recording at that moment. Return null to do nothing. */
  buildInput: (expiry: ExpiryTier, isIncog: boolean) => PublishInput | null;
  onRetake: () => void;
  /** Runs after the post is live, just before the redirect to /feed. */
  onPublished?: (postId: string) => void;
  /** Extra secondary button next to Retake (for example a local download). */
  extra?: ReactNode;
  /**
   * When given, Post hands the finished clip to this function instead of publishing a feed post: no expiry or Incog
   * choices are shown and nothing redirects. Used for stories and chat snaps.
   */
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
};

type Status = { phase: 'idle' | 'uploading'; progress: number; error: string | null };

export const secondaryButton =
  'flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/10 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-40';

/** Bottom sheet shared by both previews: expiry, the Incog Burner toggle, upload progress, Retake and Post. */
export function PublishSheet({ buildInput, onRetake, onPublished, extra, submit, submitLabel = 'Post' }: Props) {
  const router = useRouter();
  const [expiry, setExpiry] = useState<ExpiryTier>('1d');
  const [incog, setIncog] = useState(false);
  const [status, setStatus] = useState<Status>({ phase: 'idle', progress: 0, error: null });
  const busy = status.phase === 'uploading';
  const percent = Math.round(status.progress * 100);

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
      router.push('/feed'); // stays in the uploading state until the page changes, so a second tap cannot post twice
    } catch (error) {
      setStatus({ phase: 'idle', progress: 0, error: error instanceof Error ? error.message : 'Could not publish your post.' });
    }
  };

  return (
    <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-md rounded-t-3xl border border-b-0 border-white/15 bg-[#0A0A0A]/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur-2xl">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" aria-hidden />
      {!submit && (
        <>
          {incog ? (
            <p className="rounded-2xl bg-white/5 px-3 py-2 text-xs text-white/70">Incog posts always delete after 1 day.</p>
          ) : (
            <ExpirySelector value={expiry} onChange={setExpiry} />
          )}
          <div className="mt-3">
            <IncogToggle checked={incog} onChange={setIncog} disabled={busy} />
          </div>
        </>
      )}

      {status.error && <p role="alert" className="mt-3 rounded-2xl bg-rose-500/20 px-3 py-2 text-sm text-rose-100">{status.error}</p>}
      {busy && !submit && (
        <div className="mt-3" role="progressbar" aria-label="Uploading" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
          </div>
        </div>
      )}

      <div className={`mt-3 grid gap-2 ${extra ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button type="button" onClick={onRetake} disabled={busy} className={secondaryButton}>
          <RotateCcw aria-hidden className="size-4" /> Retake
        </button>
        {extra}
      </div>
      <button
        type="button"
        onClick={() => void post()}
        disabled={busy}
        className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-500 to-cyan-400 text-sm font-bold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-70"
      >
        <Send aria-hidden className="size-4" /> {submit ? (busy ? 'Sending…' : submitLabel) : busy ? `Uploading ${percent}%` : incog ? 'Post as Incog' : 'Post / Send'}
      </button>
    </div>
  );
}
