'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Lock, RotateCcw, Square, Sun, SwitchCamera, VenetianMask, X } from 'lucide-react';
import type { Detection, FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArFramingGuide, CameraCategoryStrip, CameraDeviceToggle, CameraTopRail, CameraXpBar, GLASS, ZoomBadge, glassIconBtn } from '@/components/camera/CameraControls';
import { CameraViewfinder } from '@/components/camera/CameraViewfinder';
import { LensCarousel, type CarouselOrbItem } from '@/components/camera/LensCarousel';
import {
  LensExplorerToast,
  MysteryBurstOverlay,
  useLensGamification,
} from '@/components/camera/LensGamification';
import { ClayEmotionOrb } from '@/components/ClayEmotionOrb';
import { MaskPlayer } from '@/components/MaskPlayer';
import { MaskRecorder } from '@/components/MaskRecorder';
import { ModeSelector, type CameraMode } from '@/components/ModeSelector';
import { PreviewPlayer } from '@/components/PreviewPlayer';
import { useCameraEngine } from '@/hooks/useCameraEngine';
import { useMultiClipRecorder } from '@/hooks/useMultiClipRecorder';
import {
  AESTHETIC_FILTERS,
  AR_LENSES,
  composeCssFilter,
  drawArLensOverlay,
  drawNormalFrame,
  type AestheticFilterId,
  type ArLensId,
} from '@/lib/camera/filterPipeline';
import { snapCameraKitAdapter, type SnapLensItem } from '@/lib/camera/snapCameraKitAdapter';
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

const XP_PER_BAR = 100;

