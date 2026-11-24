'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIME_ORDER = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'] as const;
const MAX_DURATION_SEC = 60;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return undefined;
  }
  return MIME_ORDER.find((t) => MediaRecorder.isTypeSupported(t));
}

export function useVoiceInput() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const maxTimerRef = useRef<number | null>(null);
  const stopResolveRef = useRef<((text: string) => void) | null>(null);
  const mountedRef = useRef(true);

  const cleanupMedia = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (maxTimerRef.current !== null) {
      window.clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }
      cleanupMedia();
    };
  }, [cleanupMedia]);

  const stopRecording = useCallback((): Promise<string> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') {
      cleanupMedia();
      setIsRecording(false);
      return Promise.resolve('');
    }
    return new Promise((resolve) => {
      stopResolveRef.current = resolve;
      try {
        rec.stop();
      } catch {
        stopResolveRef.current = null;
        cleanupMedia();
        setIsRecording(false);
        resolve('');
      }
    });
  }, [cleanupMedia]);

  const startRecording = useCallback(async () => {
    if (isRecording || isTranscribing) return;
    setError(null);
    setDurationSec(0);

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is not supported in this browser.');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        setError('Microphone permission denied. Allow mic access in browser settings.');
      } else {
        setError('Could not access microphone.');
      }
      return;
    }

    if (!mountedRef.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const mimeType = pickMimeType();

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      cleanupMedia();
      setError('Audio recording is not supported on this device.');
      return;
    }

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      const chunks = chunksRef.current;
      chunksRef.current = [];
      const finalMime = recorder.mimeType || mimeType || 'audio/webm';
      cleanupMedia();

      if (!mountedRef.current) {
        stopResolveRef.current?.('');
        stopResolveRef.current = null;
        return;
      }

      setIsRecording(false);
      const resolver = stopResolveRef.current;
      stopResolveRef.current = null;

      if (chunks.length === 0) {
        resolver?.('');
        return;
      }

      setIsTranscribing(true);
      try {
        const blob = new Blob(chunks, { type: finalMime });
        const ext = finalMime.includes('mp4') ? 'mp4' : 'webm';
        const form = new FormData();
        form.append('audio', blob, `voice.${ext}`);

        const res = await fetch('/api/transcribe', { method: 'POST', body: form });
        const data = (await res.json().catch(() => null)) as { transcript?: string; error?: string } | null;
        if (!res.ok) {
          throw new Error(data?.error || 'Could not transcribe audio.');
        }
        const text = (data?.transcript ?? '').trim();
        resolver?.(text);
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : 'Transcription failed.');
        }
        resolver?.('');
      } finally {
        if (mountedRef.current) setIsTranscribing(false);
      }
    };

    recorderRef.current = recorder;
    recorder.start(500);
    setIsRecording(true);

    const startedAt = Date.now();
    timerRef.current = window.setInterval(() => {
      setDurationSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);

    maxTimerRef.current = window.setTimeout(() => {
      void stopRecording();
    }, MAX_DURATION_SEC * 1000);
  }, [cleanupMedia, isRecording, isTranscribing, stopRecording]);

  return {
    isRecording,
    isTranscribing,
    durationSec,
    error,
    startRecording,
    stopRecording,
  };
}
