'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { stopCameraStreams } from '@/lib/cameraCleanup';

export type CameraEnginePhase = 'requesting' | 'ready' | 'audio-only' | 'denied' | 'unsupported' | 'error';
export type CameraFacing = 'user' | 'environment';
export type HardwareZoomRange = { min: number; max: number; step: number } | null;

export type CameraEngine = {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioStream: MediaStream | null;
  phase: CameraEnginePhase;
  facing: CameraFacing;
  notice: string | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  zoom: number;
  zoomRange: HardwareZoomRange;
  hasTorch: boolean;
  flashOn: boolean;
  screenFlashActive: boolean;
  setZoom: (next: number) => void;
  setFlashOn: (on: boolean | ((prev: boolean) => boolean)) => void;
  triggerScreenFlash: (durationMs?: number) => void;
  flip: () => Promise<void>;
  retry: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
  startAudioOnly: () => Promise<void>;
  haptic: (ms?: number) => void;
};

const RESOLUTION_FALLBACKS: Array<(facing: CameraFacing, deviceId?: string | null) => MediaTrackConstraints> = [
  (facing, deviceId) => ({
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
  }),
  (facing, deviceId) => ({
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  }),
  (facing, deviceId) => ({
    ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
    width: { ideal: 640 },
    height: { ideal: 480 },
  }),
];

