'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { useRef, useState } from 'react';
import { AvatarStage } from '@/components/AvatarStage';
import { AVATAR_IDS, AVATAR_META } from '@/lib/avatars';
import type { AvatarId, MotionFrame } from '@/types/avatar';

const SPACING = 64; // % of the card width between styles, so neighbours peek in from the edges

/**
 * The creator's 3D clay avatar in a rounded card, with the other styles peeking left and right. Swiping previews a style.
 * Only the centre style is a live 3D canvas (one WebGL context); neighbours are lightweight clay discs.
 */
export function AvatarCarousel({ initial }: { initial: AvatarId }) {
  const reduce = useReducedMotion();
  const [index, setIndex] = useState(() => Math.max(0, AVATAR_IDS.indexOf(initial)));
  const idle = useRef<MotionFrame | null>(null); // no motion: the avatar breathes, blinks and follows the pointer on its own
  const go = (next: number) => setIndex((next + AVATAR_IDS.length) % AVATAR_IDS.length);
  const active = AVATAR_IDS[index];

  return (
    <motion.div
      className="relative h-64 w-full touch-pan-y overflow-hidden rounded-[28px] border border-white/80 bg-white/55 shadow-[0_12px_36px_rgba(15,23,42,.07)] backdrop-blur-xl"
      drag={reduce ? false : 'x'}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.3}
      onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 40) go(index + (info.offset.x < 0 ? 1 : -1)); }}
      onKeyDown={(e) => { if (e.key === 'ArrowRight') go(index + 1); if (e.key === 'ArrowLeft') go(index - 1); }}
      tabIndex={0}
      role="group"
      aria-roledescription="carousel"
      aria-label={`Avatar style: ${AVATAR_META[active].label}. Swipe or use the arrow keys to preview other styles.`}
    >
      {AVATAR_IDS.map((id, i) => {
        let offset = i - index;
        if (offset > AVATAR_IDS.length / 2) offset -= AVATAR_IDS.length;
        if (offset < -AVATAR_IDS.length / 2) offset += AVATAR_IDS.length;
        if (offset === 0) return null;
        const { accent, label } = AVATAR_META[id];
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Preview ${label}`}
            className="absolute left-1/2 top-1/2 grid size-24 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/80 text-sm font-bold text-slate-700"
            style={{ background: `radial-gradient(circle at 32% 26%, white, ${accent} 62%, ${accent}bb)`, boxShadow: `inset -8px -10px 16px ${accent}88, 0 10px 22px ${accent}44` }}
            animate={{ x: `${offset * SPACING * 2.6}%`, scale: 0.8, opacity: Math.abs(offset) > 1 ? 0 : 0.85 }}
            transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 280, damping: 26 }}
          >
            {label.split(' ').map((w) => w[0]).join('')}
          </motion.button>
        );
      })}
      <div className="absolute inset-y-0 left-1/2 w-[46%] -translate-x-1/2 overflow-hidden rounded-[24px]">
        <AvatarStage key={active} fill avatarId={active} currentFrameRef={idle} />
      </div>
      <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-slate-700">{AVATAR_META[active].label}</span>
    </motion.div>
  );
}
