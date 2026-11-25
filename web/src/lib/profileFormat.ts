const compactFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

export const compactCount = (n: number): string => compactFormat.format(n);

/** Vibe XP: every 100 XP is a level (matches `increment_user_vibe_xp`). */
export const XP_PER_LEVEL = 100;

export const levelProgress = (xp: number): number => (xp % XP_PER_LEVEL) / XP_PER_LEVEL;

/** "14h left", "3d left", "42m left", or null once expired. */
export function timeLeftLabel(expiresAt: string, now: number): string | null {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h left` : `${Math.floor(hours / 24)}d left`;
}

/** Pastel ring colour that shifts with the vibe level. */
export const ringColor = (level: number): string => `hsl(${(level * 47) % 360} 78% 72%)`;
