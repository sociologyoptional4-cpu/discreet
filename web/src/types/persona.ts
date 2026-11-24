/** How one creator moves, measured from their calibration clips. About 1 KB as JSON; stored in `users.persona_style`. */
export type PersonaStyle = {
  /** How fast their hands move compared with an average speaker. 0.5 (slow) to 2.0 (fast). */
  handSpeedMultiplier: number;
  /** How strongly they use their face (jaw, brows, smile). 0.8 (reserved) to 1.6 (very expressive). */
  expressionGain: number;
  /** Resting head rotation in radians: [pitch, yaw, roll]. */
  restingHeadTilt: [number, number, number];
  dominantHand: 'left' | 'right' | 'both';
  /** ISO 8601 time of the calibration. */
  calibratedAt: string;
};

/** What the in-browser check found out about a `.glb` before it is allowed to upload. */
export type RigValidationResult = {
  valid: boolean;
  fileSizeMB: number;
  hasHeadBone: boolean;
  hasHandBones: boolean;
  blendshapeCount: number;
  /** Things that work but could look better. They never block the upload. */
  warnings: string[];
  /** Things that make the avatar unusable. Any error means `valid` is false. */
  errors: string[];
};

/** Limits shared by the analyzer, the API and (as the same numbers) the database check in phase3_persona.sql. */
export const PERSONA_LIMITS = {
  handSpeedMultiplier: { min: 0.5, max: 2.0 },
  expressionGain: { min: 0.8, max: 1.6 },
  restingHeadTilt: { min: -1.0, max: 1.0 },
} as const;

/** Largest custom avatar file, in bytes. */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const isNumberIn = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** Checks data that came from storage or another user. Returns the style, or null if anything is off. */
export function parsePersonaStyle(raw: unknown): PersonaStyle | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const v = raw as Record<string, unknown>;
  const { handSpeedMultiplier: hand, expressionGain: face, restingHeadTilt: tilt } = PERSONA_LIMITS;
  if (!isNumberIn(v.handSpeedMultiplier, hand.min, hand.max)) return null;
  if (!isNumberIn(v.expressionGain, face.min, face.max)) return null;
  if (!Array.isArray(v.restingHeadTilt) || v.restingHeadTilt.length !== 3) return null;
  const [pitch, yaw, roll] = v.restingHeadTilt as unknown[];
  if (![pitch, yaw, roll].every((n) => isNumberIn(n, tilt.min, tilt.max))) return null;
  if (v.dominantHand !== 'left' && v.dominantHand !== 'right' && v.dominantHand !== 'both') return null;
  if (typeof v.calibratedAt !== 'string' || v.calibratedAt.length > 40) return null;
  return {
    handSpeedMultiplier: v.handSpeedMultiplier,
    expressionGain: v.expressionGain,
    restingHeadTilt: [pitch as number, yaw as number, roll as number],
    dominantHand: v.dominantHand,
    calibratedAt: v.calibratedAt,
  };
}