export function PrivacyCamera({ onPublished, onSubmitMedia, submitLabel, onClose, className = '' }: PrivacyCameraProps) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setImmersive('camera', true);
    return () => setImmersive('camera', false);
  }, []);

  // Default Mode = 'normal' (Real Face Camera + Aesthetic Filters + AR Lenses)
  const [mode, setMode] = useState<CameraMode>('normal');
  const [, setLiveEmotion] = useState<EmotionTag>('chill'); // MaskRecorder reports it; the avatar shows it

  const {
    videoRef,
    videoStream,
    audioStream,
    phase: camPhase,
    facing,
    notice: camNotice,
    devices,
    selectedDeviceId,
    zoom,
    zoomRange,
    flashOn,
    screenFlashActive,
    setZoom,
    setFlashOn,
    triggerScreenFlash,
    flip: flipCamera,
    retry: retryCamera,
    selectDevice,
    startAudioOnly,
    haptic,
  } = useCameraEngine();

  // Creator & Camera controls state
  const [durationLimit, setDurationLimit] = useState<DurationLimit>(30);
  const [timerDelay, setTimerDelay] = useState<TimerDelay>(0);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [speedRate, setSpeedRate] = useState<SpeedRate>(1);
  const [showGrid, setShowGrid] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  /** Bumped on every gesture zoom so the read-out remounts and fades again. */
  const [zoomHint, setZoomHint] = useState(0);
  const [filterId, setFilterId] = useState<AestheticFilterId>('clean');
  const [lensId, setLensId] = useState<ArLensId>('none');
  const [lensCategory, setLensCategory] = useState<'snap' | 'studio'>(() =>
    snapCameraKitAdapter.isConfigured() ? 'snap' : 'studio'
  );
  const [snapLenses, setSnapLenses] = useState<SnapLensItem[]>(() =>
    snapCameraKitAdapter.getCachedCatalog()
  );
  const [activeSnapLensId, setActiveSnapLensId] = useState<string>('clean');
  const [exposure, setExposure] = useState(0);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [handsFreeLocked, setHandsFreeLocked] = useState(false);
  const [importedMedia, setImportedMedia] = useState<{ url: string; blob: Blob; mimeType: string } | null>(null);

  const {
    exploredIds,
    toast: explorerToast,
    mysteryBurstActive,
    sessionXp,
    recordLensTry,
    triggerMysteryUnlock,
  } = useLensGamification();

  const recorder = useMultiClipRecorder({ canvasRef, audioStream, maxSeconds: durationLimit });

  // Models load when privacy mode OR soft_skin OR AR lens needs face detection
  const [maskPayload, setMaskPayload] = useState<MaskRecordingPayload | null>(null);
  const [maskRecording, setMaskRecording] = useState(false);
  const [maskAvatar, setMaskAvatar] = useState<AvatarId>('cyber_monk');
  const [models, setModels] = useState<ModelsState>('loading');
  const [modelsAttempt, setModelsAttempt] = useState(0);
  const [faceLocked, setFaceLocked] = useState(false);
  const [capturedMode, setCapturedMode] = useState<CameraMode>('normal');

  const modeRef = useRef<CameraMode>('normal');
  const recordingRef = useRef(false);
  const faceRef = useRef(false);
  const pixelRef = useRef(false);
  const modelsRef = useRef<Models | null>(null);
  const startModeRef = useRef<CameraMode>('normal');
  const maskPayloadRef = useRef<MaskRecordingPayload | null>(null);
  const filterRef = useRef<AestheticFilterId>('clean');
  const lensRef = useRef<ArLensId>('none');
  const exposureRef = useRef(0);
  const zoomRef = useRef(1);
  const zoomSupportedRef = useRef(false);
  const mirroredRef = useRef(true);
  const lastTapAtRef = useRef(0);
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(1);
  const shutterStartRef = useRef<{ x: number; y: number; time: number; zoom: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const shutterActiveHoldRef = useRef(false);

  const showPreview = (recorder.recordedUrl !== null && recorder.recordedBlob !== null) || importedMedia !== null;
  const inPreview = showPreview || Boolean(maskPayload);
  const loopActive = camPhase === 'ready' && !showPreview && mode !== 'mask';

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { recordingRef.current = recorder.isRecording; }, [recorder.isRecording]);
  useEffect(() => { filterRef.current = filterId; }, [filterId]);
  useEffect(() => { lensRef.current = lensId; }, [lensId]);
  useEffect(() => { exposureRef.current = exposure; }, [exposure]);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { zoomSupportedRef.current = Boolean(zoomRange); }, [zoomRange]);
  useEffect(() => { mirroredRef.current = facing === 'user'; }, [facing]);

  // iOS Safari swipe-back support while in preview
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

  // Load MediaPipe detector + segmenter for privacy modes, soft_skin, and AR face lenses
  useEffect(() => {
    let cancelled = false;
    Promise.all([getFaceDetector(), getImageSegmenter()])
      .then(([detector, segmenter]) => {
        if (cancelled) return;
        modelsRef.current = { detector, segmenter };
        setModels('ready');
      })
      .catch(() => {
        if (!cancelled) setModels('error');
      });
    return () => {
      cancelled = true;
      modelsRef.current = null;
    };
  }, [modelsAttempt]);

  useEffect(() => () => { void disposeMediaPipe(); }, []);

  // Initialize Snap Camera Kit repository (all 21+ lenses)
  useEffect(() => {
    if (!snapCameraKitAdapter.isConfigured()) return;
    let cancelled = false;
    void snapCameraKitAdapter.initialize().then((items) => {
      if (!cancelled && items.length > 0) setSnapLenses(items);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep Snap Camera Kit stream bound to active camera stream
  useEffect(() => {
    if (!videoStream || mode === 'mask') return;
    void snapCameraKitAdapter.attachStream(videoStream, facing);
  }, [videoStream, facing, mode]);

  // Apply or clear Snap Lens cleanly on selection / mode changes
  useEffect(() => {
    if (mode !== 'normal' || lensCategory !== 'snap' || activeSnapLensId === 'clean') {
      void snapCameraKitAdapter.clearLens();
      return;
    }
    const idx = snapLenses.findIndex((l) => l.id === activeSnapLensId);
    if (idx >= 0) {
      void snapCameraKitAdapter.preloadAdjacent(idx);
    }
    void snapCameraKitAdapter.applyLens(activeSnapLensId, videoStream, facing);
  }, [mode, lensCategory, activeSnapLensId, snapLenses, videoStream, facing]);
  useEffect(() => { maskPayloadRef.current = maskPayload; }, [maskPayload]);
  useEffect(() => () => {
    if (maskPayloadRef.current) URL.revokeObjectURL(maskPayloadRef.current.audioUrl);
  }, []);

  // 60 FPS Canvas pipeline (Normal + Privacy modes + 8 Color/Beauty filters + 4 AR Face Lenses + Digital Zoom)
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

      if (video.readyState < 2 || !video.videoWidth) { blank(); syncFace(false); return; }
      const m = modelsRef.current;
      const currentMode = modeRef.current;
      // Normal mode can render immediately even while face models finish loading; privacy modes fail closed
      if (currentMode !== 'normal' && !m) {
        blank();
        syncFace(false);
        return;
      }

      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;

      try {
        const preset = AESTHETIC_FILTERS.find((f) => f.id === filterRef.current) ?? AESTHETIC_FILTERS[0];
        const cssFilter = composeCssFilter(preset, exposureRef.current);
        const digitalScale = zoomSupportedRef.current ? 1 : Math.max(0.5, zoomRef.current);
        const activeLens = lensRef.current;

        ctx.save();
        if (mirroredRef.current) {
          ctx.translate(CANVAS_W, 0);
          ctx.scale(-1, 1);
        }
        if (digitalScale !== 1) {
          ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
          ctx.scale(digitalScale, digitalScale);
          ctx.translate(-CANVAS_W / 2, -CANVAS_H / 2);
        }
        ctx.filter = cssFilter;

        if (currentMode === 'shadow' && m) {
          m.segmenter.segmentForVideo(video, ts, (r) => drawShadowFrame(ctx, video, r.categoryMask ?? null, CANVAS_W, CANVAS_H, offscreen));
          syncFace(false);
        } else {
          const needsFace = currentMode !== 'normal' || Boolean(preset.softSkin) || activeLens !== 'none';
          const found = m && needsFace ? m.detector.detectForVideo(video, ts).detections : [];
          if (found.length) { held = found; heldAge = 0; } else if (held.length && heldAge < HOLD_FRAMES) heldAge += 1; else held = [];
          const used = found.length ? found : held;

          if (currentMode === 'normal') {
            const snapCanvas = snapCameraKitAdapter.getOutputCanvas();
            if (snapCanvas && snapCanvas.width > 0 && snapCanvas.height > 0) {
              ctx.drawImage(snapCanvas, 0, 0, CANVAS_W, CANVAS_H);
            } else {
              drawNormalFrame(ctx, video, used, CANVAS_W, CANVAS_H, preset);
            }
            syncFace(used.length > 0);
          } else if (currentMode === 'blur') {
            const r = drawBlurFrame(ctx, video, used, CANVAS_W, CANVAS_H, pixelRef.current);
            syncFace(r.faceDetected);
          } else {
            const r = drawNoFaceGuardFrame(ctx, video, used, CANVAS_W, CANVAS_H);
            syncFace(r.faceDetected);
          }

          ctx.filter = 'none';
          if (activeLens !== 'none') {
            drawArLensOverlay(ctx, video, used, CANVAS_W, CANVAS_H, activeLens, now);
          }
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
        if (modeRef.current !== 'normal') blank();
        if (++errors >= MAX_FRAME_ERRORS) setModels('error');
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loopActive, videoRef]);

  const canRecord =
    camPhase === 'ready' &&
    (mode === 'normal' || models === 'ready') &&
    !(mode === 'noface' && faceLocked);

  const beginRecordingNow = useCallback(() => {
    if (mode === 'noface' && faceRef.current) return;
    startModeRef.current = modeRef.current;
    setCapturedMode(modeRef.current);
    haptic(18);
    if (flashOn && facing === 'user') triggerScreenFlash(durationLimit * 1000);
    void recorder.startMultiClipSegment();
  }, [mode, haptic, flashOn, facing, triggerScreenFlash, durationLimit, recorder]);

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
    startModeRef.current = modeRef.current;
    setCapturedMode(modeRef.current);
    haptic(15);
    if (flashOn && facing === 'user') triggerScreenFlash(360);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      setImportedMedia({ url, blob, mimeType: blob.type || 'image/png' });
    }, 'image/png');
  }, [canRecord, haptic, flashOn, facing, triggerScreenFlash]);

  const stopActiveSegment = useCallback(() => {
    setHandsFreeLocked(false);
    recorder.stopRecording();
  }, [recorder]);

  const onShutterPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (recorder.isRecording) {
      stopActiveSegment();
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
      setZoom(start.zoom + (dy - 10) / 80);
      setZoomHint((n) => n + 1);
    }
    if (dx > 55 && !handsFreeLocked) {
      haptic(20);
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
      if (recorder.segments.length === 0) {
        triggerWithTimer(captureSnapshot);
      } else {
        triggerWithTimer(() => {
          setHandsFreeLocked(true);
          beginRecordingNow();
        });
      }
      return;
    }
    if (wasHold && recorder.isRecording && !handsFreeLocked) {
      stopActiveSegment();
    }
  };

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
      setZoom(pinchStartZoomRef.current * (dist / pinchStartDistRef.current));
      setZoomHint((n) => n + 1);
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
    window.setTimeout(() => setFocusPoint(null), 2600);
  };

  const handleGalleryPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startModeRef.current = modeRef.current;
    setCapturedMode(modeRef.current);
    const url = URL.createObjectURL(file);
    setImportedMedia({ url, blob: file, mimeType: file.type || 'video/mp4' });
    e.target.value = '';
  };

  const getSnap = useCallback((): Omit<RecordedSnapPayload, 'url' | 'expiry'> | null => {
    const dbMode: PrivacyMode = startModeRef.current === 'normal' ? 'blur' : startModeRef.current;
    if (importedMedia) {
      return {
        blob: importedMedia.blob,
        mimeType: importedMedia.mimeType,
        mode: dbMode,
        durationSec: 5,
      };
    }
    const blob = recorder.recordedBlob;
    if (!blob) return null;
    return {
      blob,
      mimeType: recorder.mimeType || blob.type,
      mode: dbMode,
      durationSec: recorder.durationSec,
    };
  }, [recorder, importedMedia]);

  const submitMedia = onSubmitMedia
    ? async (payload: RecordedSnapPayload | MaskRecordingPayload) => {
        await onSubmitMedia(payload);
        if ('frames' in payload) URL.revokeObjectURL(payload.audioUrl);
        onClose?.();
      }
    : undefined;

  const selectMode = (next: CameraMode) => {
    haptic(10);
    setMode(next);
    if (next !== 'mask') {
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

  const retryModels = () => {
    setModels('loading');
    setModelsAttempt((n) => n + 1);
  };
  const mirrored = facing === 'user';

  const closeButton = (
    <button
      type="button"
      onClick={() => (onClose ? onClose() : router.push('/feed'))}
      aria-label={onClose ? 'Close camera' : 'Back to feed'}
      className={glassIconBtn}
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
      className={glassIconBtn}
    >
      <SwitchCamera aria-hidden className="size-4" />
    </button>
  );

  const studioItems: CarouselOrbItem[] = useMemo(() => {
    const filterOrbs: CarouselOrbItem[] = AESTHETIC_FILTERS.map((f) => ({
      id: `filter:${f.id}`,
      name: f.label,
      swatch: f.swatch,
      isUnexplored: f.id !== 'clean' && !exploredIds.has(`filter:${f.id}`),
    }));
    const arOrbs: CarouselOrbItem[] = AR_LENSES.filter((l) => l.id !== 'none').map((l) => ({
      id: `ar:${l.id}`,
      name: l.label,
      badge: l.badge,
      isUnexplored: !exploredIds.has(`ar:${l.id}`),
    }));
    return [...filterOrbs, ...arOrbs];
  }, [exploredIds]);

  const snapItems: CarouselOrbItem[] = useMemo(() => {
    const cleanOrb: CarouselOrbItem = { id: 'clean', name: 'Clean', badge: '✨', isSnap: false };
    const mysteryOrb: CarouselOrbItem = { id: '__mystery__', name: 'Mystery Lens', badge: '🎁', isMystery: true };
    const mapped: CarouselOrbItem[] = snapLenses.map((l) => ({
      id: l.id,
      name: l.name,
      iconUrl: l.iconUrl,
      badge: '👻',
      isSnap: true,
      isUnexplored: !exploredIds.has(l.id),
    }));
    if (mapped.length >= 2) {
      return [cleanOrb, mapped[0], mysteryOrb, ...mapped.slice(1)];
    }
    return [cleanOrb, ...mapped, mysteryOrb];
  }, [snapLenses, exploredIds]);

  const activeCarouselItems = lensCategory === 'snap' ? snapItems : studioItems;
  const activeCarouselId =
    lensCategory === 'snap'
      ? activeSnapLensId
      : lensId !== 'none'
        ? `ar:${lensId}`
        : `filter:${filterId}`;

  const handleSelectCarouselOrb = useCallback(
    (id: string) => {
      haptic(10);
      if (id === '__mystery__') {
        if (lensCategory === 'snap' && snapLenses.length > 0) {
          const picked = triggerMysteryUnlock(snapLenses);
          if (picked) {
            setActiveSnapLensId(picked.id);
            recordLensTry(picked.id);
          }
        } else {
          const studioPool = studioItems.filter((i) => i.id !== 'filter:clean');
          const picked = triggerMysteryUnlock(studioPool);
          if (picked) {
            if (picked.id.startsWith('ar:')) {
              setLensId(picked.id.replace('ar:', '') as ArLensId);
            } else {
              setLensId('none');
              setFilterId(picked.id.replace('filter:', '') as AestheticFilterId);
            }
            recordLensTry(picked.id);
          }
        }
        return;
      }

      if (lensCategory === 'snap') {
        setActiveSnapLensId(id);
        if (id !== 'clean') recordLensTry(id);
      } else if (id.startsWith('ar:')) {
        const nextAr = id.replace('ar:', '') as ArLensId;
        setLensId(nextAr);
        recordLensTry(id);
      } else if (id.startsWith('filter:')) {
        const nextFilter = id.replace('filter:', '') as AestheticFilterId;
        setLensId('none');
        setFilterId(nextFilter);
        if (nextFilter !== 'clean') recordLensTry(id);
      }
    },
    [haptic, lensCategory, snapLenses, studioItems, triggerMysteryUnlock, recordLensTry]
  );

  const stepCarousel = useCallback(
    (delta: 1 | -1) => {
      if (activeCarouselItems.length === 0) return;
      const curIdx = activeCarouselItems.findIndex((i) => i.id === activeCarouselId);
      const baseIdx = curIdx >= 0 ? curIdx : 0;
      const nextIdx = (baseIdx + delta + activeCarouselItems.length) % activeCarouselItems.length;
      handleSelectCarouselOrb(activeCarouselItems[nextIdx].id);
    },
    [activeCarouselItems, activeCarouselId, handleSelectCarouselOrb]
  );

  const progress = Math.min(1, recorder.totalRecordedSec / durationLimit);
  const ringR = 40;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = ringC * (1 - progress);

  const activeOrb = activeCarouselItems.find((i) => i.id === activeCarouselId);

  const shutterButtonNode = (
    <button
      type="button"
      onPointerDown={onShutterPointerDown}
      onPointerMove={onShutterPointerMove}
      onPointerUp={onShutterPointerUp}
      onPointerCancel={onShutterPointerUp}
      disabled={!recorder.isRecording && !canRecord}
      aria-label={recorder.isRecording ? 'Stop recording' : 'Tap for photo, hold for video'}
      className="relative flex size-[72px] touch-none items-center justify-center rounded-full border-[3.5px] border-white bg-white/10 shadow-[0_6px_24px_rgba(0,0,0,0.35)] transition-transform will-change-transform active:scale-95 disabled:opacity-40"
    >
      {(recorder.isRecording || recorder.segments.length > 0) && (
        <svg aria-hidden viewBox="0 0 88 88" className="pointer-events-none absolute -inset-[11px] size-[calc(100%+22px)] -rotate-90">
          <circle cx="44" cy="44" r={ringR} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="4" />
          <circle
            cx="44"
            cy="44"
            r={ringR}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={ringC}
            strokeDashoffset={ringOffset}
          />
        </svg>
      )}
      {recorder.isRecording ? (
        <span className="flex size-11 items-center justify-center rounded-xl bg-rose-500 shadow">
          <Square aria-hidden className="size-5 fill-white text-white" />
        </span>
      ) : activeOrb?.iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- lens thumbnail from the Camera Kit CDN
        <img src={activeOrb.iconUrl} alt="" className="size-[54px] rounded-full object-cover" />
      ) : activeOrb?.swatch ? (
        <span aria-hidden className="size-[54px] rounded-full" style={{ background: activeOrb.swatch }} />
      ) : activeOrb?.badge && activeOrb.id !== 'clean' ? (
        <span aria-hidden className="text-2xl">{activeOrb.badge}</span>
      ) : null}
    </button>
  );

  return (
    <CameraViewfinder
      swipeEnabled={mode !== 'mask' && !showPreview && !recorder.isRecording}
      onSwipeNext={() => stepCarousel(1)}
      onSwipePrev={() => stepCarousel(-1)}
      onTouchStartExtra={onViewfinderTouchStart}
      onTouchMoveExtra={onViewfinderTouchMove}
      onTouchEndExtra={onViewfinderTouchEnd}
      onClick={onViewfinderClick}
      className={`viewfinder relative h-[100dvh] w-full max-w-[430px] mx-auto overflow-hidden bg-[#0A0A0A] text-white ${className}`}
    >
      <CameraXpBar progress={(sessionXp % XP_PER_BAR) / XP_PER_BAR} />
      <LensExplorerToast toast={explorerToast} />
      {zoomHint > 0 && mode !== 'mask' && <ZoomBadge key={zoomHint} value={zoom} />}
      <AnimatePresence>
        {mode === 'normal' && lensCategory === 'studio' && lensId !== 'none' && camPhase === 'ready' && models === 'ready' && !faceLocked && !recorder.isRecording && <ArFramingGuide key="frame" />}
      </AnimatePresence>
      <MysteryBurstOverlay active={mysteryBurstActive} />
      {/* Multi-Clip Segmented Progress Bar Along Top Edge */}
      {mode !== 'mask' && (recorder.segments.length > 0 || recorder.isRecording) && (
        <div aria-hidden className="pointer-events-none absolute inset-x-3 top-[max(0.25rem,env(safe-area-inset-top))] z-30 flex h-1.5 gap-1 overflow-hidden rounded-full bg-white/25 p-0.5">
          {recorder.segments.map((seg) => (
            <div
              key={seg.id}
              style={{ width: `${Math.min(100, (seg.durationSec / durationLimit) * 100)}%` }}
              className="h-full rounded-full bg-cyan-300"
            />
          ))}
          {recorder.isRecording && (
            <div
              style={{ width: `${Math.min(100, ((recorder.totalRecordedSec - recorder.segments.reduce((s, c) => s + c.durationSec, 0)) / durationLimit) * 100)}%` }}
              className="h-full rounded-full bg-rose-400 animate-pulse"
            />
          )}
        </div>
      )}

      {/* Front Screen-Flash Warm Glow */}
      {screenFlashActive && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-30 border-[16px] border-amber-50/95 bg-amber-50/40" />
      )}


      <video ref={videoRef} playsInline muted autoPlay aria-hidden tabIndex={-1} className="pointer-events-none absolute left-0 top-0 size-px opacity-0" />
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        role="img"
        aria-label="Camera preview"
        className={`absolute inset-0 size-full object-cover ${mode === 'mask' ? 'invisible' : ''}`}
      />

      {/* 3x3 Grid Overlay */}
      {showGrid && mode !== 'mask' && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-[4] grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="border border-white/20" />
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
          <span className="size-14 rounded-full border-2 border-white/95 shadow-[0_0_16px_rgba(255,255,255,0.6)]" />
          <div className={`flex flex-col items-center gap-1 rounded-full px-1.5 py-2 ${GLASS}`}>
            <Sun aria-hidden className="size-3.5 text-amber-300" />
            <input
              type="range"
              min={-0.35}
              max={0.35}
              step={0.05}
              value={exposure}
              aria-label="Exposure"
              onChange={(e) => setExposure(Number(e.target.value))}
              className="h-20 w-1 accent-white [writing-mode:vertical-lr]"
            />
          </div>
        </div>
      )}

      {/* Top-Left Back Button + Top-Center Mode Pill */}
      <div className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20" onClick={(e) => e.stopPropagation()}>
        {closeButton}
      </div>

      <ModeSelector activeMode={mode} onSelectMode={selectMode} disabled={recorder.isRecording || maskRecording} />

      <CameraTopRail
        flipButton={flipButton}
        flashOn={flashOn}
        onToggleFlash={() => setFlashOn((f) => !f)}
        open={moreOpen}
        onOpenChange={setMoreOpen}
        timerDelay={timerDelay}
        onCycleTimer={() => setTimerDelay((t) => (t === 0 ? 3 : t === 3 ? 10 : 0))}
        speedRate={speedRate}
        onCycleSpeed={() => setSpeedRate((v) => (v === 1 ? 2 : v === 2 ? 0.5 : 1))}
        durationLimit={durationLimit}
        onCycleDuration={() => setDurationLimit((d) => (d === 15 ? 30 : d === 30 ? 60 : 15))}
        showGrid={mode === 'mask' ? null : showGrid}
        onToggleGrid={() => setShowGrid((g) => !g)}
      />

      {/* Big Animated Countdown Overlay */}
      {countdown !== null && (
        <div role="status" className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <span className="text-7xl font-black tabular-nums drop-shadow-lg">{countdown}</span>
        </div>
      )}

      {/* Light-Theme Frosted Recovery Card (Never a Dead Black Screen) */}
      {camPhase === 'requesting' && <Overlay mood="chill" busy title="Waking the camera…" />}
      {camPhase === 'ready' && mode !== 'mask' && mode !== 'normal' && models === 'loading' && <Overlay mood="surprised" busy title="Loading privacy shield…" />}
      {camPhase === 'ready' && mode !== 'mask' && mode !== 'normal' && models === 'error' && (
        <Overlay mood="sad" title="Privacy shield didn’t load" body="This mode stays locked until it does." action={<Action onClick={retryModels}><RotateCcw aria-hidden className="size-4" />Retry</Action>} />
      )}
      {(camPhase === 'denied' || camPhase === 'unsupported' || camPhase === 'error') && (
        <Overlay
          mood="sad"
          title={camPhase === 'denied' ? 'Camera blocked' : camPhase === 'unsupported' ? 'Camera needs HTTPS' : 'Camera is busy'}
          body={camPhase === 'denied' ? 'Allow camera access, or go faceless with your avatar.' : 'Pick a camera, or go faceless with your avatar.'}
          action={
            <div className="flex w-full flex-col items-center gap-2.5">
              <CameraDeviceToggle devices={devices} selectedId={selectedDeviceId ?? null} onSelect={(id) => void selectDevice(id)} />
              <div className="flex w-full gap-2">
                <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => void retryCamera()} aria-label="Retry camera"
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full border border-white/20 bg-white/10 text-xs font-bold">
                  <RotateCcw aria-hidden className="size-4" />Retry
                </motion.button>
                <motion.button type="button" whileTap={{ scale: 0.92 }} onClick={() => { setMode('mask'); void startAudioOnly(); }} aria-label="Use Audio + 3D Avatar mode"
                  className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-white text-xs font-bold text-slate-950">
                  <VenetianMask aria-hidden className="size-4" />Avatar
                </motion.button>
              </div>
            </div>
          }
        />
      )}

      {mode === 'mask' && camNotice && (
        <div className="absolute inset-x-0 top-24 z-10 flex flex-col items-center gap-2 px-4">
          <p role="alert" className={`rounded-full px-3 py-1 text-xs font-semibold ${GLASS}`}>{camNotice}</p>
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
        <MaskPlayer
          payload={maskPayload}
          onRetake={retakeMask}
          submit={submitMedia}
          submitLabel={submitLabel}
          onPublished={(postId) => {
            URL.revokeObjectURL(maskPayload.audioUrl);
            onPublished?.(postId);
          }}
        />
      )}

      {/* Bottom Creator Controls (Normal + 2D Privacy Modes) */}
      {mode !== 'mask' && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-1.5 bg-gradient-to-t from-black/55 via-black/15 to-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10"
        >
          {mode === 'noface' && faceLocked && camPhase === 'ready' && (
            <p role="status" className="flex items-center gap-2 rounded-full border border-rose-300 bg-rose-500/90 px-3 py-1.5 text-xs font-bold text-white shadow backdrop-blur-xl">
              <Lock aria-hidden className="size-3.5" /> Face in frame — recording locked
            </p>
          )}
          {(recorder.isRecording || recorder.segments.length > 0) && (
            <p role="timer" aria-label="Recording time" className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold tabular-nums ${GLASS}`}>
              <span aria-hidden className={`size-2 rounded-full ${recorder.isRecording ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'}`} />
              {formatTime(recorder.recordingSeconds)} / {formatTime(durationLimit)}
              {handsFreeLocked && <span className="ml-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px]">🔒 Locked</span>}
            </p>
          )}
          {(recorder.error || camNotice) && (
            <p role="alert" className={`rounded-full px-3 py-1 text-xs font-semibold ${GLASS}`}>
              {recorder.error ?? camNotice}
            </p>
          )}

          <input ref={galleryInputRef} type="file" accept="video/*,image/*" onChange={handleGalleryPick} className="hidden" />
          {recorder.segments.length > 0 && !recorder.isRecording && (
            <div className="flex w-full items-center justify-between px-6">
              <button type="button" onClick={recorder.undoLastSegment} aria-label="Undo last clip" className={glassIconBtn}>
                <RotateCcw aria-hidden className="size-4" />
              </button>
              <button type="button" onClick={recorder.finishMultiClip} aria-label="Finish and preview clip" className={`flex h-10 items-center gap-1.5 rounded-full px-4 text-xs font-bold ${GLASS}`}>
                <Check aria-hidden className="size-4" /> Done
              </button>
            </div>
          )}

          <LensCarousel items={activeCarouselItems} activeId={activeCarouselId} onSelect={handleSelectCarouselOrb} shutterButton={shutterButtonNode} />

          <CameraCategoryStrip
            category={lensCategory}
            onCategoryChange={setLensCategory}
            onGallery={() => galleryInputRef.current?.click()}
            snapCount={snapLenses.length}
            studioCount={studioItems.length}
          />
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
          isNormalFace={capturedMode === 'normal'}
          onSwitchToMask={() => setMode('mask')}
        />
      )}
    </CameraViewfinder>
  );
}

