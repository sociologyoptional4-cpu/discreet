'use client';
import { useEffect, useRef, useState } from 'react';
import { Download, Volume2, VolumeX } from 'lucide-react';
import { PublishSheet, secondaryButton } from '@/components/PublishSheet';
import type { MaskRecordingPayload } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

type Props = {
  videoUrl: string;
  onRetake: () => void;
  /** Reads the finished recording when Post is tapped (blob, mode, duration). Return null to do nothing. */
  getSnap: () => Omit<RecordedSnapPayload, 'url' | 'expiry'> | null;
  /** Runs after the post is live, just before the redirect to /feed. */
  onPublished?: (postId: string) => void;
  /** Hands the clip to the caller instead of publishing a feed post (stories, chat). */
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
  /** Picks the download file extension (mp4 vs webm). */
  mimeType?: string;
};

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
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? 'Unmute' : 'Mute'}
        aria-pressed={muted}
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-violet-400"
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
        extra={
          <a href={videoUrl} download={`snap.${ext}`} className={secondaryButton}>
            <Download aria-hidden className="size-4" /> Download Local Copy
          </a>
        }
      />
    </section>
  );
}
