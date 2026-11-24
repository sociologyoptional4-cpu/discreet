'use client';
import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { LiquidGlassSheet } from '@/components/LiquidGlassSheet';
import { StickerArt } from '@/components/chat/AvatarStickerMessage';
import { ACTION_META, LIVE_ACTIONS, STICKERS, STICKER_IDS, type AvatarAction, type StickerId } from '@/lib/chat/stickerRegistry';
import type { AvatarId } from '@/types/avatar';

type Props = { avatarId: AvatarId; onSticker: (id: StickerId) => void; onAction: (action: AvatarAction) => void; onClose: () => void };

/** Frosted drawer above the composer: live action pills, then the 4-column sticker grid. */
export function AvatarStickerDrawer({ avatarId, onSticker, onAction, onClose }: Props) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <LiquidGlassSheet className="mx-3 mb-2 overflow-hidden p-3">
      <div role="group" aria-label="Live actions" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-3 [scrollbar-width:none]">
        {LIVE_ACTIONS.map((action) => (
          <motion.button key={action} type="button" whileTap={{ scale: 0.9 }} onClick={() => onAction(action)}
            className="acrylic-pill flex min-h-10 shrink-0 items-center gap-1.5 px-3.5 text-[13px] font-semibold">
            {ACTION_META[action].label} <span aria-hidden>{ACTION_META[action].emoji}</span>
          </motion.button>
        ))}
      </div>
      <ul aria-label="Avatar stickers" className="grid grid-cols-4 gap-2">
        {STICKER_IDS.map((id, i) => (
          <motion.li key={id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 22, delay: i * 0.025 }}>
            <button type="button" onClick={() => onSticker(id)} aria-label={`Send ${STICKERS[id].label} sticker`}
              className="flex w-full flex-col items-center rounded-2xl bg-white/50 pb-1.5 pt-1 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-violet-400 active:scale-95">
              <StickerArt avatarId={avatarId} stickerId={id} size={60} />
              <span className="text-[11px] font-semibold text-slate-500">{STICKERS[id].label}</span>
            </button>
          </motion.li>
        ))}
      </ul>
    </LiquidGlassSheet>
  );
}
