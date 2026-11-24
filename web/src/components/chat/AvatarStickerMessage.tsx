'use client';
import { motion, useReducedMotion, type TargetAndTransition } from 'framer-motion';
import { useState } from 'react';
import { ClayEmotionOrb } from '@/components/ClayEmotionOrb';
import { Emoji3D } from '@/components/chat/EmojiReactionSystem';
import { AVATAR_META } from '@/lib/avatars';
import { STICKERS, parseSticker, stickerUrl, type StickerId } from '@/lib/chat/stickerRegistry';
import type { AvatarId } from '@/types/avatar';

const BASE = process.env.NEXT_PUBLIC_R2_PUBLIC_URL;
/** Clip URLs that 404'd: skip straight to the clay fallback next time. */
const missing = new Set<string>();

const LOOPS: Record<(typeof STICKERS)[StickerId]['motion'], TargetAndTransition> = {
  peek: { y: [18, 0, 0, 18], transition: { duration: 2.4, repeat: Infinity, times: [0, 0.25, 0.75, 1] } },
  wave: { rotate: [0, -8, 8, -8, 0], transition: { duration: 1.4, repeat: Infinity } },
  bounce: { y: [0, -14, 0], scale: [1, 1.06, 1], transition: { duration: 0.9, repeat: Infinity } },
  shake: { x: [0, -4, 4, -4, 4, 0], transition: { duration: 0.6, repeat: Infinity, repeatDelay: 0.5 } },
  sway: { rotate: [-5, 5, -5], y: [0, 3, 0], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } },
  run: { x: [-10, 10, -10], rotate: [-4, 4, -4], transition: { duration: 0.5, repeat: Infinity } },
  knock: { x: [0, 8, 0, 8, 0], transition: { duration: 0.7, repeat: Infinity, repeatDelay: 0.6 } },
};

/** Built-in claymorphic character: a clay face in the avatar's colour holding the sticker's prop. Works with no assets. */
export function ClayBuddy({ avatarId, stickerId, size = 96 }: { avatarId: AvatarId; stickerId: StickerId; size?: number }) {
  const reduce = useReducedMotion();
  const sticker = STICKERS[stickerId];
  const accent = AVATAR_META[avatarId].accent;
  return (
    <motion.div aria-hidden className="relative" style={{ width: size, height: size }} animate={reduce ? undefined : LOOPS[sticker.motion]}>
      <span className="absolute inset-x-[12%] bottom-0 h-[30%] rounded-t-[40%] shadow-[inset_0_-6px_10px_rgba(0,0,0,.12),inset_0_4px_8px_rgba(255,255,255,.6)]" style={{ background: accent }} />
      <ClayEmotionOrb emotion={sticker.mood} size={size * 0.78} className="absolute left-1/2 top-0 -translate-x-1/2" />
      <span className="absolute -right-1 bottom-[12%]"><Emoji3D emoji={sticker.prop} size={size * 0.36} /></span>
    </motion.div>
  );
}

/** A rendered clip when one exists, otherwise the clay fallback. */
export function StickerArt({ avatarId, stickerId, size = 96 }: { avatarId: AvatarId; stickerId: StickerId; size?: number }) {
  const url = stickerUrl(avatarId, stickerId, BASE);
  const [failed, setFailed] = useState(() => missing.has(url));
  if (failed) return <ClayBuddy avatarId={avatarId} stickerId={stickerId} size={size} />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- animated WebP with alpha; next/image would re-encode and drop the animation
    <img src={url} alt="" width={size} height={size} decoding="async" draggable={false} onError={() => { missing.add(url); setFailed(true); }} className="select-none object-contain" style={{ width: size, height: size }} />
  );
}

/** A sticker message: the character sits on (peeks over) the top edge of a small frosted bubble. */
export function AvatarStickerMessage({ content, mine }: { content: string | null; mine: boolean }) {
  const sticker = parseSticker(content);
  if (!sticker) return <p className="rounded-2xl bg-white/70 px-3 py-2 text-xs text-slate-500">Sticker unavailable</p>;
  return (
    <motion.figure initial={{ scale: 0.6, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}
      aria-label={`${sticker.label} sticker`} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div className="relative z-10 -mb-5 px-3"><StickerArt avatarId={sticker.avatarId} stickerId={sticker.stickerId} size={104} /></div>
      <figcaption className="min-w-28 rounded-[22px] border border-white/90 bg-white/75 px-4 pb-2 pt-6 text-center text-xs font-semibold text-slate-600 shadow-[0_10px_28px_rgba(15,23,42,.06)] backdrop-blur-xl">
        {sticker.label}
      </figcaption>
    </motion.figure>
  );
}
