/** Tiny Web Audio synth with stereo panning. Silent until `primeAudio()` runs inside a user gesture. */

export type AudioCue = 'poke_knock' | 'heart_burst' | 'sticker_send' | 'swipe_tick';

let context: AudioContext | null = null;

/** Call from a pointer or key handler; browsers only allow audio after the user has interacted. */
export function primeAudio(): void {
  if (typeof window === 'undefined') return;
  const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  context ??= new Ctor();
  if (context.state === 'suspended') void context.resume().catch(() => {});
}

function tone(ctx: AudioContext, out: AudioNode, { freq, to, type, start, length, gain }: { freq: number; to: number; type: OscillatorType; start: number; length: number; gain: number }): void {
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(amp).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** `pan` runs from -1 (left) to 1 (right). Does nothing before the user has interacted. */
export function playCue(cue: AudioCue, pan = 0): void {
  if (!context || context.state !== 'running') return;
  const ctx = context;
  const panner = ctx.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  panner.connect(ctx.destination);
  const t = ctx.currentTime;
  if (cue === 'poke_knock') {
    tone(ctx, panner, { freq: 1900, to: 700, type: 'triangle', start: t, length: 0.09, gain: 0.22 });
    tone(ctx, panner, { freq: 1700, to: 600, type: 'triangle', start: t + 0.13, length: 0.09, gain: 0.18 });
  } else if (cue === 'heart_burst') {
    [523.25, 659.25, 783.99].forEach((f, i) => tone(ctx, panner, { freq: f, to: f * 1.01, type: 'sine', start: t + i * 0.07, length: 0.5, gain: 0.12 }));
  } else if (cue === 'swipe_tick') {
    tone(ctx, panner, { freq: 210, to: 95, type: 'sine', start: t, length: 0.045, gain: 0.08 });
  } else {
    tone(ctx, panner, { freq: 320, to: 980, type: 'sine', start: t, length: 0.12, gain: 0.16 });
  }
  setTimeout(() => panner.disconnect(), 900);
}
