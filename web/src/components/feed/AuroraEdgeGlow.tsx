'use client';
import { motion, useReducedMotion } from 'framer-motion';
import type { PublicPost } from '@/types/social';

type Emotion = NonNullable<PublicPost['emotion_tag']>;
type Props = {
  emotion: Emotion | null | undefined;
  /** Change this value (a timestamp or counter) to make the glow bloom for 400 ms. */
  pulse: number;
};

/** Left/right glow colours per mood. Unknown or missing moods get the full cyan-violet-rose-mint aurora. */
const PALETTE: Record<Emotion | 'default', readonly [string, string]> = {
  joy: ['#5eead4', '#67e8f9'],
  angry: ['#fb7185', '#fbbf24'],
  surprised: ['#a78bfa', '#7dd3fc'],
  sad: ['#93c5fd', '#c4b5fd'],
  chill: ['#86efac', '#a5f3fc'],
  default: ['#67e8f9', '#f9a8d4'],
};

/** Soft breathing glow on the left and right screen edges. Purely decorative: never takes a tap. */
export function AuroraEdgeGlow({ emotion, pulse }: Props) {
  const reduce = useReducedMotion();
  const [left, right] = PALETTE[emotion ?? 'default'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-10 overflow-hidden mix-blend-screen">
      {([['left', left, '#c4b5fd'], ['right', right, '#86efac']] as const).map(([side, main, accent], i) => {
        const glow = { background: `radial-gradient(60% 45% at 50% 30%, ${main}, transparent 70%), radial-gradient(55% 40% at 50% 75%, ${accent}, transparent 70%)` };
        const place = `absolute top-[8%] h-[84%] w-1/3 rounded-full blur-2xl transition-[background] duration-700 ${side === 'left' ? '-left-[20%]' : '-right-[20%]'}`;
        return (
          <div key={side}>
            <motion.div className={place} style={glow}
              animate={reduce ? { opacity: 0.35 } : { opacity: [0.3, 0.55, 0.3], scale: [1, 1.06, 1] }}
              transition={reduce ? { duration: 0 } : { duration: 6, repeat: Infinity, ease: 'easeInOut', delay: i * 1.5 }} />
            {pulse > 0 && !reduce && (
              <motion.div key={pulse} className={place} style={glow} initial={{ opacity: 0.75, scale: 1.2 }} animate={{ opacity: 0, scale: 1 }} transition={{ duration: 0.4, ease: 'easeOut' }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
