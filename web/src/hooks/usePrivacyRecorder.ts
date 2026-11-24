'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

export const MAX_RECORDING_SECONDS = 60;
const FPS = 30;
const TIMESLICE_MS = 1000; // chunks are flushed every second so a crash loses at most one second

/** Preference order is fixed: VP9 (best quality), VP8, then MP4 (Safari), then let the browser choose. */
export const MIME_CANDIDATES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4'] as const;

/** Returns the first supported candidate, or `undefined` meaning "pass no mimeType and use the default". */
export function pickRecorderMimeType(isSupported: (type: string) => boolean): string | undefined {
  return MIME_CANDIDATES.find((t) => isSupported(t));
}

export type UsePrivacyRecorderOptions = {
  /** The processed canvas. This is the ONLY video that is ever recorded; the raw camera never reaches the recorder. */
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /**
   * The microphone stream if the caller already has one (it stays owned by the caller).
   * When omitted, the hook asks for the microphone itself and releases it when recording ends.
   */
  audioStream?: MediaStream | null;
  /** Hard stop. Defaults to 60 s; exposed so tests don't have to wait a minute. */
  maxSeconds?: number;
};

export type PrivacyRecorder = {
  isRecording: boolean;
  recordingSeconds: number;
  recordedBlob: Blob | null;
  recordedUrl: string | null;
  mimeType: string;
  /** Length of the finished recording in seconds (0 until one exists). */
  durationSec: number;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  resetRecording: () => void;
};

export function usePrivacyRecorder({ canvasRef, audioStream, maxSeconds = MAX_RECORDING_SECONDS }: UsePrivacyRecorderOptions): PrivacyRecorder {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState('');
  const [durationSec, setDurationSec] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const urlRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ownedTracksRef = useRef<MediaStreamTrack[]>([]); // tracks this hook created and must stop
  const sessionRef = useRef(0); // bumped on reset/unmount so a late `onstop` can't resurrect state
  const startedAtRef = useRef(0);

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

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop(); // finishing happens in onstop
  }, []);

  const resetRecording = useCallback(() => {
    sessionRef.current += 1; // invalidates any in-flight onstop
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== 'inactive') rec.stop();
    clearTimers();
    releaseOwnedTracks();
    revokeUrl();
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setMimeType('');
    setDurationSec(0);
    setError(null);
  }, []);

  const startRecording = useCallback(async () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') return;
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      setError('Recording is not supported in this browser.');
      return;
    }
    resetRecording();
    const session = sessionRef.current;
    try {
      // Video comes only from the processed canvas.
      const videoTracks = canvas.captureStream(FPS).getVideoTracks();
      ownedTracksRef.current = [...videoTracks];

      let audioTracks: MediaStreamTrack[];
      if (audioStream) {
        audioTracks = audioStream.getAudioTracks();
      } else {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        if (session !== sessionRef.current) { mic.getTracks().forEach((t) => t.stop()); return; } // reset while the prompt was open
        audioTracks = mic.getAudioTracks();
        ownedTracksRef.current.push(...audioTracks);
      }
      if (!audioTracks.length) throw new Error('No microphone track available.');

      const stream = new MediaStream([...videoTracks, ...audioTracks]);
      const type = pickRecorderMimeType((t) => MediaRecorder.isTypeSupported(t));
      const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onerror = () => { if (session === sessionRef.current) setError('Recording failed. Please try again.'); };
      recorder.onstop = () => {
        clearTimers();
        releaseOwnedTracks();
        if (session !== sessionRef.current) return; // reset or unmounted: discard
        const seconds = Math.min((performance.now() - startedAtRef.current) / 1000, maxSeconds + 1);
        const actual = recorder.mimeType || type || chunks[0]?.type || '';
        const blob = new Blob(chunks, { type: actual });
        revokeUrl();
        urlRef.current = URL.createObjectURL(blob);
        recorderRef.current = null;
        setRecordedBlob(blob);
        setRecordedUrl(urlRef.current);
        setMimeType(blob.type || actual);
        setDurationSec(Math.round(seconds * 10) / 10);
        setRecordingSeconds(Math.floor(seconds));
        setIsRecording(false);
      };

      recorderRef.current = recorder;
      startedAtRef.current = performance.now();
      recorder.start(TIMESLICE_MS);
      setIsRecording(true);
      timerRef.current = setInterval(() => setRecordingSeconds(Math.floor((performance.now() - startedAtRef.current) / 1000)), 250);
      maxTimerRef.current = setTimeout(stopRecording, maxSeconds * 1000); // auto-stop through the normal clean path
    } catch (e) {
      releaseOwnedTracks();
      clearTimers();
      setIsRecording(false);
      setError(e instanceof DOMException && e.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start recording.');
    }
  }, [canvasRef, audioStream, maxSeconds, resetRecording, stopRecording]);

  // Unmount: stop everything and free the object URL. Nothing is published from here.
  useEffect(() => () => {
    sessionRef.current += 1;
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
    clearTimers();
    releaseOwnedTracks();
    revokeUrl();
  }, []);

  return { isRecording, recordingSeconds, recordedBlob, recordedUrl, mimeType, durationSec, error, startRecording, stopRecording, resetRecording };
}
