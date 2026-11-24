'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { MAX_RECORDING_SECONDS, pickRecorderMimeType } from '@/hooks/usePrivacyRecorder';

export type ClipSegment = {
  id: string;
  blob: Blob;
  durationSec: number;
  mimeType: string;
};

export type UseMultiClipRecorderOptions = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  audioStream?: MediaStream | null;
  maxSeconds?: number;
};

export function useMultiClipRecorder({
  canvasRef,
  audioStream,
  maxSeconds = MAX_RECORDING_SECONDS,
}: UseMultiClipRecorderOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [segments, setSegments] = useState<ClipSegment[]>([]);
  const [activeClipSec, setActiveClipSec] = useState(0);
  const [finalBlob, setFinalBlob] = useState<Blob | null>(null);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownedTracksRef = useRef<MediaStreamTrack[]>([]);
  const sessionRef = useRef(0);
  const startedAtRef = useRef(0);

  const totalRecordedSec = segments.reduce((sum, s) => sum + s.durationSec, 0) + activeClipSec;

  const clearTimers = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current);
    timerRef.current = maxTimerRef.current = null;
  };

  const releaseOwnedTracks = () => {
    ownedTracksRef.current.forEach((t) => t.stop());
    ownedTracksRef.current = [];
  };

  const revokeUrl = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  };

  const stopSegment = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const finalizeSegments = useCallback((list: ClipSegment[]) => {
    if (list.length === 0) return;
    const type = list[0].mimeType || 'video/webm';
    const combined = new Blob(
      list.map((s) => s.blob),
      { type },
    );
    const totalSec = Math.round(list.reduce((sum, s) => sum + s.durationSec, 0) * 10) / 10;
    revokeUrl();
    const url = URL.createObjectURL(combined);
    urlRef.current = url;
    setFinalBlob(combined);
    setFinalUrl(url);
    setMimeType(type);
    setDurationSec(Math.max(0.5, totalSec));
  }, []);

  const startSegment = useCallback(
    async (autoFinalize = true) => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') return;
      const canvas = canvasRef.current;
      if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
        setError('Recording is not supported in this browser.');
        return;
      }

      const elapsedSoFar = segments.reduce((sum, s) => sum + s.durationSec, 0);
      const remainingSec = Math.max(1, maxSeconds - elapsedSoFar);
      const session = sessionRef.current;
      setError(null);

      try {
        const videoTracks = canvas.captureStream(30).getVideoTracks();
        ownedTracksRef.current = [...videoTracks];

        let audioTracks: MediaStreamTrack[] = [];
        if (audioStream && audioStream.getAudioTracks().length > 0) {
          audioTracks = audioStream.getAudioTracks();
        } else {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          if (session !== sessionRef.current) {
            mic.getTracks().forEach((t) => t.stop());
            return;
          }
          audioTracks = mic.getAudioTracks();
          ownedTracksRef.current.push(...audioTracks);
        }

        const stream = new MediaStream([...videoTracks, ...audioTracks]);
        const type = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t));
        const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
        const chunks: Blob[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onerror = () => {
          if (session === sessionRef.current) setError('Recording failed. Please try again.');
        };
        recorder.onstop = () => {
          clearTimers();
          releaseOwnedTracks();
          if (session !== sessionRef.current) return;
          const sec = Math.min((performance.now() - startedAtRef.current) / 1000, remainingSec + 0.5);
          const actual = recorder.mimeType || type || chunks[0]?.type || 'video/webm';
          const blob = new Blob(chunks, { type: actual });
          recorderRef.current = null;
          setIsRecording(false);
          setActiveClipSec(0);

          if (chunks.length === 0 || blob.size === 0) return;
          const seg: ClipSegment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            blob,
            durationSec: Math.max(0.4, Math.round(sec * 10) / 10),
            mimeType: actual,
          };

          setSegments((prev) => {
            const next = [...prev, seg];
            if (autoFinalize) {
              queueMicrotask(() => finalizeSegments(next));
            }
            return next;
          });
        };

        recorderRef.current = recorder;
        startedAtRef.current = performance.now();
        recorder.start(500);
        setIsRecording(true);
        setActiveClipSec(0);
        timerRef.current = setInterval(() => {
          setActiveClipSec(Math.round(((performance.now() - startedAtRef.current) / 1000) * 10) / 10);
        }, 120);
        maxTimerRef.current = setTimeout(stopSegment, remainingSec * 1000);
      } catch (e) {
        releaseOwnedTracks();
        clearTimers();
        setIsRecording(false);
        setError(
          e instanceof DOMException && e.name === 'NotAllowedError'
            ? 'Microphone permission was denied.'
            : 'Could not start recording.',
        );
      }
    },
    [audioStream, canvasRef, finalizeSegments, maxSeconds, segments, stopSegment],
  );

  const undoLastSegment = useCallback(() => {
    setSegments((prev) => prev.slice(0, -1));
  }, []);

  const resetAll = useCallback(() => {
    sessionRef.current += 1;
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    clearTimers();
    releaseOwnedTracks();
    revokeUrl();
    setIsRecording(false);
    setSegments([]);
    setActiveClipSec(0);
    setFinalBlob(null);
    setFinalUrl(null);
    setMimeType('');
    setDurationSec(0);
    setError(null);
  }, []);

  useEffect(
    () => () => {
      sessionRef.current += 1;
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
      clearTimers();
      releaseOwnedTracks();
      revokeUrl();
    },
    [],
  );

  return {
    isRecording,
    segments,
    recordingSeconds: Math.floor(totalRecordedSec),
    totalRecordedSec,
    recordedBlob: finalBlob,
    recordedUrl: finalUrl,
    mimeType,
    durationSec,
    error,
    startRecording: () => startSegment(true),
    startMultiClipSegment: () => startSegment(false),
    stopRecording: stopSegment,
    finishMultiClip: () => finalizeSegments(segments),
    undoLastSegment,
    resetRecording: resetAll,
  };
}
