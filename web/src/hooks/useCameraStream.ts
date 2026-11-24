'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { stopCameraStreams } from '@/lib/cameraCleanup';

export type CameraPhase = 'requesting' | 'ready' | 'audio-only' | 'denied' | 'unsupported' | 'error';
export type Facing = 'user' | 'environment';
export type ZoomRange = { min: number; max: number; step: number } | null;

export type CameraStream = {
  videoRef: RefObject<HTMLVideoElement | null>;
  audioStream: MediaStream | null;
  phase: CameraPhase;
  facing: Facing;
  notice: string | null;
  devices: MediaDeviceInfo[];
  selectedDeviceId: string | null;
  zoomRange: ZoomRange;
  hasTorch: boolean;
  flip: () => Promise<void>;
  retry: () => Promise<void>;
  selectDevice: (deviceId: string) => Promise<void>;
  startAudioOnly: () => Promise<void>;
  setHardwareZoom: (level: number) => Promise<boolean>;
  setTorch: (enabled: boolean) => Promise<boolean>;
};

const RESOLUTION_LADDER: Array<(facing: Facing, deviceId?: string | null) => MediaTrackConstraints> = [
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

const isPermissionError = (e: unknown): boolean =>
  e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError' || e.name === 'SecurityError');

export function useCameraStream({ audio: wantAudio = true, mode }: { audio?: boolean; mode?: string } = {}): CameraStream {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const facingRef = useRef<Facing>('user');
  const deviceIdRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<CameraPhase>('requesting');
  const [facing, setFacing] = useState<Facing>('user');
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [zoomRange, setZoomRange] = useState<ZoomRange>(null);
  const [hasTorch, setHasTorch] = useState(false);

  const stopAll = useCallback(() => {
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
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(list.filter((d) => d.kind === 'videoinput'));
    } catch {
      /* ignore enumeration errors */
    }
  }, []);

  const attach = useCallback(async (stream: MediaStream) => {
    const el = videoRef.current;
    if (!el) throw new Error('video element missing');
    el.srcObject = stream;
    await el.play();
  }, []);

  const acquireWithFallback = useCallback(
    async (targetFacing: Facing, deviceId: string | null): Promise<MediaStream> => {
      const audioConstraint = wantAudio ? { echoCancellation: true, noiseSuppression: true } : false;
      let lastErr: unknown;

      for (const buildVideo of RESOLUTION_LADDER) {
        try {
          return await navigator.mediaDevices.getUserMedia({
            video: buildVideo(targetFacing, deviceId),
            audio: audioConstraint,
          });
        } catch (err) {
          lastErr = err;
          if (isPermissionError(err)) throw err;
        }
      }

      // Final bare fallback
      try {
        return await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraint });
      } catch (err) {
        throw err ?? lastErr;
      }
    },
    [wantAudio],
  );

  const start = useCallback(
    async (targetFacing: Facing, deviceId: string | null = deviceIdRef.current) => {
      stopAll();
      const gen = generationRef.current;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setPhase('unsupported');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await acquireWithFallback(targetFacing, deviceId);
      } catch (e) {
        if (gen === generationRef.current) {
          void refreshDevices();
          setPhase(isPermissionError(e) ? 'denied' : 'error');
        }
        return;
      }

      if (gen !== generationRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      const videoTrack = stream.getVideoTracks()[0];
      const video = new MediaStream(videoTrack ? [videoTrack] : []);
      const audio = new MediaStream(stream.getAudioTracks());
      videoStreamRef.current = video;
      audioStreamRef.current = audio;

      try {
        await attach(video);
      } catch {
        if (gen === generationRef.current) {
          stopAll();
          setPhase('error');
        }
        return;
      }

      if (gen !== generationRef.current) return;

      // Read hardware capabilities (zoom & torch)
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
      setAudioStream(audio);
      setPhase('ready');
      void refreshDevices();
    },
    [acquireWithFallback, attach, refreshDevices, stopAll],
  );

  const flip = useCallback(async () => {
    const next: Facing = facingRef.current === 'user' ? 'environment' : 'user';
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
  }, [start]);

  const selectDevice = useCallback(
    async (deviceId: string) => {
      setNotice(null);
      setPhase('requesting');
      await start(facingRef.current, deviceId);
    },
    [start],
  );

  const retry = useCallback(() => {
    setPhase('requesting');
    setNotice(null);
    return start(facingRef.current, deviceIdRef.current);
  }, [start]);

  const startAudioOnly = useCallback(async () => {
    stopAll();
    const gen = generationRef.current;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase('unsupported');
      return;
    }
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (gen !== generationRef.current) {
        mic.getTracks().forEach((t) => t.stop());
        return;
      }
      audioStreamRef.current = mic;
      setAudioStream(mic);
      setNotice('Camera unavailable — running in Audio + 3D Avatar mode.');
      setPhase('audio-only');
    } catch (e) {
      if (gen === generationRef.current) {
        setPhase(isPermissionError(e) ? 'denied' : 'error');
      }
    }
  }, [stopAll]);

  const setHardwareZoom = useCallback(async (level: number): Promise<boolean> => {
    const track = videoStreamRef.current?.getVideoTracks()[0];
    if (!track || !zoomRange) return false;
    const clamped = Math.min(zoomRange.max, Math.max(zoomRange.min, level));
    try {
      await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }, [zoomRange]);

  const setTorch = useCallback(async (enabled: boolean): Promise<boolean> => {
    const track = videoStreamRef.current?.getVideoTracks()[0];
    if (!track || !hasTorch) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: enabled } as MediaTrackConstraintSet] });
      return true;
    } catch {
      return false;
    }
  }, [hasTorch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase('requesting');
      void start(facingRef.current, deviceIdRef.current);
    }, 0);
    return () => {
      clearTimeout(timer);
      stopAll();
    };
  }, [start, stopAll, mode]);

  return {
    videoRef,
    audioStream,
    phase,
    facing,
    notice,
    devices,
    selectedDeviceId,
    zoomRange,
    hasTorch,
    flip,
    retry,
    selectDevice,
    startAudioOnly,
    setHardwareZoom,
    setTorch,
  };
}
