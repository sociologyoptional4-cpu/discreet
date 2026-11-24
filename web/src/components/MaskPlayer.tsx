'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { AvatarStage } from '@/components/AvatarStage';
import { PublishSheet } from '@/components/PublishSheet';
import { frameIndexAt } from '@/lib/motionPack';
import type { MaskRecordingPayload, MotionFrame } from '@/types/avatar';
import type { RecordedSnapPayload } from '@/types/privacy';

type Props = {
  payload: MaskRecordingPayload;
  onRetake: () => void;
  /** Runs after the post is live, just before the redirect to /feed. */
  onPublished?: (postId: string) => void;
  /** Hands the clip to the caller instead of publishing a feed post (stories, chat). */
  submit?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
};

const frostedBtn =
  'flex size-11 items-center justify-center rounded-full backdrop-blur-xl bg-white/75 border border-white/90 shadow-lg text-slate-900 focus-visible:outline-2 focus-visible:outline-slate-900';

export function MaskPlayer({ payload, onRetake, onPublished, submit, submitLabel }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentFrameRef = useRef<MotionFrame | null>(payload.frames[0] ?? null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  // The audio clock is the only clock. Every animation frame the avatar shows the motion frame for the audio's
  // current time, so lip-sync cannot drift whatever the frame rate of the screen or the speed of the phone.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        const idx = frameIndexAt(audio.currentTime, payload.fps, payload.frames.length);
        currentFrameRef.current = payload.frames[idx] ?? null;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [payload]);

  // Autoplay may be blocked (especially with sound). If so the Play button is shown instead of a silent loop.
  useEffect(() => {
    void audioRef.current?.play().catch(() => {});
  }, [payload.audioUrl]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  return (
    <section className="fixed inset-0 z-30 flex items-center justify-center bg-[#0A0A0A]" aria-label="Preview your 3D mask snap">
      <div className="relative aspect-[9/16] h-full max-h-dvh w-full max-w-[calc(100dvh*9/16)]">
        <AvatarStage avatarId={payload.avatarId} currentFrameRef={currentFrameRef} />
      </div>

      <audio
        ref={audioRef}
        src={payload.audioUrl}
        loop
        autoPlay
        muted={muted}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
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

      {/* Top-Right: Frosted Play/Pause + Mute toggle */}
      <div className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-40 flex items-center gap-2">
        <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} className={frostedBtn}>
          {playing ? <Pause aria-hidden className="size-5" /> : <Play aria-hidden className="size-5" />}
        </button>
        <button type="button" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted} className={frostedBtn}>
          {muted ? <VolumeX aria-hidden className="size-5" /> : <Volume2 aria-hidden className="size-5" />}
        </button>
      </div>

      <PublishSheet
        buildInput={(expiryTier, isIncog) => ({ kind: 'mask', payload, expiryTier, isIncog })}
        onRetake={onRetake}
        onPublished={onPublished}
        submit={submit}
        submitLabel={submitLabel}
      />
    </section>
  );
}
