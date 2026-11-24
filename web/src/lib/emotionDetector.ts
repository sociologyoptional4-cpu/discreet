import { EMOTION_META, EMOTION_TAGS, type EmotionTag } from './emotions.ts';

export type LiveEmotion = { emotion: EmotionTag; label: string; color: string; confidence: number };

const SMOOTHING = 0.2; // share of the new frame in each update: about a third of a second to settle at 30 FPS
const SWITCH_MARGIN = 0.06; // a new emotion must beat the current one by this much, so the label does not flicker
const CHILL_BASELINE = 0.22; // a resting face reads as chill until another emotion is clearly stronger

const avg = (s: Record<string, number>, a: string, b: string): number => ((s[a] ?? 0) + (s[b] ?? 0)) / 2;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Raw evidence for each emotion from ARKit blendshape weights (0..1). */
export function scoreEmotions(s: Record<string, number>): Record<EmotionTag, number> {
  const smile = avg(s, 'mouthSmileLeft', 'mouthSmileRight');
  const frown = avg(s, 'mouthFrownLeft', 'mouthFrownRight');
  const browDown = avg(s, 'browDownLeft', 'browDownRight');
  const squint = avg(s, 'eyeSquintLeft', 'eyeSquintRight');
  const wide = avg(s, 'eyeWideLeft', 'eyeWideRight');
  const sneer = avg(s, 'noseSneerLeft', 'noseSneerRight');
  const browUp = s.browInnerUp ?? 0;
  const jaw = s.jawOpen ?? 0;
  return {
    joy: clamp01(smile * 1.4 - frown * 0.5),
    angry: clamp01(browDown * 0.9 + frown * 0.6 + sneer * 0.5 - smile * 0.4),
    surprised: clamp01(browUp * 0.8 + jaw * 0.6 + wide * 0.5 - smile * 0.3),
    sad: clamp01(frown * 0.8 + squint * 0.4 + browUp * 0.3 - smile * 0.6 - jaw * 0.2),
    chill: CHILL_BASELINE,
  };
}

/** Holds the smoothed scores between frames. One per camera; create a fresh one for each recording session. */
export class EmotionSmoother {
  private scores: Record<EmotionTag, number> = { joy: 0, angry: 0, surprised: 0, sad: 0, chill: CHILL_BASELINE };
  private current: EmotionTag = 'chill';

  update(blendshapes: Record<string, number>): LiveEmotion {
    const raw = scoreEmotions(blendshapes);
    for (const tag of EMOTION_TAGS) this.scores[tag] += (raw[tag] - this.scores[tag]) * SMOOTHING;
    let best = this.current;
    for (const tag of EMOTION_TAGS) if (this.scores[tag] > this.scores[best]) best = tag;
    if (best !== this.current && this.scores[best] > this.scores[this.current] + SWITCH_MARGIN) this.current = best;
    const total = EMOTION_TAGS.reduce((sum, tag) => sum + this.scores[tag], 0) || 1;
    const meta = EMOTION_META[this.current];
    return { emotion: this.current, label: meta.label, color: meta.color, confidence: Math.round((this.scores[this.current] / total) * 100) / 100 };
  }

  reset(): void {
    this.scores = { joy: 0, angry: 0, surprised: 0, sad: 0, chill: CHILL_BASELINE };
    this.current = 'chill';
  }
}

const shared = new EmotionSmoother();

/** The viewer's current emotion, smoothed over recent frames. Pass your own smoother to keep cameras independent. */
export function detectLiveEmotion(blendshapes: Record<string, number>, smoother: EmotionSmoother = shared): LiveEmotion {
  return smoother.update(blendshapes);
}
