'use client';
import { motion } from 'framer-motion';
import { LiveAvatarActionStage, type StageEvent } from '@/components/chat/LiveAvatarActionStage';
import type { GyroParallax } from '@/hooks/useGyroParallax';
import { ACTION_META, ROOM_EMOTES, type AvatarAction } from '@/lib/chat/stickerRegistry';
import type { AvatarId } from '@/types/avatar';

type Props = {
  me: AvatarId;
  other: AvatarId;
  otherName: string;
  peerInRoom: boolean;
  event: StageEvent | null;
  tilt: GyroParallax;
  onEmote: (action: AvatarAction) => void;
};

/** Both avatars on a glass pedestal, seen through a tilt-driven "window"; emotes play on both phones at once. */
export function DuoHangoutRoom({ me, other, otherName, peerInRoom, event, tilt, onEmote }: Props) {
  return (
    <motion.section aria-label={`3D room with @${otherName}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }} className="relative shrink-0 overflow-hidden">
      <div className="relative mx-3 mt-2 h-[min(38dvh,300px)] overflow-hidden rounded-[28px] border border-white/90 bg-[radial-gradient(120%_80%_at_50%_0%,#ffffff,#eef0ff_45%,#fbe8f3)] shadow-[0_10px_28px_rgba(15,23,42,.06)]">
        <LiveAvatarActionStage me={me} other={other} event={event} room tiltX={tilt.x} tiltY={tilt.y} className="absolute inset-0" />
        <span role="status" className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${peerInRoom ? 'bg-emerald-50/90 text-emerald-700' : 'bg-white/80 text-slate-500'} backdrop-blur`}>
          <span aria-hidden className={`size-1.5 rounded-full ${peerInRoom ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
          {peerInRoom ? 'Both in room' : `Waiting for @${otherName}`}
        </span>
        {tilt.needsPermission && (
          <button type="button" onClick={() => void tilt.enable()} className="acrylic-pill absolute right-3 top-3 min-h-9 px-3 text-[11px] font-bold">Enable 3D Tilt</button>
        )}
        <div role="group" aria-label="Duo emotes" className="absolute inset-x-3 bottom-3 flex justify-center gap-1.5">
          {ROOM_EMOTES.map((action) => (
            <motion.button key={action} type="button" whileTap={{ scale: 0.88 }} onClick={() => onEmote(action)}
              className="acrylic-pill flex min-h-10 items-center gap-1 px-3 text-xs font-semibold">
              <span aria-hidden>{ACTION_META[action].emoji}</span>{ACTION_META[action].label === 'Duo Dance' ? 'Dance' : ACTION_META[action].label}
            </motion.button>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
