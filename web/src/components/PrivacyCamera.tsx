'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraOff, Lock, LoaderCircle, Square, SwitchCamera, X } from 'lucide-react';
import type { Detection, FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import { ModeSelector } from '@/components/ModeSelector';
import { MaskPlayer } from '@/components/MaskPlayer';
import { MaskRecorder } from '@/components/MaskRecorder';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { useCameraStream } from '@/hooks/useCameraStream';
import { MAX_RECORDING_SECONDS, usePrivacyRecorder } from '@/hooks/usePrivacyRecorder';
import { shouldUsePixelFallback } from '@/lib/device';
import { setImmersive } from '@/lib/immersive';
import { drawBlurFrame, drawNoFaceGuardFrame, drawShadowFrame } from '@/lib/canvasRenderers';
import { disposeMediaPipe, getFaceDetector, getImageSegmenter } from '@/lib/mediapipe';
import type { AvatarId, MaskRecordingPayload } from '@/types/avatar';
import type { PrivacyMode, RecordedSnapPayload } from '@/types/privacy';

const CANVAS_W = 540;
const CANVAS_H = 960; // 9:16
const FRAME_MS = 1000 / 30;
const HOLD_FRAMES = 10; // a face that vanishes for a few frames (missed detection) stays covered for ~⅓ s
const FPS_FLOOR = 20;
const FPS_WINDOW_MS = 2000;
const MAX_FRAME_ERRORS = 30;

type ModelsState = 'loading' | 'ready' | 'error';
type Models = { detector: FaceDetector; segmenter: ImageSegmenter };

export type PrivacyCameraProps = {
  /** Called after a post is uploaded and live, just before the app moves to /feed. */
  onPublished?: (postId: string) => void;
  /**
   * When given, the Post button gives the finished clip to this function (and then closes) instead of publishing a
   * feed post. A 3D mask clip's `audioUrl` is revoked afterwards; a 2D clip's `url` belongs to the recorder.
   */
  onSubmitMedia?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
  /** When provided, a close button is shown (use it when embedding as a modal). */
  onClose?: () => void;
  className?: string;
};

const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function PrivacyCamera({ onPublished, onSubmitMedia, submitLabel, onClose, className = '' }: PrivacyCameraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // While the camera is open the floating navigation steps aside.
  useEffect(() => {
    setImmersive('camera', true);
    return () => setImmersive('camera', false);
  }, []);
  const { videoRef, audioStream, phase: camPhase, facing, notice: camNotice, flip: flipCamera, retry: retryCamera } = useCameraStream();
  const recorder = usePrivacyRecorder({ canvasRef, audioStream });

  // UI state. Only `faceLocked` is ever set from the render loop, and only when it actually flips.
  const [mode, setMode] = useState<PrivacyMode>('mask');
  const [legacyWanted, setLegacyWanted] = useState(false); // blur/shadow/noface models load only once one of those modes is chosen
  const [maskPayload, setMaskPayload] = useState<MaskRecordingPayload | null>(null);
  const [maskRecording, setMaskRecording] = useState(false);
  const [maskAvatar, setMaskAvatar] = useState<AvatarId>('cyber_monk'); // survives the recorder remounting after a retake
  const [models, setModels] = useState<ModelsState>('loading');
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [faceLocked, setFaceLocked] = useState(false);

  // Render-loop state lives in refs so the 30 FPS loop never triggers a React render.
  const modeRef = useRef<PrivacyMode>('mask');
  const recordingRef = useRef(false);
  const faceRef = useRef(false);
  const pixelRef = useRef(false);
  const modelsRef = useRef<Models | null>(null);
  const startModeRef = useRef<PrivacyMode>('mask');
  const maskPayloadRef = useRef<MaskRecordingPayload | null>(null);

  const showPreview = recorder.recordedUrl !== null && recorder.recordedBlob !== null;
  const loopActive = camPhase === 'ready' && !showPreview && mode !== 'mask'; // mask mode has its own tracking loop and a WebGL stage

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { recordingRef.current = recorder.isRecording; }, [recorder.isRecording]);

  // Blur / Shadow / NoFace models: loaded in parallel, and only once one of those modes is wanted.
  useEffect(() => {
    if (!legacyWanted) return;
    let cancelled = false;
    Promise.all([getFaceDetector(), getImageSegmenter()])
      .then(([detector, segmenter]) => {
        if (cancelled) return;
        modelsRef.current = { detector, segmenter };
        setModels('ready');
      })
      .catch(() => { if (!cancelled) setModels('error'); });
    return () => {
      cancelled = true;
      modelsRef.current = null;
    };
  }, [modelsAttempt, legacyWanted]);

  // All MediaPipe models (including the mask landmarkers) are freed when the camera closes, not on every mode change.
  useEffect(() => () => { void disposeMediaPipe(); }, []);

  // A finished mask clip that was never posted must not leak its audio URL.
  useEffect(() => { maskPayloadRef.current = maskPayload; }, [maskPayload]);
  useEffect(() => () => { if (maskPayloadRef.current) URL.revokeObjectURL(maskPayloadRef.current.audioUrl); }, []);

  // The render loop: hidden video -> MediaPipe -> canvas. Fail closed: until a frame is safely processed,
  // the canvas shows a blank frame, never the raw camera.
  useEffect(() => {
    if (!loopActive) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !video || !ctx) return;

    const offscreen = document.createElement('canvas');
    pixelRef.current = shouldUsePixelFallback();
    let raf = 0;
    let lastFrame = 0;
    let lastTs = 0;
    let held: Detection[] = [];
    let heldAge = 0;
    let errors = 0;
    let windowStart = 0;
    let windowFrames = 0;
    let slowWindows = 0;

    const blank = () => { ctx.fillStyle = '#0A0A0A'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); };
    const syncFace = (v: boolean) => { if (faceRef.current !== v) { faceRef.current = v; setFaceLocked(v); } };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS - 2) return; // cap at ~30 FPS
      lastFrame = now;

      // Slow device? Switch Blur to the cheap mosaic. Never switch mid-recording (the look would change).
      if (!windowStart) windowStart = now;
      windowFrames += 1;
      if (now - windowStart >= FPS_WINDOW_MS) {
        const fps = (windowFrames * 1000) / (now - windowStart);
        if (!recordingRef.current && !pixelRef.current) {
          slowWindows = fps < FPS_FLOOR ? slowWindows + 1 : 0;
          if (slowWindows >= 2) pixelRef.current = true;
        }
        windowStart = now;
        windowFrames = 0;
      }

      const m = modelsRef.current;
      if (!m || video.readyState < 2 || !video.videoWidth) { blank(); syncFace(false); return; }
      const ts = Math.max(performance.now(), lastTs + 1); // MediaPipe needs strictly increasing timestamps
      lastTs = ts;
      try {
        if (modeRef.current === 'shadow') {
          m.segmenter.segmentForVideo(video, ts, (r) => drawShadowFrame(ctx, video, r.categoryMask ?? null, CANVAS_W, CANVAS_H, offscreen));
          syncFace(false);
        } else {
          const found = m.detector.detectForVideo(video, ts).detections;
          if (found.length) { held = found; heldAge = 0; } else if (held.length && heldAge < HOLD_FRAMES) heldAge += 1; else held = [];
          const used = found.length ? found : held;
          const r = modeRef.current === 'blur'
            ? drawBlurFrame(ctx, video, used, CANVAS_W, CANVAS_H, pixelRef.current)
            : drawNoFaceGuardFrame(ctx, video, used, CANVAS_W, CANVAS_H);
          syncFace(r.faceDetected);
        }
        errors = 0;
      } catch {
        blank(); // never leave a half-drawn (possibly unfiltered) frame behind
        if (++errors >= MAX_FRAME_ERRORS) setModels('error');
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loopActive, videoRef]);

  const canRecord = camPhase === 'ready' && models === 'ready' && !(mode === 'noface' && faceLocked);

  const toggleRecording = () => {
    if (recorder.isRecording) { recorder.stopRecording(); return; }
    if (mode === 'noface' && faceRef.current) return; // re-check the live value, not the possibly stale UI state
    startModeRef.current = modeRef.current;
    void recorder.startRecording();
  };

  /** Read at the moment Post is tapped, so it always reflects the mode the clip was recorded in. */
  const getSnap = useCallback((): Omit<RecordedSnapPayload, 'url' | 'expiry'> | null => {
    const blob = recorder.recordedBlob;
    if (!blob) return null;
    return { blob, mimeType: recorder.mimeType || blob.type, mode: startModeRef.current, durationSec: recorder.durationSec };
  }, [recorder]);

  const submitMedia = onSubmitMedia
    ? async (payload: RecordedSnapPayload | MaskRecordingPayload) => {
        await onSubmitMedia(payload);
        if ('frames' in payload) URL.revokeObjectURL(payload.audioUrl);
        onClose?.();
      }
    : undefined;

  const selectMode = (next: PrivacyMode) => {
    setMode(next);
    if (next !== 'mask') setLegacyWanted(true);
  };

  const retakeMask = () => {
    if (maskPayload) URL.revokeObjectURL(maskPayload.audioUrl);
    setMaskPayload(null);
  };

  const retryModels = () => { setModels('loading'); setModelsAttempt((n) => n + 1); };

  const mirrored = facing === 'user'; // selfie preview is mirrored; the recorded canvas pixels are not

  // Shared by the 2D controls and the mask recorder's controls.
  const closeButton = onClose ? (
    <button type="button" onClick={onClose} aria-label="Close camera" className="flex size-12 items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-violet-400">
      <X aria-hidden className="size-5" />
    </button>
  ) : null;
  const flipButton = (
    <button
      type="button"
      onClick={() => void flipCamera()}
      disabled={camPhase !== 'ready' || recorder.isRecording || maskRecording}
      aria-label="Flip camera"
      className="flex size-12 items-center justify-center rounded-full border border-white/15 bg-white/10 backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-violet-400 disabled:opacity-40"
    >
      <SwitchCamera aria-hidden className="size-5" />
    </button>
  );

  return (
    <div className={`viewfinder relative aspect-[9/16] w-full overflow-hidden rounded-[32px] bg-[#0A0A0A] text-white shadow-[0_20px_60px_rgba(15,23,42,.18)] ${className}`}>
      <span aria-hidden className="scan-bracket scan-tl" /><span aria-hidden className="scan-bracket scan-tr" /><span aria-hidden className="scan-bracket scan-bl" /><span aria-hidden className="scan-bracket scan-br" />
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
        <i className="emotion-peek size-7 rounded-full bg-[#7ED957] shadow-[0_4px_14px_#7ED95780]" /><i className="emotion-peek size-9 rounded-full bg-[#9B87F5] shadow-[0_4px_14px_#9B87F580] [animation-delay:220ms]" /><i className="emotion-peek size-6 rounded-full bg-[#7CC6FE] shadow-[0_4px_14px_#7CC6FE80] [animation-delay:420ms]" />
      </div>
      {/* Off-screen but still laid out: some browsers stop decoding frames of display:none videos. */}
      <video ref={videoRef} playsInline muted autoPlay aria-hidden tabIndex={-1} className="pointer-events-none absolute left-0 top-0 size-px opacity-0" />
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label="Camera preview with your privacy mode applied"
        className={`absolute inset-0 size-full object-cover ${mirrored ? '-scale-x-100' : ''} ${mode === 'mask' ? 'invisible' : ''}`}
      />

      <ModeSelector activeMode={mode} onSelectMode={selectMode} disabled={recorder.isRecording || maskRecording} />

      {camPhase === 'requesting' && <Overlay icon={<LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />} title="Starting camera…" body="Allow camera and microphone access when asked." />}
      {camPhase === 'ready' && mode !== 'mask' && models === 'loading' && <Overlay icon={<LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />} title="Loading privacy filters…" body="First load downloads the face models." />}
      {camPhase === 'ready' && mode !== 'mask' && models === 'error' && <Overlay icon={<CameraOff aria-hidden className="size-8" />} title="Privacy filters failed to load" body="Recording is locked until they load, so your face can never be recorded unfiltered." action={<Action onClick={retryModels}>Try again</Action>} />}
      {camPhase === 'denied' && <Overlay icon={<CameraOff aria-hidden className="size-8" />} title="Camera or microphone blocked" body="Allow both for this site in your browser or device settings, then try again." action={<Action onClick={() => void retryCamera()}>Try again</Action>} />}
      {camPhase === 'unsupported' && <Overlay icon={<CameraOff aria-hidden className="size-8" />} title="Camera not available here" body="Camera access needs a secure (https) page in a modern browser." />}
      {camPhase === 'error' && <Overlay icon={<CameraOff aria-hidden className="size-8" />} title="Couldn’t start the camera" body="Another app may be using it, or no camera was found." action={<Action onClick={() => void retryCamera()}>Try again</Action>} />}

      {mode === 'mask' && camNotice && (
        <div className="absolute inset-x-0 top-24 z-10 flex flex-col items-center gap-2 px-4">
          {camNotice && <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">{camNotice}</p>}
        </div>
      )}

      {/* Mask 3D: one shared camera and microphone; the recorder and the player never exist at the same time, so there is only ever one WebGL canvas. */}
      {mode === 'mask' && camPhase === 'ready' && !maskPayload && (
        <MaskRecorder
          videoRef={videoRef}
          audioStream={audioStream}
          onRecordingComplete={setMaskPayload}
          onRecordingChange={setMaskRecording}
          mirrored={mirrored}
          initialAvatar={maskAvatar}
          onAvatarChange={setMaskAvatar}
          leading={closeButton}
          trailing={flipButton}
        />
      )}
      {mode === 'mask' && maskPayload && <MaskPlayer payload={maskPayload} onRetake={retakeMask} submit={submitMedia} submitLabel={submitLabel} onPublished={(postId) => { URL.revokeObjectURL(maskPayload.audioUrl); onPublished?.(postId); }} />}

      {mode !== 'mask' && (
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-24 bg-gradient-to-t from-black/70 to-transparent">
        {mode === 'noface' && faceLocked && camPhase === 'ready' && (
          <p role="status" className="flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 backdrop-blur-xl">
            <Lock aria-hidden className="size-3.5" /> Face in frame — recording locked
          </p>
        )}
        {recorder.isRecording && (
          <p role="timer" aria-label="Recording time" className="flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-sm font-semibold tabular-nums backdrop-blur-xl">
            <span aria-hidden className="size-2 rounded-full bg-red-500" />
            {formatTime(recorder.recordingSeconds)} / {formatTime(MAX_RECORDING_SECONDS)}
          </p>
        )}
        {(recorder.error || camNotice) && <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">{recorder.error ?? camNotice}</p>}

        <div className="flex w-full items-center justify-between">
          <div className="flex size-12 items-center justify-center">
            {closeButton}
          </div>

          <button
            type="button"
            onClick={toggleRecording}
            disabled={!recorder.isRecording && !canRecord}
            aria-label={recorder.isRecording ? 'Stop recording' : 'Start recording'}
            className="flex size-20 items-center justify-center rounded-full border-4 border-white transition-opacity focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-400 disabled:opacity-40"
          >
            {recorder.isRecording
              ? <span className="flex size-12 items-center justify-center rounded-xl bg-red-500 animate-pulse motion-reduce:animate-none"><Square aria-hidden className="size-5 fill-white text-white" /></span>
              : <span className="size-14 rounded-full bg-red-500" />}
          </button>

          {flipButton}
        </div>
      </div>
      )}

      {showPreview && recorder.recordedUrl && (
        <PreviewPlayer videoUrl={recorder.recordedUrl} mimeType={recorder.mimeType} onRetake={recorder.resetRecording} getSnap={getSnap} onPublished={onPublished} submit={submitMedia} submitLabel={submitLabel} />
      )}
    </div>
  );
}

function Overlay({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-[#0A0A0A]/85 px-8 text-center backdrop-blur-sm">
      {icon}
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="max-w-xs text-sm text-white/70">{body}</p>
      {action}
    </div>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 rounded-full bg-white px-5 text-sm font-semibold text-[#0A0A0A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400">
      {children}
    </button>
  );
}
