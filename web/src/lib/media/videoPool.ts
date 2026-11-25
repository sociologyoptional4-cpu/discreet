import { createContext } from 'react';

export const POOL_SIZE = 3;

/** A silent 16-bit mono WAV, so a pooled element has something it is allowed to play inside the very first tap. */
export function buildSilentWav(durationSec = 0.2, sampleRate = 8000): Uint8Array {
  const samples = Math.max(1, Math.round(durationSec * sampleRate));
  const bytes = new Uint8Array(44 + samples * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples * 2, true);
  return bytes;
}

let silentSource: string | null = null;
function silentWavUri(): string {
  if (silentSource === null) {
    let binary = '';
    for (const byte of buildSilentWav()) binary += String.fromCharCode(byte);
    silentSource = `data:audio/wav;base64,${btoa(binary)}`;
  }
  return silentSource;
}

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
    // Playing this silent source in a tap unlocks the element, so real clips can later start with sound without a tap.
    video.src = silentWavUri();
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

/**
 * Call inside a user gesture (on iOS that means touchend or click, not touchstart): briefly plays every idle pooled
 * element with sound allowed, so the browser marks each one as unlocked for the session. Elements that have not got
 * a clip yet hold a silent placeholder, so all of them can be unlocked by the very first tap.
 */
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
  video.volume = 1; // an interrupted unlock must never leave a clip at volume 0
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

/** The pooled element that is currently the playing, on-screen post. */
export function liveVideo(pool: readonly HTMLVideoElement[]): HTMLVideoElement | null {
  return pool.find((video) => video.dataset.live === '1') ?? null;
}

/** Seconds of video already buffered ahead of the playhead; Infinity once the whole file is buffered. */
export function bufferedAheadSeconds(video: HTMLVideoElement): number {
  const t = video.currentTime;
  for (let i = 0; i < video.buffered.length; i++) {
    const start = video.buffered.start(i);
    const end = video.buffered.end(i);
    if (start <= t + 0.1 && t <= end) return Number.isFinite(video.duration) && end >= video.duration - 0.1 ? Infinity : end - t;
  }
  return 0;
}

/** Whether this element is really producing sound right now. */
export function isAudible(video: HTMLVideoElement): boolean {
  return !video.paused && !video.muted && video.volume > 0 && video.readyState >= 2;
}

/** Inside a gesture: starts the live clip if the browser had refused to autoplay it. */
export function resumeLiveVideo(pool: readonly HTMLVideoElement[], withSound: boolean): void {
  const live = liveVideo(pool);
  if (!live || !live.paused) return;
  live.muted = !withSound;
  live.volume = 1;
  live.play().catch(() => {
    live.muted = true;
    live.play().catch(() => undefined);
  });
}

/** Inside a gesture: turns sound on for the live clip. `onBlocked` runs if the browser still refuses. */
export function unmuteLiveVideo(pool: readonly HTMLVideoElement[], onBlocked: () => void): void {
  const live = liveVideo(pool);
  if (!live) return;
  live.volume = 1;
  live.muted = false;
  if (!live.paused) return;
  live.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    live.muted = true;
    onBlocked();
    live.play().catch(() => undefined);
  });
}

const AUDIO_EVENTS = ['volumechange', 'playing', 'pause', 'waiting', 'emptied', 'loadeddata', 'canplay'] as const;

/** Calls `onChange` whenever any pooled element's playback or volume state changes. */
export function watchPool(pool: readonly HTMLVideoElement[], onChange: () => void): () => void {
  for (const video of pool) for (const type of AUDIO_EVENTS) video.addEventListener(type, onChange);
  return () => {
    for (const video of pool) for (const type of AUDIO_EVENTS) video.removeEventListener(type, onChange);
  };
}
