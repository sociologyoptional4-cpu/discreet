'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { EMOTION_META, type EmotionTag } from '@/lib/emotions';

const MOUTH: Record<EmotionTag, string> = {
  joy: 'M 34 62 Q 50 76 66 62',
  angry: 'M 36 70 Q 50 60 64 70',
  surprised: 'M 46 64 a 4.5 5.5 0 1 0 9 0 a 4.5 5.5 0 1 0 -9 0',
  sad: 'M 37 70 Q 50 63 63 70',
  chill: 'M 39 66 L 61 66',
};

/** A glossy clay sphere with a face: layered gradients and inner shadows, eyes that blink, a mouth per emotion. */
export function ClayEmotionOrb({ emotion, size = 140, className = '' }: { emotion: EmotionTag; size?: number; className?: string }) {
  const reduce = useReducedMotion();
  const { color, glow } = EMOTION_META[emotion];
  return (
    <span
      aria-hidden
      className={`relative block shrink-0 rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 30% 24%, #ffffffee 0 7%, transparent 22%), radial-gradient(circle at 38% 32%, ${glow}, ${color} 58%, ${color}dd 78%)`,
        boxShadow: `inset -${size * 0.09}px -${size * 0.11}px ${size * 0.2}px ${color}aa, inset ${size * 0.06}px ${size * 0.06}px ${size * 0.14}px #ffffffb0, 0 ${size * 0.12}px ${size * 0.26}px ${color}55`,
      }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 size-full">
        {emotion === 'angry' && <path d="M 30 36 L 44 42 M 70 36 L 56 42" stroke="#1f2333" strokeWidth="4" strokeLinecap="round" />}
        {emotion === 'sad' && <path d="M 31 40 L 43 36 M 69 40 L 57 36" stroke="#1f2333" strokeWidth="3.5" strokeLinecap="round" />}
        {[38, 62].map((cx) => (
          <motion.ellipse
            key={cx}
            cx={cx}
            cy={emotion === 'surprised' ? 46 : 49}
            rx={emotion === 'surprised' ? 5 : 4}
            ry={emotion === 'surprised' ? 6.5 : emotion === 'chill' ? 2 : 5.5}
            fill="#1f2333"
            style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            animate={reduce ? undefined : { scaleY: [1, 1, 0.1, 1, 1] }}
            transition={{ duration: 4.4, repeat: Infinity, times: [0, 0.9, 0.93, 0.96, 1], delay: cx === 62 ? 0.06 : 0 }}
          />
        ))}
        <path d={MOUTH[emotion]} fill={emotion === 'surprised' ? '#1f2333' : 'none'} stroke="#1f2333" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="27" cy="58" rx="6" ry="3.5" fill="#ffffff" opacity="0.28" />
        <ellipse cx="73" cy="58" rx="6" ry="3.5" fill="#ffffff" opacity="0.28" />
      </svg>
    </span>
  );
}