/** Status card: an animated clay character instead of a stock icon, one short line, and icon actions. */
function Overlay({ mood, busy = false, title, body, action }: { mood: EmotionTag; busy?: boolean; title: string; body?: string; action?: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div role="status" onClick={(e) => e.stopPropagation()} className="absolute inset-0 z-[15] flex items-center justify-center bg-black/45 px-6 backdrop-blur-md">
      <motion.div initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 26 }}
        className={`flex w-full max-w-xs flex-col items-center gap-3 rounded-[28px] p-5 text-center ${GLASS}`}>
        <motion.span animate={reduce ? undefined : { y: [0, -6, 0], rotate: busy ? [0, 8, -8, 0] : [0, -4, 4, 0] }} transition={{ duration: busy ? 1.4 : 2.6, repeat: Infinity, ease: 'easeInOut' }}>
          <ClayEmotionOrb emotion={mood} size={72} />
        </motion.span>
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {body && <p className="text-xs text-white/65">{body}</p>}
        {action}
      </motion.div>
    </div>
  );
}

function Action({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button type="button" onClick={onClick} whileTap={{ scale: 0.92 }} className="flex min-h-11 items-center gap-1.5 rounded-full bg-white px-5 text-xs font-bold text-slate-950 shadow">
      {children}
    </motion.button>
  );
}
