'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AvatarStage } from '@/components/AvatarStage';
import { resolveMediaUrl } from '@/lib/demoData';
import { loadMotionTrack } from '@/lib/motionTrack';
import { frameIndexAt } from '@/lib/motionPack';
import type { AvatarId, MotionFrame } from '@/types/avatar';
import type { MotionTrackFile } from '@/types/social';

type Props = {
  avatarId: AvatarId | null;
  motionUrl: string | null;
  audioUrl: string;
  soundOn: boolean;
  /** Freezes the clip (audio and avatar) while true. */
  paused?: boolean;
  /** An element whose scaleX is kept equal to how far through the clip we are (a hairline progress bar). */
  barRef?: RefObject<HTMLElement | null>;
};

/**
 * Plays one 3D mask post: downloads its motion track, plays its audio, and drives the avatar from the audio clock.
 * It owns the only WebGL canvas on the feed, so mount a single instance (the active card) at a time.
 * Audio keeps its clock while muted, so lip-sync is unchanged when the sound is off.
 */
export function MaskPlayback({ avatarId, motionUrl, audioUrl, soundOn, paused = false, barRef }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentFrameRef = useRef<MotionFrame | null>(null);
  const [loaded, setLoaded] = useState<{ url: string; track: MotionTrackFile | null } | null>(null);
  const track = loaded !== null && loaded.url === motionUrl ? loaded.track : null;
  const failed = loaded !== null && loaded.url === motionUrl && loaded.track === null;

  useEffect(() => {
    if (!motionUrl) return;
    let alive = true;
    void loadMotionTrack(motionUrl).then((result) => {
      if (alive) setLoaded({ url: motionUrl, track: result });
    });
    return () => { alive = false; };
  }, [motionUrl]);

  useEffect(() => {
    if (!track) return;
    let raf = 0;
    const tick = () => {
      const audio = audioRef.current;
      if (audio) {
        currentFrameRef.current = track.frames[frameIndexAt(audio.currentTime, track.fps, track.frames.length)] ?? null;
        const bar = barRef?.current;
        if (bar) bar.style.transform = `scaleX(${Math.min(1, audio.currentTime / (track.frames.length / track.fps))})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [track, barRef]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (paused) audio.pause();
    else void audio.play().catch(() => {}); // blocked autoplay just leaves the avatar waiting for the next tap
  }, [audioUrl, soundOn, paused]);

  return (
    <div className="relative flex size-full items-center">
      <AvatarStage fill avatarId={avatarId ?? track?.avatarId ?? 'cyber_monk'} currentFrameRef={currentFrameRef} />
      <audio ref={audioRef} src={resolveMediaUrl(audioUrl)} loop autoPlay playsInline preload="auto" muted={!soundOn} />
      {!track && (
        <p role="status" className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs text-white/80">
          {failed ? 'Couldn’t load this 3D clip' : 'Loading 3D clip…'}
        </p>
      )}
    </div>
  );
}
