export interface MicroSignalInput {
  watchMs: number;
  durationMs: number;
  activeLoops: number;       // Loops while user interacted or screen active
  entryVelocityPxMs: number; // Swipe speed entering this slide
  exitVelocityPxMs: number;  // Swipe speed leaving this slide
  openedComments: boolean;
  heldScreen: boolean;       // Finger paused/held on screen
  afkDetected: boolean;      // True if no touch/motion for > 2 full loops
}

/**
 * Converts silent micro-behaviors into a clean bounded reward [-0.6, 1.0].
 * Guards against AFK looping and noisy touch velocities.
 */
export function computeMicroSignalReward(input: MicroSignalInput): number {
  const safeDuration = Math.max(1000, input.durationMs);
  const watchRatio = Math.max(0, input.watchMs / safeDuration);

  // Fast skip: left in < 1.8s with low watch ratio
  if (input.watchMs < 1800 && watchRatio < 0.25) {
    return input.exitVelocityPxMs > 1.2 ? -0.6 : -0.45;
  }

  // AFK Guard: cap loop bonus if user left phone unattended
  const effectiveLoops = input.afkDetected ? 0 : Math.min(2, Math.max(0, input.activeLoops));
  const loopBonus = 0.2 * Math.log(1 + effectiveLoops);

  // Deceleration bonus: user was scrolling fast (>1.0 px/ms) but braked for this post
  const brakeBonus = input.entryVelocityPxMs > 1.0 && watchRatio > 0.5 ? 0.1 : 0;

  // Hesitation / deep interest bonus
  const dwellBonus = (input.openedComments ? 0.15 : 0) + (input.heldScreen ? 0.08 : 0);

  const raw = 0.5 * Math.min(1, watchRatio) + loopBonus + brakeBonus + dwellBonus;
  return Math.max(-0.6, Math.min(1.0, Number(raw.toFixed(4))));
}
