import rawCatalog from './avatarCatalog.json';
import type { AvatarId } from '@/types/avatar';

export type CatalogAvatar = {
  id: string;
  name: string;
  series: string;
  vrmUrl: string;
};

export const AVATAR_CATALOG: readonly CatalogAvatar[] = rawCatalog;

const DEFAULT_ID_MAP: Record<AvatarId, string> = {
  cyber_monk: 'nova',
  street_artist: 'kai',
  cozy_bear: 'coolbunny',
  neon_bot: 'eyewizard',
};

const STORAGE_KEY = 'vybe:chosen_vrm_url';
const GUEST_KEY = 'vybe:guest_vrm_url';

export function getDefaultVrmUrl(avatarId: AvatarId): string {
  const targetId = DEFAULT_ID_MAP[avatarId];
  const match = AVATAR_CATALOG.find((a) => a.id === targetId);
  return match?.vrmUrl ?? AVATAR_CATALOG[0]?.vrmUrl ?? '';
}

export function getChosenAvatarUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setChosenAvatarUrl(vrmUrl: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, vrmUrl);
  } catch {
    /* ignore storage quota errors */
  }
}

/** Returns a random avatar from the 29 R2 models for guests who have not signed in or chosen one. */
export function getGuestRandomAvatar(): CatalogAvatar | null {
  if (AVATAR_CATALOG.length === 0) return null;
  if (typeof window !== 'undefined') {
    try {
      const existing = window.sessionStorage.getItem(GUEST_KEY);
      const found = existing ? AVATAR_CATALOG.find((a) => a.vrmUrl === existing) : undefined;
      if (found) return found;
      const picked = AVATAR_CATALOG[Math.floor(Math.random() * AVATAR_CATALOG.length)];
      window.sessionStorage.setItem(GUEST_KEY, picked.vrmUrl);
      return picked;
    } catch {
      /* fallback below */
    }
  }
  return AVATAR_CATALOG[Math.floor(Math.random() * AVATAR_CATALOG.length)];
}
