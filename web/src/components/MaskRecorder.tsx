'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { CameraOff, LoaderCircle, Square } from 'lucide-react';
import type { HandLandmarkerResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import { AvatarSelector } from '@/components/AvatarSelector';
import { VoiceWaveform } from '@/components/VoiceWaveform';
import { PrismaticLiquidBlob } from '@/components/PrismaticLiquidBlob';
import { AvatarStage } from '@/components/AvatarStage';
import { MAX_RECORDING_SECONDS } from '@/hooks/usePrivacyRecorder';
import { encodeMotionTrackGzip } from '@/lib/mocap/motionCodec';
import { AudioLipSyncAnalyser, MotionSolver } from '@/lib/mocap/retargeter';
import { loadVisionModels, type VisionModels } from '@/lib/mocap/visionEngine';
import { MOTION_FPS } from '@/lib/motionPack';
import { EmotionSmoother } from '@/lib/emotionDetector';
import type { EmotionTag } from '@/lib/emotions';
import type { AvatarId, MaskRecordingPayload, MotionFrame } from '@/types/avatar';

const AUDIO_MIME_ORDER = ['audio/webm;codecs=opus', 'audio/mp4'] as const; // mp4 is what iOS Safari can record

type ModelsState = 'loading' | 'ready' | 'error';
type Models = VisionModels;

export type MaskRecorderProps = {
  /** Called when the smoothed live emotion changes (not every frame). */
  onEmotionChange?: (emotion: EmotionTag) => void;
  /** The shared hidden camera element. No second camera stream is opened here. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** The shared microphone stream, recorded as it is (no effects). It is only read, never stopped. */
  audioStream: MediaStream | null;
  onRecordingComplete: (payload: MaskRecordingPayload) => void;
  /** Tells the parent when recording starts and stops, so it can lock its own controls. */
  onRecordingChange?: (recording: boolean) => void;
  /** Mirror the stage like a selfie preview (the recorded motion is never mirrored). */
  mirrored?: boolean;
  /** Starting character, and a callback when it changes, so a parent that remounts this component can keep the choice. */
  initialAvatar?: AvatarId;
  onAvatarChange?: (id: AvatarId) => void;
  /** Controls shown either side of the record button. */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Allows recording in Audio + 3D Avatar mode even if no physical camera is available. */
  audioOnly?: boolean;
};

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const pickAudioMime = (): string | undefined => AUDIO_MIME_ORDER.find((t) => MediaRecorder.isTypeSupported(t));
const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function MaskRecorder({ videoRef, audioStream, onRecordingComplete, onRecordingChange, mirrored = false, initialAvatar, onAvatarChange, onEmotionChange, leading, trailing, audioOnly = false }: MaskRecorderProps) {
  const [avatarId, setAvatarId] = useState<AvatarId>(initialAvatar ?? 'cyber_monk');
  const [models, setModels] = useState<ModelsState>('loading');
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [recording, setRecording] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveEmotion, setLiveEmotion] = useState(() => new EmotionSmoother().update({}));
  const [showPrompts, setShowPrompts] = useState(false);
  const [promptIndex, setPromptIndex] = useState(0);
  const emotionSmoother = useRef(new EmotionSmoother());
  const prompts = ["What's your honest first impression?", 'Would you buy it again?', 'What surprised you most?', 'Who would you recommend it to?'];

  // Everything the 30 FPS loop touches lives in refs: the loop never causes a React render.
  const currentFrameRef = useRef<MotionFrame | null>(null);
  const framesBufferRef = useRef<MotionFrame[]>([]);
  const recordingRef = useRef(false);
  const startedAtRef = useRef(0);
  const modelsRef = useRef<Models | null>(null);
  const solverRef = useRef(new MotionSolver());
  const audioAnalyserRef = useRef(new AudioLipSyncAnalyser());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const timersRef = useRef<{ tick: ReturnType<typeof setInterval> | null; max: ReturnType<typeof setTimeout> | null }>({ tick: null, max: null });
  const aliveRef = useRef(true);
  const avatarRef = useRef(avatarId);
  const onCompleteRef = useRef(onRecordingComplete);
  const onChangeRef = useRef(onRecordingChange);

  useEffect(() => {
    avatarRef.current = avatarId;
    onCompleteRef.current = onRecordingComplete;
    onChangeRef.current = onRecordingChange;
  });

  useEffect(() => {
    onEmotionChange?.(liveEmotion.emotion);
  }, [liveEmotion.emotion, onEmotionChange]);

  useEffect(() => {
    const timer = window.setInterval(() => setLiveEmotion(emotionSmoother.current.update(currentFrameRef.current?.shapes ?? {})), 350);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const analyser = audioAnalyserRef.current;
    analyser.connect(audioStream);
    return () => analyser.dispose();
  }, [audioStream]);

  // The landmark models are shared singletons owned by the parent, which disposes them when the camera closes.
  useEffect(() => {
    let cancelled = false;
    loadVisionModels()
      .then((loaded) => {
        if (cancelled) return;
        modelsRef.current = loaded;
        setModels('ready');
      })
      .catch(() => { if (!cancelled) setModels('error'); });
    return () => {
      cancelled = true;
      modelsRef.current = null;
    };
  }, [modelsAttempt]);

  // Tracking loop: camera frame -> 1-Euro smoothed MotionFrame -> live avatar, and into buffer while recording.
  useEffect(() => {
    if (models !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    const solver = solverRef.current;
    solver.reset();
    const liveStart = performance.now();
    let raf = 0;
    let lastRun = 0;
    let lastTs = 0;
    let count = 0;
    let hands: HandLandmarkerResult | null = null;
    let pose: PoseLandmarkerResult | null = null;

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const m = modelsRef.current;
      if (!m) return;
      const intervalMs = 1000 / m.profile.targetFps;
      if (now - lastRun < intervalMs - 2) return;
      lastRun = now;
      if (video.readyState < 2 || !video.videoWidth) return;
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      try {
        const face = m.face.detectForVideo(video, ts);
        if (m.pose && count % 2 === 0) pose = m.pose.detectForVideo(video, ts);
        if (m.hand && (!hands || count % m.profile.handEveryNFrames === 0)) hands = m.hand.detectForVideo(video, ts);
        count += 1;
        const rec = recordingRef.current;
        const t = (performance.now() - (rec ? startedAtRef.current : liveStart)) / 1000;
        const audioJawFallback = audioAnalyserRef.current.sampleJawOpen();
        const frame = solver.solve(face, pose, hands, t, { mirrored, audioJawFallback });
        currentFrameRef.current = frame;
        if (rec) {
          const buffer = framesBufferRef.current;
          const target = Math.floor(t * MOTION_FPS);
          while (buffer.length <= target) buffer.push({ ...frame, t: round3(buffer.length / MOTION_FPS) });
        }
      } catch {
        /* one bad frame is skipped; the avatar keeps its last pose */
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [models, videoRef, mirrored]);

  const clearTimers = useCallback(() => {
    const t = timersRef.current;
    if (t.tick) clearInterval(t.tick);
    if (t.max) clearTimeout(t.max);
    t.tick = t.max = null;
  }, []);

  const finish = useCallback(async (recorder: MediaRecorder, chunks: Blob[], mimeType: string | undefined) => {
    clearTimers();
    recordingRef.current = false;
    const elapsed = (performance.now() - startedAtRef.current) / 1000;
    recorderRef.current = null;
    if (!aliveRef.current) return; // unmounted while recording: discard
    setRecording(false);
    onChangeRef.current?.(false);
    const frames = framesBufferRef.current;
    framesBufferRef.current = [];
    if (frames.length === 0 || chunks.length === 0) {
      setError('Nothing was recorded. Please try again.');
      return;
    }
    setFinishing(true);
    const compressedBytes = encodeMotionTrackGzip({ avatarId: avatarRef.current, fps: MOTION_FPS, frames });
    const compressedSizeKB = Math.round((compressedBytes.byteLength / 1024) * 10) / 10;
    if (!aliveRef.current) return;
    setFinishing(false);
    const audioBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
    onCompleteRef.current({
      avatarId: avatarRef.current,
      fps: MOTION_FPS,
      frames,
      compressedSizeKB,
      audioBlob,
      audioUrl: URL.createObjectURL(audioBlob), // owned by the receiver, who must revoke it
      durationSec: round1(elapsed),
    });
  }, [clearTimers]);

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  }, []);

  const startRecording = () => {
    if (recordingRef.current || models !== 'ready' || !audioStream) return;
    setError(null);
    // Original microphone audio only, as a stream of its own so stopping the recorder never touches the shared tracks.
    const audioOnly = new MediaStream(audioStream.getAudioTracks());
    const mimeType = pickAudioMime();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(audioOnly, { mimeType }) : new MediaRecorder(audioOnly);
    } catch {
      setError('Audio recording is not supported in this browser.');
      return;
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => void finish(recorder, chunks, mimeType);
    recorderRef.current = recorder;
    framesBufferRef.current = [];
    startedAtRef.current = performance.now();
    recordingRef.current = true;
    recorder.start(1000);
    setRecording(true);
    setSeconds(0);
    onChangeRef.current?.(true);
    timersRef.current.tick = setInterval(() => setSeconds(Math.floor((performance.now() - startedAtRef.current) / 1000)), 250);
    timersRef.current.max = setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
  };

  // Unmount (mode change, preview, camera closed): stop everything and discard any clip in progress.
  useEffect(() => {
    aliveRef.current = true;
    const timers = timersRef.current;
    return () => {
      aliveRef.current = false;
      recordingRef.current = false;
      if (timers.tick) clearInterval(timers.tick);
      if (timers.max) clearTimeout(timers.max);
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') rec.stop();
    };
  }, []);

  const ready = (models === 'ready' || audioOnly) && audioStream !== null;

  return (
    <div className="absolute inset-0">
      <div className={`absolute inset-0 ${mirrored ? '-scale-x-100' : ''}`}>
        <AvatarStage avatarId={avatarId} currentFrameRef={currentFrameRef} />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-36 z-[4] flex flex-col items-center text-center text-white drop-shadow-md">
        <span className="text-[9px] font-semibold uppercase tracking-[.18em] text-white/65">Detecting</span>
        <span className="text-sm font-semibold" style={{ color: liveEmotion.color }}>{liveEmotion.label}</span>
      </div>

      <AvatarSelector
        className="absolute right-3 top-1/2 z-[6] -translate-y-1/2"
        orientation="vertical"
        selectedAvatar={avatarId}
        onSelectAvatar={(id) => { setAvatarId(id); onAvatarChange?.(id); }}
        disabled={recording}
      />

      {models === 'loading' && (
        <div role="status" className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-[#0A0A0A]/70 px-8 text-center backdrop-blur-sm">
          <LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />
          <h2 className="text-lg font-semibold">Loading face tracking…</h2>
          <p className="max-w-xs text-sm text-white/70">Your avatar copies your face and hands. First load downloads the models.</p>
        </div>
      )}
      {models === 'error' && (
        <div role="status" className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-[#0A0A0A]/85 px-8 text-center backdrop-blur-sm">
          <CameraOff aria-hidden className="size-8" />
          <h2 className="text-lg font-semibold">Face tracking failed to load</h2>
          <button type="button" onClick={() => { setModels('loading'); setModelsAttempt((n) => n + 1); }} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400">
            Try again
          </button>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16">
        {showPrompts && <div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white/85 px-4 py-3 text-center text-slate-900 shadow-lg backdrop-blur-xl"><p className="text-xs font-medium text-slate-500">{promptIndex + 1} / 4</p><p className="mt-1 text-sm font-semibold">{prompts[promptIndex]}</p><div className="mt-2 flex items-center justify-between text-xs"><button type="button" onClick={() => setPromptIndex((i) => Math.max(0, i - 1))} className="min-h-8 px-2 text-slate-500">Back</button><button type="button" onClick={() => setPromptIndex((i) => (i + 1) % prompts.length)} className="acrylic-pill min-h-8 px-3 font-medium">{promptIndex + 1} / 4</button><button type="button" onClick={() => setPromptIndex((i) => (i + 1) % prompts.length)} className="min-h-8 px-2 text-slate-500">Skip</button></div></div>}
        {recording && (
          <p role="timer" aria-label="Recording time" className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums backdrop-blur-xl">
            <span aria-hidden className="size-2 rounded-full bg-red-500" />
            {formatTime(seconds)} / {formatTime(MAX_RECORDING_SECONDS)}
          </p>
        )}
        {finishing && <p role="status" className="rounded-full bg-black/50 px-3 py-1 text-xs backdrop-blur-xl">Packing your clip…</p>}
        {error && <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">{error}</p>}
        {!audioStream && models === 'ready' && <p role="status" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">Waiting for the microphone…</p>}

        <div className="flex items-center gap-2 text-white/80"><PrismaticLiquidBlob state={recording ? 'active' : 'idle'} size="sm" /><VoiceWaveform stream={audioStream} active={recording} /><button type="button" onClick={() => setShowPrompts((show) => !show)} aria-pressed={showPrompts} className="acrylic-pill min-h-9 px-3 text-xs font-semibold">{showPrompts ? 'Hide prompts' : 'Guided prompts'}</button></div>

        <div className="flex w-full items-center justify-between">
          <div className="flex size-12 items-center justify-center">{leading}</div>
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={!recording && (!ready || finishing)}
            aria-label={recording ? 'Stop recording' : 'Start recording'}
            className="flex size-20 items-center justify-center rounded-full border-4 border-white transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 disabled:opacity-40"
          >
            {recording
              ? <span className="flex size-12 items-center justify-center rounded-xl bg-red-500 animate-pulse motion-reduce:animate-none"><Square aria-hidden className="size-5 fill-white text-white" /></span>
              : <span className="size-14 rounded-full bg-red-500" />}
          </button>
          <div className="flex size-12 items-center justify-center">{trailing}</div>
        </div>
      </div>
    </div>
  );
}