const isPermissionDenied = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function useCameraEngine({ audio: wantAudio = true }: { audio?: boolean } = {}): CameraEngine {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mutexRef = useRef<Promise<void>>(Promise.resolve());
  const generationRef = useRef(0);
  const facingRef = useRef<CameraFacing>('user');
  const deviceIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<CameraEnginePhase>('requesting');
  const [facing, setFacing] = useState<CameraFacing>('user');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [zoom, setZoomState] = useState(1);
  const [zoomRange, setZoomRange] = useState<HardwareZoomRange>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [screenFlashActive, setScreenFlashActive] = useState(false);

  const haptic = useCallback((ms = 12) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(ms);
      } catch {
        /* ignore on unsupported devices */
      }
    }
  }, []);

  const stopAllTracks = useCallback(() => {
    generationRef.current += 1;
    stopCameraStreams(videoStreamRef.current, audioStreamRef.current);
    videoStreamRef.current = null;
    audioStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setZoomRange(null);
    setHasTorch(false);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'videoinput'));
    } catch {
      /* ignore */
    }
  }, []);

  const acquireStream = useCallback(
    async (targetFacing: CameraFacing, deviceId: string | null): Promise<MediaStream> => {
      const audioConstraint = wantAudio ? { echoCancellation: true, noiseSuppression: true } : false;
      let lastErr: unknown;
      for (const build of RESOLUTION_FALLBACKS) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: build(targetFacing, deviceId),
            audio: audioConstraint,
          });
        } catch (err) {
          lastErr = err;
          if (isPermissionDenied(err)) throw err;
        }
      }
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraint });
      } catch (err) {
        throw err ?? lastErr;
      }
    },
    [wantAudio],
  );

  const start = useCallback(
    async (targetFacing: CameraFacing, deviceId: string | null = deviceIdRef.current) => {
      stopAllTracks();
      const gen = generationRef.current;

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPhase('unsupported');
        return;
      }

      const run = async () => {
        // Wait 100ms after stopping previous tracks so mobile OS releases the hardware lock
        await sleep(100);
        if (gen !== generationRef.current) return;

        let stream: MediaStream;
        try {
          stream = await acquireStream(targetFacing, deviceId);
        } catch (e) {
          if (gen === generationRef.current) {
            void refreshDevices();
            setPhase(isPermissionDenied(e) ? 'denied' : 'error');
          }
          return;
        }

        if (gen !== generationRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const videoTrack = stream.getVideoTracks()[0];
        const vStream = new MediaStream(videoTrack ? [videoTrack] : []);
        const aStream = new MediaStream(stream.getAudioTracks());
        videoStreamRef.current = vStream;
        audioStreamRef.current = aStream;

        const el = videoRef.current;
        if (!el) {
          stopAllTracks();
          return;
        }
        el.srcObject = vStream;
        try {
          await el.play();
        } catch {
          if (gen === generationRef.current) {
            stopAllTracks();
            setPhase('error');
          }
          return;
        }

        if (gen !== generationRef.current) return;

        if (videoTrack && typeof videoTrack.getCapabilities === 'function') {
          const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & {
            zoom?: { min?: number; max?: number; step?: number };
            torch?: boolean;
          };
          if (caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number' && caps.zoom.max > caps.zoom.min) {
            setZoomRange({ min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step ?? 0.1 });
          } else {
            setZoomRange(null);
          }
          setHasTorch(Boolean(caps.torch));
        }

        facingRef.current = targetFacing;
        deviceIdRef.current = deviceId;
        setFacing(targetFacing);
        setSelectedDeviceId(deviceId);
        setZoomState(1);
        setAudioStream(aStream);
        setPhase('ready');
        void refreshDevices();
      };

      mutexRef.current = mutexRef.current.then(run, run);
      await mutexRef.current;
    },
    [acquireStream, refreshDevices, stopAllTracks],
  );

  const setZoom = useCallback(
    (next: number) => {
      const clamped = Math.round(Math.min(4, Math.max(0.5, next)) * 100) / 100;
      setZoomState(clamped);
      const track = videoStreamRef.current?.getVideoTracks()[0];
      if (track && zoomRange && clamped >= zoomRange.min) {
        const hw = Math.min(zoomRange.max, Math.max(zoomRange.min, clamped));
        void track.applyConstraints({ advanced: [{ zoom: hw } as MediaTrackConstraintSet] }).catch(() => {});
      }
    },
    [zoomRange],
  );

  useEffect(() => {
    const track = videoStreamRef.current?.getVideoTracks()[0];
    if (!track || !hasTorch || facing !== 'environment') return;
    void track.applyConstraints({ advanced: [{ torch: flashOn } as MediaTrackConstraintSet] }).catch(() => {});
  }, [flashOn, hasTorch, facing]);

  const triggerScreenFlash = useCallback((durationMs = 380) => {
    setScreenFlashActive(true);
    window.setTimeout(() => setScreenFlashActive(false), durationMs);
  }, []);

  const flip = useCallback(async () => {
    haptic(15);
    const next: CameraFacing = facingRef.current === 'user' ? 'environment' : 'user';
    const prev = facingRef.current;
    deviceIdRef.current = null;
    setSelectedDeviceId(null);
    setNotice(null);
    setPhase('requesting');
    await start(next, null);
    if (facingRef.current !== next && videoRef.current) {
      setNotice('Could not switch cameras on this device.');
      await start(prev, null);
    }
  }, [haptic, start]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      haptic(12);
      setNotice(null);
      setPhase('requesting');
      await start(facingRef.current, deviceId);
    },
    [haptic, start],
  );

  const retry = useCallback(() => {
    setPhase('requesting');
    setNotice(null);
    return start(facingRef.current, deviceIdRef.current);
  }, [start]);

  const startAudioOnly = useCallback(async () => {
    haptic(15);
    stopAllTracks();
    const gen = generationRef.current;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase('unsupported');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      if (gen !== generationRef.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      audioStreamRef.current = mic;
      setAudioStream(mic);
      setNotice('Running in Audio + 3D Avatar mode');
      setPhase('audio-only');
    } catch (e) {
      if (gen === generationRef.current) {
        setPhase(isPermissionDenied(e) ? 'denied' : 'error');
      }
    }
  }, [haptic, stopAllTracks]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('requesting');
      void start(facingRef.current, deviceIdRef.current);
    }, 0);
    return () => {
      clearTimeout(timer);
      stopAllTracks();
    };
  }, [start, stopAllTracks]);

  return {
    videoRef,
    audioStream,
    phase,
    facing,
    notice,
    devices,
    selectedDeviceId,
    zoom,
    zoomRange,
    hasTorch,
    flashOn,
    screenFlashActive,
    setZoom,
    setFlashOn,
    triggerScreenFlash,
    flip,
    retry,
    selectDevice,
    startAudioOnly,
    haptic,
  };
}
