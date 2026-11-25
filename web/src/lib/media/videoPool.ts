import { createContext } from 'react';

export const POOL_SIZE = 3;

export const VideoPoolContext = createContext<HTMLVideoElement[] | null>(null);

/** Three long-lived <video> elements. Mobile Safari only lets an element play with sound after a user gesture touched it, so the elements are reused for every post instead of being recreated. */
export function createVideoPool(): HTMLVideoElement[] {
  return Array.from({ length: POOL_SIZE }, () => {
    const video = document.createElement('video');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.loop = true;
    video.muted = true;
    video.preload = 'auto';
    video.className = 'relative size-full object-cover';
    return video;
  });
}

export function disposeVideoPool(pool: HTMLVideoElement[]): void {
  for (const video of pool) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
  }
}

const unlocked = new WeakSet<HTMLVideoElement>();

/** Call inside a user gesture: briefly plays every loaded, idle pooled element with sound allowed so the browser marks it gesture-unlocked for the session. */
export function unlockPool(pool: HTMLVideoElement[]): void {
  for (const video of pool) {
    if (unlocked.has(video) || video.dataset.live === '1' || !video.getAttribute('src') || !video.paused) continue;
    unlocked.add(video);
    // A fast swipe can make this element the active one before the prime settles; then it must be left alone.
    const restore = () => { video.volume = 1; if (video.dataset.live === '1') return; video.pause(); video.muted = true; };
    video.muted = false;
    video.volume = 0;
    video.play().then(restore, () => { unlocked.delete(video); restore(); });
  }
}

/** Moves a pooled element into `host` playing `src`; returns the detach function. */
export function attachVideo(video: HTMLVideoElement, host: HTMLElement, src: string, cors: boolean): () => void {
  if (cors) video.crossOrigin = 'anonymous';
  else video.removeAttribute('crossorigin');
  if (video.getAttribute('src') !== src) video.src = src;
  host.appendChild(video);
  return () => {
    video.pause();
    if (video.parentNode === host) host.removeChild(video);
  };
}

export function setVideoMuted(video: HTMLVideoElement, muted: boolean): void {
  video.muted = muted;
}

/** Plays with the wanted sound; only when the browser refuses autoplay (NotAllowedError) does it fall back to muted and report it. An interrupted play (src swapped by a fast swipe) is not a refusal. */
export function playVideo(video: HTMLVideoElement, withSound: boolean, onSoundBlocked: () => void): void {
  video.muted = !withSound;
  video.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    video.muted = true;
    if (withSound) onSoundBlocked();
    video.play().catch(() => {});
  });
}

/** Marks the element that is currently the on-screen, playing post so background priming never touches it. */
export function markLive(video: HTMLVideoElement, live: boolean): void {
  if (live) video.dataset.live = '1';
  else delete video.dataset.live;
}

/** Reports whenever the element actually plays muted, so the sound control can show the real state. */
export function watchSilence(video: HTMLVideoElement, onSilent: () => void): () => void {
  const check = () => { if (video.muted && !video.paused) onSilent(); };
  video.addEventListener('playing', check);
  video.addEventListener('volumechange', check);
  return () => {
    video.removeEventListener('playing', check);
    video.removeEventListener('volumechange', check);
  };
}
