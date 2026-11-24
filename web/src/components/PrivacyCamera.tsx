'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CameraOff,
  Gauge,
  Grid3x3,
  ImagePlus,
  LoaderCircle,
  Lock,
  Sparkles,
  Square,
  Sun,
  SwitchCamera,
  Timer,
  X,
  Zap,
  ZapOff,
} from 'lucide-react';
import type { Detection, FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import { motion, useReducedMotion } from 'framer-motion';
import { ClayEmotionOrb } from '@/components/ClayEmotionOrb';
import { MaskPlayer } from '@/components/MaskPlayer';
import { MaskRecorder } from '@/components/MaskRecorder';
import { ModeSelector } from '@/components/ModeSelector';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { useCameraStream } from '@/hooks/useCameraStream';
import { usePrivacyRecorder } from '@/hooks/usePrivacyRecorder';
import { buildCanvasFilter, CAMERA_FILTERS, type FilterId } from '@/lib/cameraFilters';
import { drawBlurFrame, drawNoFaceGuardFrame, drawShadowFrame } from '@/lib/canvasRenderers';
import { shouldUsePixelFallback } from '@/lib/device';
import type { EmotionTag } from '@/lib/emotions';
import { setImmersive } from '@/lib/immersive';
import { disposeMediaPipe, getFaceDetector, getImageSegmenter } from '@/lib/mediapipe';
import type { AvatarId, MaskRecordingPayload } from '@/types/avatar';
import type { PrivacyMode, RecordedSnapPayload } from '@/types/privacy';

const CANVAS_W = 540;
const CANVAS_H = 960;
const FRAME_MS = 1000 / 30;
const HOLD_FRAMES = 10;
const FPS_FLOOR = 20;
const FPS_WINDOW_MS = 2000;
const MAX_FRAME_ERRORS = 30;

type ModelsState = 'loading' | 'ready' | 'error';
type Models = { detector: FaceDetector; segmenter: ImageSegmenter };
type DurationLimit = 15 | 30 | 60;
type TimerDelay = 0 | 3 | 10;
type SpeedRate = 0.5 | 1 | 2;

export type PrivacyCameraProps = {
  onPublished?: (postId: string) => void;
  onSubmitMedia?: (payload: RecordedSnapPayload | MaskRecordingPayload) => Promise<void>;
  submitLabel?: string;
  onClose?: () => void;
  className?: string;
};

const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function PrivacyCamera({ onPublished, onSubmitMedia, submitLabel, onClose, className = '' }: PrivacyCameraProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setImmersive('camera', true);
    return () => setImmersive('camera', false);
  }, []);

  const [mode, setMode] = useState<PrivacyMode>('mask');
  const [liveEmotion, setLiveEmotion] = useState<EmotionTag>('chill');
  const {
    videoRef,
    audioStream,
    phase: camPhase,
    facing,
    notice: camNotice,
    devices,
    selectedDeviceId,
    zoomRange,
    hasTorch,
    flip: flipCamera,
    retry: retryCamera,
    selectDevice,
    startAudioOnly,
    setHardwareZoom,
    setTorch,
  } = useCameraStream({ mode });

  // Creator & Camera controls state
  const [durationLimit, setDurationLimit] = useState<DurationLimit>(30);
  const [timerDelay, setTimerDelay] = useState<TimerDelay>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [speedRate, setSpeedRate] = useState<SpeedRate>(1);
  const [showGrid, setShowGrid] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [screenFlashActive, setScreenFlashActive] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [filterId, setFilterId] = useState<FilterId>('natural');
  const [showFilters, setShowFilters] = useState(false);
  const [exposure, setExposure] = useState(0);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [handsFreeLocked, setHandsFreeLocked] = useState(false);
  const [importedMedia, setImportedMedia] = useState<{ url: string; blob: Blob; mimeType: string } | null>(null);

  const recorder = usePrivacyRecorder({ canvasRef, audioStream, maxSeconds: durationLimit });

  // UI & model states
  const [legacyWanted, setLegacyWanted] = useState(false);
  const [maskPayload, setMaskPayload] = useState<MaskRecordingPayload | null>(null);
  const [maskRecording, setMaskRecording] = useState(false);
  const [maskAvatar, setMaskAvatar] = useState<AvatarId>('cyber_monk');
  const [models, setModels] = useState<ModelsState>('loading');
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [faceLocked, setFaceLocked] = useState(false);

  // Refs for 30fps loop & gesture tracking
  const modeRef = useRef<PrivacyMode>('mask');
  const recordingRef = useRef(false);
  const faceRef = useRef(false);
  const pixelRef = useRef(false);
  const modelsRef = useRef<Models | null>(null);
  const startModeRef = useRef<PrivacyMode>('mask');
  const maskPayloadRef = useRef<MaskRecordingPayload | null>(null);
  const filterRef = useRef<FilterId>('natural');
  const exposureRef = useRef(0);
  const zoomRef = useRef(1);
  const zoomSupportedRef = useRef(false);
  const lastTapAtRef = useRef(0);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const shutterStartRef = useRef<{ x: number; y: number; time: number; zoom: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const shutterActiveHoldRef = useRef(false);

  const activeFilter = CAMERA_FILTERS.find((f) => f.id === filterId) ?? CAMERA_FILTERS[0];
  const showPreview = (recorder.recordedUrl !== null && recorder.recordedBlob !== null) || importedMedia !== null;
  const inPreview = showPreview || Boolean(maskPayload);
  const loopActive = camPhase === 'ready' && !showPreview && mode !== 'mask';

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { recordingRef.current = recorder.isRecording; }, [recorder.isRecording]);
  useEffect(() => { filterRef.current = filterId; }, [filterId]);
  useEffect(() => { exposureRef.current = exposure; }, [exposure]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { zoomSupportedRef.current = Boolean(zoomRange); }, [zoomRange]);

  // iOS Safari edge-swipe back support while in preview
  const previewHistoryRef = useRef(false);
  useEffect(() => {
    if (!inPreview) {
      previewHistoryRef.current = false;
      return;
    }
    if (!previewHistoryRef.current) {
      window.history.pushState({ preview: true }, '');
      previewHistoryRef.current = true;
    }
    const onPopState = () => {
      previewHistoryRef.current = false;
      recorder.resetRecording();
      if (importedMedia) {
        URL.revokeObjectURL(importedMedia.url);
        setImportedMedia(null);
      }
      if (maskPayloadRef.current) {
        URL.revokeObjectURL(maskPayloadRef.current.audioUrl);
        setMaskPayload(null);
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [inPreview, recorder, importedMedia]);

  // Load 2D privacy models lazily
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

  useEffect(() => () => { void disposeMediaPipe(); }, []);
  useEffect(() => { maskPayloadRef.current = maskPayload; }, [maskPayload]);
  useEffect(() => () => {
    if (maskPayloadRef.current) URL.revokeObjectURL(maskPayloadRef.current.audioUrl);
  }, []);

  // Torch sync for back camera
  useEffect(() => {
    if (facing === 'environment' && hasTorch) {
      void setTorch(flashOn);
    }
  }, [facing, hasTorch, flashOn, setTorch]);

  // 30 FPS privacy + aesthetic filter + digital zoom render loop
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
      if (now - lastFrame < FRAME_MS - 2) return;
      lastFrame = now;

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
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      try {
        const preset = CAMERA_FILTERS.find((f) => f.id === filterRef.current) ?? CAMERA_FILTERS[0];
        const cssFilter = buildCanvasFilter(preset, exposureRef.current);
        const digitalScale = zoomSupportedRef.current ? 1 : Math.max(0.5, zoomRef.current);

        ctx.save();
        if (digitalScale !== 1) {
          ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
          ctx.scale(digitalScale, digitalScale);
          ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
        }
        ctx.filter = cssFilter;

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

        ctx.filter = 'none';
        if (preset.tint) {
          ctx.fillStyle = preset.tint;
          ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }
        ctx.restore();
        errors = 0;
      } catch {
        ctx.restore();
        blank();
        if (++errors >= MAX_FRAME_ERRORS) setModels('error');
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loopActive, videoRef]);

  const applyZoomLevel = useCallback((nextZoom: number) => {
    const clamped = Math.round(Math.min(4, Math.max(0.5, nextZoom)) * 10) / 10;
    setZoom(clamped);
    if (zoomRange && clamped >= zoomRange.min) {
      void setHardwareZoom(Math.min(zoomRange.max, clamped));
    }
  }, [zoomRange, setHardwareZoom]);

  const canRecord = camPhase === 'ready' && models === 'ready' && !(mode === 'noface' && faceLocked);

  const beginRecordingNow = useCallback(() => {
    if (mode === 'noface' && faceRef.current) return;
    startModeRef.current = modeRef.current;
    if (flashOn && facing === 'user') setScreenFlashActive(true);
    void recorder.startRecording();
  }, [mode, flashOn, facing, recorder]);

  const triggerWithTimer = useCallback((action: () => void) => {
    if (timerDelay === 0) {
      action();
      return;
    }
    setCountdown(timerDelay);
    let left = timerDelay;
    const id = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(id);
        setCountdown(null);
        action();
      } else {
        setCountdown(left);
      }
    }, 1000);
  }, [timerDelay]);

  const captureSnapshot = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canRecord) return;
    if (flashOn && facing === 'user') {
      setScreenFlashActive(true);
      window.setTimeout(() => setScreenFlashActive(false), 350);
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setImportedMedia({ url, blob, mimeType: blob.type || 'image/png' });
    }, 'image/png');
  }, [canRecord, flashOn, facing]);

  const stopAllRecording = useCallback(() => {
    setHandsFreeLocked(false);
    setScreenFlashActive(false);
    recorder.stopRecording();
  }, [recorder]);

  // Smart Shutter pointer handlers (Tap = snapshot, Hold = video, Slide Up = zoom, Slide Left = hands-free lock)
  const onShutterPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (recorder.isRecording) {
      stopAllRecording();
      return;
    }
    if (!canRecord || countdown !== null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    shutterActiveHoldRef.current = false;
    shutterStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now(), zoom };
    holdTimerRef.current = window.setTimeout(() => {
      shutterActiveHoldRef.current = true;
      triggerWithTimer(beginRecordingNow);
    }, 220);
  };

  const onShutterPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = shutterStartRef.current;
    if (!start || !shutterActiveHoldRef.current) return;
    const dy = start.y - e.clientY;
    const dx = start.x - e.clientX;
    if (dy > 10) {
      applyZoomLevel(start.zoom + (dy - 10) / 80);
    }
    if (dx > 55 && !handsFreeLocked) {
      setHandsFreeLocked(true);
    }
  };

  const onShutterPointerUp = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    const wasHold = shutterActiveHoldRef.current;
    shutterStartRef.current = null;
    shutterActiveHoldRef.current = false;

    if (!wasHold && !recorder.isRecording && countdown === null) {
      triggerWithTimer(captureSnapshot);
      return;
    }
    if (wasHold && recorder.isRecording && !handsFreeLocked) {
      stopAllRecording();
    }
  };

  // Viewfinder tap-to-focus, double-tap-to-flip, and pinch-to-zoom
  const onViewfinderTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.hypot(dx, dy);
      pinchStartZoomRef.current = zoom;
    }
  };

  const onViewfinderTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      applyZoomLevel(pinchStartZoomRef.current * (dist / pinchStartDistRef.current));
    }
  };

  const onViewfinderTouchEnd = () => {
    pinchStartDistRef.current = null;
  };

  const onViewfinderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (mode === 'mask' || showPreview) return;
    const now = Date.now();
    if (now - lastTapAtRef.current < 280) {
      lastTapAtRef.current = 0;
      if (camPhase === 'ready' && !recorder.isRecording) void flipCamera();
      return;
    }
    lastTapAtRef.current = now;
    const rect = e.currentTarget.getBoundingClientRect();
    setFocusPoint({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    window.setTimeout(() => setFocusPoint((cur) => (cur ? null : null)), 2500);
  };

  const handleGalleryPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImportedMedia({ url, blob: file, mimeType: file.type || 'video/mp4' });
    e.target.value = '';
  };

  const getSnap = useCallback((): Omit<RecordedSnapPayload, 'url' | 'expiry'> | null => {
    if (importedMedia) {
      return {
        blob: importedMedia.blob,
        mimeType: importedMedia.mimeType,
        mode: startModeRef.current,
        durationSec: 5,
      };
    }
    const blob = recorder.recordedBlob;
    if (!blob) return null;
    return { blob, mimeType: recorder.mimeType || blob.type, mode: startModeRef.current, durationSec: recorder.durationSec };
  }, [recorder, importedMedia]);

  const submitMedia = onSubmitMedia
    ? async (payload: RecordedSnapPayload | MaskRecordingPayload) => {
        await onSubmitMedia(payload);
        if ('frames' in payload) URL.revokeObjectURL(payload.audioUrl);
        onClose?.();
      }
    : undefined;

  const selectMode = (next: PrivacyMode) => {
    setMode(next);
    if (next !== 'mask') {
      setLegacyWanted(true);
      setLiveEmotion('chill');
    }
  };

  const retakeMask = () => {
    if (maskPayload) URL.revokeObjectURL(maskPayload.audioUrl);
    setMaskPayload(null);
  };

  const retake2D = () => {
    if (importedMedia) {
      URL.revokeObjectURL(importedMedia.url);
      setImportedMedia(null);
    }
    recorder.resetRecording();
  };

  const retryModels = () => { setModels('loading'); setModelsAttempt((n) => n + 1); };
  const mirrored = facing === 'user';

  const closeButton = (
    <button
      type="button"
      onClick={() => (onClose ? onClose() : router.push('/feed'))}
      aria-label={onClose ? 'Close camera' : 'Back to feed'}
      className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-white"
    >
      {onClose ? <X aria-hidden className="size-5" /> : <ArrowLeft aria-hidden className="size-5" />}
    </button>
  );

  const flipButton = (
    <button
      type="button"
      onClick={() => void flipCamera()}
      disabled={camPhase !== 'ready' || recorder.isRecording || maskRecording}
      aria-label="Flip camera"
      className="flex size-11 items-center justify-center rounded-full border border-white/20 bg-black/35 text-white backdrop-blur-xl focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40"
    >
      <SwitchCamera aria-hidden className="size-5" />
    </button>
  );

  const progress = Math.min(1, recorder.recordingSeconds / durationLimit);
  const ringR = 38;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  return (
    <div
      onTouchStart={onViewfinderTouchStart}
      onTouchMove={onViewfinderTouchMove}
      onTouchEnd={onViewfinderTouchEnd}
      onClick={onViewfinderClick}
      className={`viewfinder relative aspect-[9/16] w-full overflow-hidden rounded-[32px] bg-[#0A0A0A] text-white shadow-[0_20px_60px_rgba(15,23,42,.18)] ${className}`}
    >
      {/* Front Screen-Flash Warm Glow */}
      {screenFlashActive && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-30 border-[14px] border-amber-50/90 bg-amber-50/35" />
      )}

      <EmotionPeek live={mode === 'mask' ? liveEmotion : 'chill'} />

      <video ref={videoRef} playsInline muted autoPlay aria-hidden tabIndex={-1} className="pointer-events-none absolute left-0 top-0 size-px opacity-0" />
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label="Camera preview with privacy and aesthetic filters"
        className={`absolute inset-0 size-full object-cover ${mirrored ? '-scale-x-100' : ''} ${mode === 'mask' ? 'invisible' : ''}`}
      />

      {/* Rule-of-thirds 3x3 Grid Overlay */}
      {showGrid && mode !== 'mask' && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[4] grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/15" />
          ))}
        </div>
      )}

      {/* Tap-to-Focus Ring + Exposure Slider */}
      {focusPoint && mode !== 'mask' && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ left: Math.min(260, Math.max(24, focusPoint.x - 28)), top: Math.min(480, Math.max(60, focusPoint.y - 28)) }}
          className="absolute z-20 flex items-center gap-2"
        >
          <span className="size-14 rounded-full border-2 border-amber-300/90 shadow-[0_0_16px_rgba(252,211,77,0.45)]" />
          <div className="flex flex-col items-center gap-1 rounded-full bg-black/50 px-1.5 py-2 backdrop-blur-md">
            <Sun aria-hidden className="size-3.5 text-amber-300" />
            <input
              type="range"
              min={-0.35}
              max={0.35}
              step={0.05}
              value={exposure}
              aria-label="Exposure"
              onChange={(e) => setExposure(Number(e.target.value))}
              className="h-20 w-1 accent-amber-300 [writing-mode:vertical-lr]"
            />
          </div>
        </div>
      )}

      {/* Top Bar: Back Left + Mode Selector */}
      <div className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20" onClick={(e) => e.stopPropagation()}>
        {closeButton}
      </div>

      <ModeSelector activeMode={mode} onSelectMode={selectMode} disabled={recorder.isRecording || maskRecording} />

      {/* Right Slim Vertical Mini Rail (Icons Only) */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute right-3 top-[max(4.5rem,env(safe-area-inset-top))] z-20 flex flex-col items-center gap-2.5"
      >
        {flipButton}
        <button
          type="button"
          onClick={() => setFlashOn((f) => !f)}
          aria-label={flashOn ? 'Turn flash off' : 'Turn flash on'}
          aria-pressed={flashOn}
          className={`flex size-10 items-center justify-center rounded-full border backdrop-blur-xl ${flashOn ? 'border-amber-300 bg-amber-400/30 text-amber-200' : 'border-white/20 bg-black/35 text-white'}`}
        >
          {flashOn ? <Zap aria-hidden className="size-4" /> : <ZapOff aria-hidden className="size-4" />}
        </button>
        <button
          type="button"
          onClick={() => setTimerDelay((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}
          aria-label={`Timer: ${timerDelay || 'Off'}`}
          className="flex size-10 flex-col items-center justify-center rounded-full border border-white/20 bg-black/35 text-[10px] font-bold backdrop-blur-xl"
        >
          <Timer aria-hidden className="size-3.5" />
          <span>{timerDelay ? `${timerDelay}s` : 'Off'}</span>
        </button>
        <button
          type="button"
          onClick={() => setSpeedRate((s) => (s === 1 ? 2 : s === 2 ? 0.5 : 1))}
          aria-label={`Speed: ${speedRate}x`}
          className="flex size-10 flex-col items-center justify-center rounded-full border border-white/20 bg-black/35 text-[10px] font-bold backdrop-blur-xl"
        >
          <Gauge aria-hidden className="size-3.5" />
          <span>{speedRate}x</span>
        </button>
        {mode !== 'mask' && (
          <>
            <button
              type="button"
              onClick={() => setShowGrid((g) => !g)}
              aria-label="Toggle grid"
              aria-pressed={showGrid}
              className={`flex size-10 items-center justify-center rounded-full border backdrop-blur-xl ${showGrid ? 'border-white bg-white/25' : 'border-white/20 bg-black/35'}`}
            >
              <Grid3x3 aria-hidden className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowFilters((s) => !s)}
              aria-label="Toggle color filters"
              aria-pressed={showFilters}
              className={`flex size-10 items-center justify-center rounded-full border backdrop-blur-xl ${showFilters || filterId !== 'natural' ? 'border-cyan-300 bg-cyan-400/25 text-cyan-100' : 'border-white/20 bg-black/35'}`}
            >
              <Sparkles aria-hidden className="size-4" />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setDurationLimit((d) => (d === 15 ? 30 : d === 30 ? 60 : 15))}
          aria-label={`Max duration: ${durationLimit}s`}
          className="flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/35 text-[11px] font-bold backdrop-blur-xl"
        >
          {durationLimit}s
        </button>
      </div>

      {/* Countdown Overlay */}
      {countdown !== null && (
        <div role="status" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/35 backdrop-blur-[2px]">
          <span className="text-7xl font-black tabular-nums drop-shadow-lg">{countdown}</span>
        </div>
      )}

      {/* Status & Error Overlays with Device Switcher + Audio-Only Fallback */}
      {camPhase === 'requesting' && <Overlay icon={<LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />} title="Starting camera…" body="Allow camera and microphone access when asked." />}
      {camPhase === 'ready' && mode !== 'mask' && models === 'loading' && <Overlay icon={<LoaderCircle aria-hidden className="size-8 animate-spin motion-reduce:animate-none" />} title="Loading privacy filters…" body="First load downloads the face models." />}
      {camPhase === 'ready' && mode !== 'mask' && models === 'error' && <Overlay icon={<CameraOff aria-hidden className="size-8" />} title="Privacy filters failed to load" body="Recording is locked until they load." action={<Action onClick={retryModels}>Try again</Action>} />}
      {(camPhase === 'denied' || camPhase === 'unsupported' || camPhase === 'error') && (
        <Overlay
          icon={<CameraOff aria-hidden className="size-8" />}
          title={camPhase === 'denied' ? 'Camera or microphone blocked' : camPhase === 'unsupported' ? 'Camera needs HTTPS' : 'Couldn’t start the camera'}
          body={camPhase === 'denied' ? 'Allow camera & mic in browser settings, or switch to Audio + 3D Avatar mode.' : 'Another app may hold the camera, or this page is not HTTPS.'}
          action={
            <div className="flex flex-col items-center gap-2.5">
              {devices.length > 1 && (
                <select
                  aria-label="Choose camera"
                  value={selectedDeviceId ?? ''}
                  onChange={(e) => void selectDevice(e.target.value)}
                  className="min-h-10 rounded-full bg-white/15 px-4 text-xs text-white backdrop-blur-md"
                >
                  <option value="" className="text-black">Switch camera…</option>
                  {devices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId} className="text-black">
                      {d.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <Action onClick={() => void retryCamera()}>Try again</Action>
                <button
                  type="button"
                  onClick={() => { setMode('mask'); void startAudioOnly(); }}
                  className="min-h-11 rounded-full border border-white/25 bg-white/10 px-4 text-xs font-semibold text-white"
                >
                  Audio + Avatar Mode
                </button>
              </div>
            </div>
          }
        />
      )}

      {mode === 'mask' && camNotice && (
        <div className="absolute inset-x-0 top-24 z-10 flex flex-col items-center gap-2 px-4">
          <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">{camNotice}</p>
        </div>
      )}

      {/* Mask 3D Mode */}
      {mode === 'mask' && (camPhase === 'ready' || camPhase === 'audio-only') && !maskPayload && (
        <MaskRecorder
          onEmotionChange={setLiveEmotion}
          videoRef={videoRef}
          audioStream={audioStream}
          onRecordingComplete={setMaskPayload}
          onRecordingChange={setMaskRecording}
          mirrored={mirrored}
          initialAvatar={maskAvatar}
          onAvatarChange={setMaskAvatar}
          leading={closeButton}
          trailing={flipButton}
          audioOnly={camPhase === 'audio-only'}
        />
      )}
      {mode === 'mask' && maskPayload && (
        <MaskPlayer payload={maskPayload} onRetake={retakeMask} submit={submitMedia} submitLabel={submitLabel} onPublished={(postId) => { URL.revokeObjectURL(maskPayload.audioUrl); onPublished?.(postId); }} />
      )}

      {/* 2D Modes Bottom Controls: Zoom Pills + Filter Carousel + Gallery + Smart Shutter */}
      {mode !== 'mask' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2.5 bg-gradient-to-t from-black/75 via-black/30 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-14"
        >
          {mode === 'noface' && faceLocked && camPhase === 'ready' && (
            <p role="status" className="flex items-center gap-2 rounded-full border border-red-400/40 bg-red-500/20 px-3 py-1.5 text-xs font-semibold text-red-100 backdrop-blur-xl">
              <Lock aria-hidden className="size-3.5" /> Face in frame — recording locked
            </p>
          )}
          {recorder.isRecording && (
            <p role="timer" aria-label="Recording time" className="flex items-center gap-2 rounded-full bg-black/55 px-3 py-1 text-xs font-semibold tabular-nums backdrop-blur-xl">
              <span aria-hidden className="size-2 rounded-full bg-red-500 animate-pulse" />
              {formatTime(recorder.recordingSeconds)} / {formatTime(durationLimit)}
              {handsFreeLocked && <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">LOCKED</span>}
            </p>
          )}
          {(recorder.error || camNotice) && <p role="alert" className="rounded-full bg-black/60 px-3 py-1 text-xs text-white/90">{recorder.error ?? camNotice}</p>}

          {/* Quick Zoom Pills */}
          <div className="flex items-center gap-1.5 rounded-full bg-black/40 p-1 backdrop-blur-md">
            {[0.5, 1, 2].map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => applyZoomLevel(z)}
                className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition ${Math.abs(zoom - z) < 0.2 ? 'bg-white text-black' : 'text-white/80'}`}
              >
                {z}x
              </button>
            ))}
          </div>

          {/* Color Filter Carousel */}
          {showFilters && (
            <div className="flex w-full max-w-sm gap-2 overflow-x-auto pb-1 no-scrollbar">
              {CAMERA_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterId(f.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold backdrop-blur-md ${filterId === f.id ? 'border-white bg-white text-black' : 'border-white/20 bg-black/45 text-white'}`}
                >
                  <span aria-hidden className="size-3 rounded-full" style={{ background: f.swatch }} />
                  {f.label}
                </button>
              ))}
            </div>
          )}

          {/* Bottom Row: Gallery Import | Smart Shutter | Flip */}
          <div className="flex w-full items-center justify-between px-2">
            <div>
              <input ref={galleryInputRef} type="file" accept="video/*,image/*" onChange={handleGalleryPick} className="hidden" />
              <button
                type="button"
                onClick={() => galleryInputRef.current?.click()}
                aria-label="Import from gallery"
                className="flex size-12 items-center justify-center rounded-2xl border border-white/25 bg-white/15 text-white backdrop-blur-xl"
              >
                <ImagePlus aria-hidden className="size-5" />
              </button>
            </div>

            {/* Smart Shutter Button */}
            <button
              type="button"
              onPointerDown={onShutterPointerDown}
              onPointerMove={onShutterPointerMove}
              onPointerUp={onShutterPointerUp}
              onPointerCancel={onShutterPointerUp}
              disabled={!recorder.isRecording && !canRecord}
              aria-label={recorder.isRecording ? 'Stop recording' : 'Tap for photo, hold for video'}
              className="relative flex size-20 touch-none items-center justify-center rounded-full border-4 border-white/90 transition-transform active:scale-95 disabled:opacity-40"
            >
              {recorder.isRecording && (
                <svg aria-hidden viewBox="0 0 84 84" className="pointer-events-none absolute -inset-1 size-[calc(100%+8px)] -rotate-90">
                  <circle cx="42" cy="42" r={ringR} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
                  <circle
                    cx="42"
                    cy="42"
                    r={ringR}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeDasharray={ringC}
                    strokeDashoffset={ringOffset}
                  />
                </svg>
              )}
              {recorder.isRecording ? (
                <span className="flex size-11 items-center justify-center rounded-xl bg-red-500">
                  <Square aria-hidden className="size-5 fill-white text-white" />
                </span>
              ) : (
                <span className="size-14 rounded-full bg-red-500" />
              )}
            </button>

            <div className="flex size-12 items-center justify-center">{flipButton}</div>
          </div>
        </div>
      )}

      {showPreview && (importedMedia?.url || recorder.recordedUrl) && (
        <PreviewPlayer
          videoUrl={(importedMedia?.url ?? recorder.recordedUrl)!}
          mimeType={importedMedia?.mimeType ?? recorder.mimeType}
          onRetake={retake2D}
          getSnap={getSnap}
          onPublished={onPublished}
          submit={submitMedia}
          submitLabel={submitLabel}
        />
      )}
    </div>
  );
}

function Overlay({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <div role="status" className="absolute inset-0 z-[15] flex flex-col items-center justify-center gap-3 bg-[#0A0A0A]/85 px-8 text-center backdrop-blur-sm">
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

const PEEK_COMPANIONS: Record<EmotionTag, [EmotionTag, EmotionTag]> = {
  joy: ['surprised', 'chill'],
  angry: ['sad', 'chill'],
  surprised: ['joy', 'chill'],
  sad: ['chill', 'angry'],
  chill: ['joy', 'surprised'],
};

function EmotionPeek({ live }: { live: EmotionTag }) {
  const reduce = useReducedMotion();
  const [left, right] = PEEK_COMPANIONS[live];
  return (
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 items-end gap-2">
      <ClayEmotionOrb emotion={left} size={28} className="emotion-peek opacity-80" />
      <motion.span key={live} initial={reduce ? false : { scale: 0.6 }} animate={reduce ? undefined : { scale: [1, 1.12, 1] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
        <ClayEmotionOrb emotion={live} size={42} />
      </motion.span>
      <ClayEmotionOrb emotion={right} size={24} className="emotion-peek opacity-80 [animation-delay:300ms]" />
    </div>
  );
}
