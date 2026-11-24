'use client';
import { useMotionValue, useReducedMotion, type MotionValue } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';

type PermissionApi = { requestPermission?: () => Promise<'granted' | 'denied'> };
const SMOOTHING = 0.12;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

export type GyroParallax = {
  x: MotionValue<number>;
  y: MotionValue<number>;
  /** iOS 13+ asks first; show an "Enable 3D Tilt" pill and call `enable` from its tap. */
  needsPermission: boolean;
  enable: () => Promise<void>;
};

/**
 * Damped tilt in [-1, 1] from the gyroscope, or from the pointer on desktop. Values live in motion values, so
 * readers (a WebGL frame loop, a motion style) update without React renders. Reduced motion keeps both at 0.
 */
export function useGyroParallax(active = true): GyroParallax {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const reduce = useReducedMotion();
  const target = useRef({ x: 0, y: 0 });
  const [granted, setGranted] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    // Ask only on touch devices: desktop Safari exposes the API but has no gyroscope and uses the pointer instead.
    if (typeof api.requestPermission === 'function' && navigator.maxTouchPoints > 0) setNeedsPermission(true);
    else setGranted(true);
  }, []);

  const enable = useCallback(async () => {
    const api = DeviceOrientationEvent as unknown as PermissionApi;
    try {
      const result = await api.requestPermission?.();
      if (result === 'granted') { setGranted(true); setNeedsPermission(false); }
    } catch { /* denied or not a user gesture: pointer parallax still works */ }
  }, []);

  useEffect(() => {
    if (!active || reduce) { x.set(0); y.set(0); return; }
    const orientation = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      target.current = { x: clamp(e.gamma / 30), y: clamp((e.beta - 45) / 30) };
    };
    const pointer = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      target.current = { x: clamp((e.clientX / window.innerWidth) * 2 - 1), y: clamp((e.clientY / window.innerHeight) * 2 - 1) };
    };
    if (granted) window.addEventListener('deviceorientation', orientation);
    window.addEventListener('pointermove', pointer);
    let frame = requestAnimationFrame(function step() {
      x.set(x.get() + (target.current.x - x.get()) * SMOOTHING);
      y.set(y.get() + (target.current.y - y.get()) * SMOOTHING);
      frame = requestAnimationFrame(step);
    });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('deviceorientation', orientation);
      window.removeEventListener('pointermove', pointer);
    };
  }, [active, reduce, granted, x, y]);

  return { x, y, needsPermission: needsPermission && !granted, enable };
}
