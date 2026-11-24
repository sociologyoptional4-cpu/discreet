/** Ultra-light haptics. Native Capacitor Haptics when the app runs inside Capacitor, else the Vibration API. */

type ImpactStyle = 'LIGHT' | 'MEDIUM' | 'HEAVY';
type CapacitorHaptics = { impact: (options: { style: ImpactStyle }) => Promise<void> };

const MIN_GAP_MS = 90;
let lastTick = 0;

function capacitorHaptics(): CapacitorHaptics | null {
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
 * One crisp tick. Calls closer together than 90 ms are dropped, so a fast flick through ten videos taps
 * once per settled video instead of buzzing continuously. Returns whether a tick was sent.
 */
export function hapticTick(now: number = Date.now()): boolean {
  if (now - lastTick < MIN_GAP_MS) return false;
  lastTick = now;
  const native = capacitorHaptics();
  if (native) {
    void native.impact({ style: 'LIGHT' }).catch(() => undefined);
    return true;
  }
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(10);
  return true;
}
