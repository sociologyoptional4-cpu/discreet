export type PlayableScenePreset = 'midnight_rooftop' | 'neon_rain' | 'pastel_clouds' | 'cozy_campfire';
export type AvatarAnimation = 'idle' | 'wave' | 'dance' | 'sit';
export type PlayableFontStyle = 'serif' | 'sans' | 'mono';
export type Vec3 = [number, number, number];

export interface PlayableLighting {
  ambientColor: string;
  accentColor: string;
  intensity: number;
  fogDensity: number;
}

export interface PlayableCamera {
  fov: number;
  initialPos: Vec3;
  autoOrbitSpeed: number;
}

export interface PlayableAvatarConfig {
  modelId: string;
  position: Vec3;
  animation: AvatarAnimation;
  primaryColor: string;
}

export interface PlayableTextOverlay {
  lines: string[];
  fontStyle: PlayableFontStyle;
  color: string;
  glow: boolean;
}

export interface PlayableSceneRecipe {
  version: 1;
  scenePreset: PlayableScenePreset;
  lighting: PlayableLighting;
  camera: PlayableCamera;
  avatar?: PlayableAvatarConfig;
  textOverlay?: PlayableTextOverlay;
  audioUrl: string | null;
  remixedFromPostId: string | null;
}

export const PLAYABLE_PRESETS: readonly PlayableScenePreset[] = ['midnight_rooftop', 'neon_rain', 'pastel_clouds', 'cozy_campfire'];
const ANIMATIONS: readonly AvatarAnimation[] = ['idle', 'wave', 'dance', 'sit'];
const FONTS: readonly PlayableFontStyle[] = ['serif', 'sans', 'mono'];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LINES = 6;
const MAX_LINE_CHARS = 120;
const COORD_LIMIT = 12;

const record = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | null => (allowed as readonly unknown[]).includes(value) ? (value as T) : null;
const color = (value: unknown, fallback: string): string => (typeof value === 'string' && HEX.test(value) ? value : fallback);
const clamped = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
const vec3 = (value: unknown, fallback: Vec3): Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
    ? (value.map((n: number) => Math.min(Math.max(n, -COORD_LIMIT), COORD_LIMIT)) as Vec3)
    : fallback;

/** Recipe audio is fetched by every viewer, so it may only come from this app's own R2 bucket. */
export function isTrustedAudioUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const base = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
    return url.hostname.endsWith('.r2.dev') || (!!base && url.hostname === new URL(base).hostname);
  } catch {
    return false;
  }
}

/**
 * Turns stored JSON into a safe recipe, or null when it is not a playable scene at all (for example the older
 * `recipe_avatar` mocap recipes, which have no `scenePreset`). Every field is clamped or replaced by a default.
 */
export function parsePlayableRecipe(raw: unknown): PlayableSceneRecipe | null {
  const r = record(raw);
  const scenePreset = oneOf(PLAYABLE_PRESETS, r.scenePreset);
  if (!scenePreset) return null;

  const light = record(r.lighting);
  const cam = record(r.camera);
  const avatarRaw = record(r.avatar);
  const textRaw = record(r.textOverlay);

  const lines = Array.isArray(textRaw.lines)
    ? textRaw.lines.filter((l): l is string => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim().slice(0, MAX_LINE_CHARS)).slice(0, MAX_LINES)
    : [];

  return {
    version: 1,
    scenePreset,
    lighting: {
      ambientColor: color(light.ambientColor, '#1e1b4b'),
      accentColor: color(light.accentColor, '#a855f7'),
      intensity: clamped(light.intensity, 0.2, 3, 1.2),
      fogDensity: clamped(light.fogDensity, 0, 0.15, 0.04),
    },
    camera: {
      fov: clamped(cam.fov, 30, 75, 50),
      initialPos: vec3(cam.initialPos, [0, 1.8, 5.5]),
      autoOrbitSpeed: clamped(cam.autoOrbitSpeed, -2, 2, 0.35),
    },
    avatar: r.avatar && typeof r.avatar === 'object'
      ? {
          modelId: typeof avatarRaw.modelId === 'string' ? avatarRaw.modelId.slice(0, 40) : 'default_capsule',
          position: vec3(avatarRaw.position, [0, 0, 0]),
          animation: oneOf(ANIMATIONS, avatarRaw.animation) ?? 'idle',
          primaryColor: color(avatarRaw.primaryColor, '#f472b6'),
        }
      : undefined,
    textOverlay: lines.length > 0
      ? { lines, fontStyle: oneOf(FONTS, textRaw.fontStyle) ?? 'serif', color: color(textRaw.color, '#ffffff'), glow: Boolean(textRaw.glow) }
      : undefined,
    audioUrl: typeof r.audioUrl === 'string' && isTrustedAudioUrl(r.audioUrl) ? r.audioUrl : null,
    remixedFromPostId: typeof r.remixedFromPostId === 'string' && UUID.test(r.remixedFromPostId) ? r.remixedFromPostId : null,
  };
}
