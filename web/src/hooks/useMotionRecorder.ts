'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FaceMotionTracker } from '@/lib/motion/faceTracker';
import { encodeMotionTrack } from '@/lib/motion/motionCodec';

export interface MotionRecordingResult {
  vmtBytes: Uint8Array;
  vmtBlob: Blob;
  audioBlob: Blob;
  audioUrl: string;
  durationSec: number;
  frameCount: number;
  fps: number;
}

const TARGET_FPS = 20;
const MAX_DURATION_MS = 30_000;

function pickAudioMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? '';
}

export function useMotionRecorder(videoRef: RefObject<HTMLVideoElement | null>) {
  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const trackerRef = useRef<FaceMotionTracker | null>(null);
  const framesRef = useRef<Float32Array[]>([]);
  const headPosesRef = useRef<[number, number, number][]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const rafRef = useRef<number>(0);
  const startedAtRef = useRef<number>(0);
  const recordingRef = useRef(false);

  useEffect(() => {
    const tracker = new FaceMotionTracker();
    trackerRef.current = tracker;
    let cancelled = false;

    void tracker
      .init()
      .then(() => {
        if (!cancelled) setIsReady(true);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to initialize face tracker.');
        }
      });

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      tracker.close();
      trackerRef.current = null;
    };
  }, []);

  const stopRecording = useCallback(async (): Promise<MotionRecordingResult | null> => {
    if (!recordingRef.current) return null;
    recordingRef.current = false;
    setIsRecording(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }

    const recorder = recorderRef.current;
    const audioBlob = await new Promise<Blob>((resolve) => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob(audioChunksRef.current, { type: 'audio/webm' }));
        return;
      }
      recorder.onstop = () => {
        resolve(
          new Blob(audioChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          }),
        );
      };
      recorder.stop();
    });

    const elapsedSec = Math.max(0.5, (performance.now() - startedAtRef.current) / 1000);
    const vmtBytes = await encodeMotionTrack({
      fps: TARGET_FPS,
      frames: framesRef.current,
      headPoses: headPosesRef.current,
    });
    const copiedVmt = new Uint8Array(vmtBytes.byteLength);
    copiedVmt.set(vmtBytes);

    return {
      vmtBytes,
      vmtBlob: new Blob([copiedVmt], { type: 'application/octet-stream' }),
      audioBlob,
      audioUrl: URL.createObjectURL(audioBlob),
      durationSec: Math.round(elapsedSec * 10) / 10,
      frameCount: framesRef.current.length,
      fps: TARGET_FPS,
    };
  }, []);

  const startRecording = useCallback(async () => {
    if (recordingRef.current || !trackerRef.current || !isReady) return;
    setError(null);
    framesRef.current = [];
    headPosesRef.current = [];
    audioChunksRef.current = [];

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const mimeType = pickAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(mic, { mimeType, audioBitsPerSecond: 16_000 })
        : new MediaRecorder(mic);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorderRef.current = recorder;

      startedAtRef.current = performance.now();
      recordingRef.current = true;
      setIsRecording(true);
      setDurationSec(0);
      recorder.start(250);

      const loop = (now: number) => {
        if (!recordingRef.current) return;
        const elapsed = now - startedAtRef.current;
        setDurationSec(Math.round((elapsed / 1000) * 10) / 10);

        if (elapsed >= MAX_DURATION_MS) {
          void stopRecording();
          return;
        }

        const video = videoRef.current;
        const tracker = trackerRef.current;
        if (video && tracker) {
          const sample = tracker.detectThrottled(video, now);
          if (sample) {
            setFaceDetected(sample.faceDetected);
            framesRef.current.push(new Float32Array(sample.weights));
            headPosesRef.current.push([
              sample.headEuler[0],
              sample.headEuler[1],
              sample.headEuler[2],
            ]);
          }
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      rafRef.current = requestAnimationFrame(loop);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Microphone access failed.');
      recordingRef.current = false;
      setIsRecording(false);
    }
  }, [isReady, stopRecording, videoRef]);

  return {
    isReady,
    isRecording,
    faceDetected,
    durationSec,
    error,
    startRecording,
    stopRecording,
  };
}
