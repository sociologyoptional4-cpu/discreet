'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import { PublishSheet } from '@/components/PublishSheet';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

type Props = {
  videoUrl: string;
  onRetake: () => void;
  /** Reads the finished recording when Upload is tapped (blob, mode, duration). Return null to do nothing. */
  getSnap: () => Omit<RecordedSnapPayload, 'url' | 'expiry'> | null;
  /** Runs after the post is live, just before the redirect to /feed. */
  onPublished?: (postId: string) => void;
  /** Hands the clip to the caller instead of publishing a feed post (stories, chat). */
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
  /** Picks the download file extension (mp4 vs webm). */
  mimeType?: string;
};

const frostedBtn =
  'flex size-11 items-center justify-center rounded-full backdrop-blur-xl bg-white/75 border border-white/90 shadow-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900';

export function PreviewPlayer({ videoUrl, onRetake, getSnap, onPublished, submit, submitLabel, mimeType = '' }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);

  // Autoplay with sound is often blocked; if so fall back to muted playback instead of showing a frozen frame.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      setMuted(true);
      v.play().catch(() => {});
    });
  }, [videoUrl]);

  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return (
    <section className="fixed inset-0 z-30 flex items-center justify-center bg-[#0A0A0A]" aria-label="Preview your snap">
      <video
        ref={videoRef}
        src={videoUrl}
        autoPlay
        loop
        playsInline
        muted={muted}
        className="aspect-[9/16] h-full max-h-dvh w-full max-w-[calc(100dvh*9/16)] object-cover"
      />

      {/* Top-Left: Frosted Back button */}
      <button
        type="button"
        onClick={onRetake}
        aria-label="Back to camera"
        className={`${frostedBtn} absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40`}
      >
        <ArrowLeft aria-hidden className="size-5" />
      </button>

      {/* Top-Right: Frosted Mute/Audio toggle */}
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        className={`${frostedBtn} absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40`}
      >
        {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
      </button>

      <PublishSheet
        buildInput={(expiryTier, isIncog) => {
          const snap = getSnap();
          return snap ? { kind: 'snap', payload: { ...snap, url: videoUrl, expiry: expiryTier }, expiryTier, isIncog } : null;
        }}
        onRetake={onRetake}
        onPublished={onPublished}
        submit={submit}
        submitLabel={submitLabel}
        downloadUrl={videoUrl}
        downloadName={`snap.${ext}`}
      />
    </section>
  );
}
