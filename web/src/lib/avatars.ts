import type { AvatarId } from '@/types/avatar';

export const AVATAR_IDS: readonly AvatarId[] = ['cyber_monk', 'street_artist', 'cozy_bear', 'neon_bot'];

/** Display name and accent colour for each bundled character. */
export const AVATAR_META: Record<AvatarId, { label: string; accent: string }> = {
  cyber_monk: { label: 'Cyber Monk', accent: '#22d3ee' },
  street_artist: { label: 'Street Artist', accent: '#ff3df0' },
  cozy_bear: { label: 'Cozy Bear', accent: '#fbbf24' },
  neon_bot: { label: 'Neon Bot', accent: '#39ff88' },
};

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === 'string' && (AVATAR_IDS as readonly string[]).includes(value);
}

/** Muted studio backdrops behind each character: slate-teal, terracotta, sand and dusty plum. */
export const STUDIO_BACKDROP: Record<AvatarId, string> = {
  cyber_monk: 'radial-gradient(120% 90% at 50% 32%, #e6e1ff 0%, #cfc8ee 48%, #aca9c7 100%)',
  street_artist: 'radial-gradient(120% 90% at 50% 32%, #ffe1d2 0%, #f2c1a9 48%, #d9a58f 100%)',
  cozy_bear: 'radial-gradient(120% 90% at 50% 32%, #fff0c9 0%, #e8d1a9 48%, #c7ad85 100%)',
  neon_bot: 'radial-gradient(120% 90% at 50% 32%, #d9f5fb 0%, #b9e2e8 48%, #98c7d2 100%)',
};
