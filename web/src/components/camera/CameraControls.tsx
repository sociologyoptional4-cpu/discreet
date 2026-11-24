'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Camera, ChevronDown, Gauge, Grid3x3, Hourglass, ImagePlus, SmilePlus, Sparkles, Timer, Wand2, Webcam, Zap, ZapOff, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Smoked glass: keeps the live camera feed visible behind every control. */
export const GLASS = 'border border-white/15 bg-black/30 text-white shadow-sm backdrop-blur-xl';
export const glassIconBtn = `flex size-10 items-center justify-center rounded-full ${GLASS} transition-transform active:scale-90 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40`;

const SPRING = { type: 'spring', stiffness: 380, damping: 28 } as const;

type RailProps = {
  flipButton: ReactNode;
  flashOn: boolean;
  onToggleFlash: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timerDelay: number;
  onCycleTimer: () => void;
  speedRate: number;
  onCycleSpeed: () => void;
  durationLimit: number;
  onCycleDuration: () => void;
  /** Null hides the grid toggle (mask mode has no 2D canvas to overlay). */
  showGrid: boolean | null;
  onToggleGrid: () => void;
};

/** Flip, Flash and a "more" chevron; the chevron unfolds Timer, Speed, Grid and Duration in a glass drawer. */
export function CameraTopRail(props: RailProps) {
  const { open, onOpenChange } = props;
  const extras: { key: string; Icon: LucideIcon; value: string; label: string; pressed?: boolean; onClick: () => void }[] = [
    { key: 'timer', Icon: Timer, value: props.timerDelay ? `${props.timerDelay}s` : 'Off', label: `Timer: ${props.timerDelay ? `${props.timerDelay} seconds` : 'off'}`, onClick: props.onCycleTimer },
    { key: 'speed', Icon: Gauge, value: `${props.speedRate}x`, label: `Speed: ${props.speedRate}x`, onClick: props.onCycleSpeed },
    ...(props.showGrid === null ? [] : [{ key: 'grid', Icon: Grid3x3, value: '3x3', label: 'Grid', pressed: props.showGrid, onClick: props.onToggleGrid }]),
    { key: 'duration', Icon: Hourglass, value: `${props.durationLimit}s`, label: `Max length: ${props.durationLimit} seconds`, onClick: props.onCycleDuration },
  ];
  return (
    <div onClick={(e) => e.stopPropagation()} className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex flex-col items-center gap-2">
      {props.flipButton}
      <button type="button" onClick={props.onToggleFlash} aria-label={props.flashOn ? 'Turn flash off' : 'Turn flash on'} aria-pressed={props.flashOn}
        className={`${glassIconBtn} ${props.flashOn ? '!border-amber-200/60 !bg-amber-300/85 !text-slate-950' : ''}`}>
        {props.flashOn ? <Zap aria-hidden className="size-4" /> : <ZapOff aria-hidden className="size-4" />}
      </button>
      <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} aria-controls="camera-more" aria-label={open ? 'Fewer camera settings' : 'More camera settings'} className={glassIconBtn}>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={SPRING} className="flex"><ChevronDown aria-hidden className="size-4" /></motion.span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div id="camera-more" initial={{ opacity: 0, y: -10, scaleY: 0.85 }} animate={{ opacity: 1, y: 0, scaleY: 1 }} exit={{ opacity: 0, y: -8, scaleY: 0.9 }} transition={SPRING}
            style={{ transformOrigin: 'top' }} className={`flex flex-col gap-1 rounded-[22px] p-1 ${GLASS}`}>
            {extras.map(({ key, Icon, value, label, pressed, onClick }) => (
              <button key={key} type="button" onClick={onClick} aria-label={label} aria-pressed={pressed}
                className={`flex size-11 flex-col items-center justify-center gap-0.5 rounded-2xl text-[9px] font-bold transition-colors focus-visible:outline-2 focus-visible:outline-white ${pressed ? 'bg-white/25' : 'hover:bg-white/10'}`}>
                <Icon aria-hidden className="size-3.5" />{value}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Tiny zoom read-out. Remounted (via `key`) on every zoom change; it fades itself out after a second. */
export function ZoomBadge({ value }: { value: number }) {
  return (
    <motion.span aria-live="polite" initial={{ opacity: 1, scale: 1 }} animate={{ opacity: 0, scale: 0.96 }} transition={{ delay: 1, duration: 0.3 }}
      className={`pointer-events-none absolute left-1/2 top-[42%] z-20 -translate-x-1/2 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${GLASS}`}>
      {value.toFixed(1)}x
    </motion.span>
  );
}

export type LensCategory = 'snap' | 'studio';

/** Slim footer under the shutter: Gallery import plus the two lens sets. */
export function CameraCategoryStrip({ category, onCategoryChange, onGallery, snapCount, studioCount }: {
  category: LensCategory; onCategoryChange: (c: LensCategory) => void; onGallery: () => void; snapCount: number; studioCount: number;
}) {
  const tabs: { key: string; label: string; Icon: LucideIcon; active: boolean; onClick: () => void; disabled?: boolean }[] = [
    { key: 'gallery', label: 'Gallery', Icon: ImagePlus, active: false, onClick: onGallery },
    { key: 'snap', label: 'Snap AR', Icon: Sparkles, active: category === 'snap', onClick: () => onCategoryChange('snap'), disabled: snapCount === 0 },
    { key: 'studio', label: 'Studio FX', Icon: Wand2, active: category === 'studio', onClick: () => onCategoryChange('studio'), disabled: studioCount === 0 },
  ];
  return (
    <nav aria-label="Lens sets" className={`flex items-center justify-center gap-0.5 rounded-full p-1 ${GLASS}`}>
      {tabs.map(({ key, label, Icon, active, onClick, disabled }) => (
        <button key={key} type="button" onClick={onClick} disabled={disabled} aria-pressed={key === 'gallery' ? undefined : active}
          aria-label={label}
          className={`relative flex min-h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-3 text-[11px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-white disabled:opacity-35 ${active ? 'text-slate-950' : 'text-white/75 hover:text-white'}`}>
          {active && <motion.span layoutId="camera-category-pill" transition={SPRING} aria-hidden className="absolute inset-0 rounded-full bg-white shadow-[0_0_14px_rgba(255,255,255,.45)]" />}
          <motion.span whileTap={{ scale: 0.8, rotate: -8 }} className="relative flex"><Icon aria-hidden className="size-4" /></motion.span>
          <AnimatePresence initial={false}>
            {active && (
              <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={SPRING} className="relative overflow-hidden whitespace-nowrap">{label}</motion.span>
            )}
          </AnimatePresence>
        </button>
      ))}
    </nav>
  );
}

/** A soft face outline shown while a face lens waits for a face; the parent unmounts it once one is detected. */
export function ArFramingGuide() {
  const reduce = useReducedMotion();
  return (
    <motion.div aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
      className="pointer-events-none absolute inset-x-0 top-[22%] z-[5] flex flex-col items-center gap-3">
      <motion.span aria-hidden className="h-56 w-44 rounded-[50%] border-2 border-dashed border-white/55"
        animate={reduce ? undefined : { scale: [1, 1.03, 1], opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }} />
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${GLASS}`}>Center your face</span>
    </motion.div>
  );
}

/** Hairline session XP along the very top edge. */
export function CameraXpBar({ progress }: { progress: number }) {
  const value = Math.min(1, Math.max(0, progress));
  return (
    <div role="progressbar" aria-label="Lens discovery XP" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}
      className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[2px] bg-white/10">
      <motion.div className="h-full origin-left bg-[linear-gradient(90deg,#67e8f9,#c4b5fd,#f9a8d4,#86efac)] shadow-[0_0_8px_#c4b5fd]"
        initial={false} animate={{ scaleX: value }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
    </div>
  );
}

type CameraDevice = { deviceId: string; label: string };

/** Front, back or numbered webcam, read from the browser's device label. */
function deviceKind(label: string, index: number): { Icon: LucideIcon; name: string } {
  const l = label.toLowerCase();
  if (/front|user|facetime|selfie/.test(l)) return { Icon: SmilePlus, name: 'Front' };
  if (/back|rear|environment|world/.test(l)) return { Icon: Camera, name: l.includes('ultra') ? 'Ultra wide' : l.includes('tele') ? 'Zoom' : 'Back' };
  return { Icon: Webcam, name: `Cam ${index + 1}` };
}

/** Animated icon toggle for picking a camera, in place of a native <select> (whose phone picker takes over the screen). */
export function CameraDeviceToggle({ devices, selectedId, onSelect }: { devices: CameraDevice[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (devices.length === 0) return null;
  return (
    <div role="radiogroup" aria-label="Camera" className={`flex max-w-full gap-1 overflow-x-auto rounded-full p-1 no-scrollbar ${GLASS}`}>
      {devices.map((d, i) => {
        const { Icon, name } = deviceKind(d.label, i);
        const active = d.deviceId === selectedId;
        return (
          <button key={d.deviceId} type="button" role="radio" aria-checked={active} aria-label={d.label || name} onClick={() => onSelect(d.deviceId)}
            className="relative flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-white">
            {active && <motion.span layoutId="camera-device-pill" transition={SPRING} aria-hidden className="absolute inset-0 rounded-full bg-white" />}
            <Icon aria-hidden className={`relative size-4 ${active ? 'text-slate-950' : 'text-white/80'}`} />
            <AnimatePresence initial={false}>
              {active && (
                <motion.span initial={{ opacity: 0, width: 0 }} animate={{ opacity: 1, width: 'auto' }} exit={{ opacity: 0, width: 0 }} transition={SPRING} className="relative overflow-hidden whitespace-nowrap text-slate-950">
                  {name}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        );
      })}
    </div>
  );
}
