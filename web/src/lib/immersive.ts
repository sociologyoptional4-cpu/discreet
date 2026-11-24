import { useSyncExternalStore } from 'react';

/**
 * "Immersive" means something is covering the screen (an expanded feed card, the camera) and the floating
 * navigation should get out of the way. Each owner turns its own flag on and off, so two owners never undo each other.
 */
const owners = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = false;

export function setImmersive(owner: string, on: boolean): void {
  if (on === owners.has(owner)) return;
  if (on) owners.add(owner);
  else owners.delete(owner);
  snapshot = owners.size > 0;
  listeners.forEach((l) => l());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useImmersive(): boolean {
  return useSyncExternalStore(subscribe, () => snapshot, () => false);
}
