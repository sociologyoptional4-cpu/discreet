'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import { stopCameraStreams } from '@/lib/cameraCleanup';

export type CameraPhase = 'requesting' | 'ready' | 'denied' | 'unsupported' | 'error';
export type Facing = 'user' | 'environment';

export type CameraStream = {
  /** Attach to the hidden `<video>`. It receives video only; the raw frames never leave this element and the canvas loop. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Microphone track(s) only, handed to the recorder. */
  audioStream: MediaStream | null;
  phase: CameraPhase;
  facing: Facing;
  notice: string | null;
  flip: () => Promise<void>;
  retry: () => Promise<void>;
};

const videoConstraints = (facing: Facing): MediaTrackConstraints => ({
  facingMode: { ideal: facing },
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
});

const isPermissionError = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError');

/** Camera (and, unless `audio: false`, microphone) permissions, front/rear flip, and guaranteed track shutdown on unmount. */
export function useCameraStream({ audio: wantAudio = true, mode }: { audio?: boolean; mode?: string } = {}): CameraStream {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0); // bumped on every stop so a late getUserMedia result is discarded and its tracks stopped
  const facingRef = useRef<Facing>('user');
  const [phase, setPhase] = useState<CameraPhase>('requesting');
  const [facing, setFacing] = useState<Facing>('user');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stopAll = useCallback(() => {
    generationRef.current += 1;
    stopCameraStreams(videoStreamRef.current, audioStreamRef.current);
    videoStreamRef.current = null;
    audioStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const attach = useCallback(async (stream: MediaStream) => {
    const el = videoRef.current;
    if (!el) throw new Error('video element missing');
    el.srcObject = stream;
    await el.play();
  }, []);

  const start = useCallback(
    async (mode: Facing) => {
      stopAll();
      const gen = generationRef.current;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPhase('unsupported'); // not a secure context (plain http) or an ancient browser
        return;
      }
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(mode),
          audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false,
        });
      } catch (e) {
        if (gen === generationRef.current) setPhase(isPermissionError(e) ? 'denied' : 'error');
        return;
      }
      if (gen !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop()); // unmounted or restarted while the prompt was open
        return;
      }
      const video = new MediaStream(stream.getVideoTracks());
      const audio = new MediaStream(stream.getAudioTracks());
      videoStreamRef.current = video;
      audioStreamRef.current = audio;
      try {
        await attach(video);
      } catch {
        if (gen === generationRef.current) { stopAll(); setPhase('error'); }
        return;
      }
      if (gen !== generationRef.current) return;
      facingRef.current = mode;
      setFacing(mode);
      setAudioStream(audio);
      setPhase('ready');
    },
    [attach, stopAll, wantAudio],
  );

  const flip = useCallback(async () => {
    const next: Facing = facingRef.current === 'user' ? 'environment' : 'user';
    const prev = facingRef.current;
    setNotice(null);
    setPhase('requesting');
    await start(next);
    if (facingRef.current !== next && videoRef.current) {
      setNotice('Could not switch cameras on this device.');
      await start(prev);
    }
  }, [start]);

  const retry = useCallback(() => {
    setPhase('requesting');
    setNotice(null);
    return start(facingRef.current);
  }, [start]);

  useEffect(() => {
    // Deferred so React's dev double-mount cancels the first attempt instead of prompting for permission twice.
    const timer = setTimeout(() => { setPhase('requesting'); void start(facingRef.current); }, 0);
    return () => {
      clearTimeout(timer);
      stopAll(); // releases camera and microphone on unmount
    };
  }, [start, stopAll, mode]);

  return { videoRef, audioStream, phase, facing, notice, flip, retry };
}
