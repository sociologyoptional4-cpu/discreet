'use client';

let lastHapticMs = 0;
const COOLDOWN_MS = 60;

export type HapticPattern = 'swipe_snap' | 'like_pop' | 'beat_pulse';

type ImpactStyle = 'LIGHT' | 'MEDIUM' | 'HEAVY';
type CapacitorHaptics = { impact: (options: { style: ImpactStyle }) => Promise<void> };

const PATTERNS: Record<HapticPattern, number | number[]> = {
  swipe_snap: 8,
  like_pop: [10, 20, 12],
  beat_pulse: 6,
};

const CAPACITOR_STYLE: Record<HapticPattern, ImpactStyle> = {
  swipe_snap: 'LIGHT',
  like_pop: 'MEDIUM',
  beat_pulse: 'LIGHT',
};

function getCapacitorHaptics(): CapacitorHaptics | null {
  if (typeof window === 'undefined') return null;
  const cap: unknown = Reflect.get(window, 'Capacitor');
  if (typeof cap !== 'object' || cap === null) return null;
  const plugins: unknown = Reflect.get(cap, 'Plugins');
  if (typeof plugins !== 'object' || plugins === null) return null;
  const haptics: unknown = Reflect.get(plugins, 'Haptics');
  if (typeof haptics !== 'object' || haptics === null) return null;
  return typeof Reflect.get(haptics, 'impact') === 'function' ? (haptics as CapacitorHaptics) : null;
}

/**
 * Triggers ultra-subtle haptic feedback with 60ms cooldown & `prefers-reduced-motion` guard.
 * Uses native Capacitor Haptics on iOS/Android builds and `navigator.vibrate` on Web.
 */
export function triggerMicroHaptic(pattern: HapticPattern): void {
  if (typeof window === 'undefined') return;
  const now = performance.now();
  if (now - lastHapticMs < COOLDOWN_MS) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  lastHapticMs = now;
  const native = getCapacitorHaptics();
  if (native) {
    void native.impact({ style: CAPACITOR_STYLE[pattern] }).catch(() => undefined);
    return;
  }
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(PATTERNS[pattern]);
    }
  } catch {
    // Ignore on unsupported browsers (e.g. iOS Safari web)
  }
}
