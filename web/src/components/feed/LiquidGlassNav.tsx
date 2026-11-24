'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { Home, MessageCircle, Plus, Search, Sparkles, User, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId } from 'react';

const ITEMS: { href: string; label: string; Icon: LucideIcon; create?: boolean }[] = [
  { href: '/feed', label: 'Home', Icon: Home },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/record', label: 'Create', Icon: Plus, create: true },
  { href: '/chats', label: 'Chats', Icon: MessageCircle },
  { href: '/profile/me', label: 'Profile', Icon: User },
];
const ORB = 48;
const GAP = 8;
const SPRING = { type: 'spring', stiffness: 340, damping: 24 } as const;
/** Each orb's offset from the corner orb when open: the close button stays in the corner, the rest spread left. */
const offset = (i: number): number => -(ITEMS.length - i) * (ORB + GAP);
const tint = 'rgb(var(--feed-accent-rgb) / 0.42)';

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * One glossy glass orb in the bottom-right corner, tinted by the video. Tapping it melts (SVG goo filter) into a row
 * of orbs: Home, Search, Create, Chats, Profile and a close button. Tap outside, close, or swipe to merge back.
 */
export function LiquidGlassNav({ open, onOpenChange }: Props) {
  const reduce = useReducedMotion();
  const gooId = `goo-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <>
      <svg aria-hidden width="0" height="0" className="absolute">
        <filter id={gooId} x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>
      {open && <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={() => onOpenChange(false)} className="absolute inset-0 z-40 cursor-default" />}

      <nav aria-label="Main" className="pointer-events-none absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-50" style={{ width: ORB, height: ORB }}>
        {/* Liquid layer: coloured blobs only, melted together by the goo filter. Icons sit crisp on top. */}
        <div aria-hidden className="absolute bottom-0 right-0" style={{ width: (ITEMS.length + 1) * (ORB + GAP), height: ORB, filter: reduce ? undefined : `url(#${gooId})` }}>
          {ITEMS.map((item, i) => (
            <motion.span key={item.href} className="absolute right-0 top-0 rounded-full will-change-transform" style={{ background: tint, width: ORB, height: ORB }}
              initial={false} animate={{ x: open ? offset(i) : 0, scale: open ? 1 : 0.6 }} transition={{ ...SPRING, delay: open ? (ITEMS.length - i) * 0.03 : 0 }} />
          ))}
          <span className="absolute right-0 top-0 rounded-full" style={{ background: tint, width: ORB, height: ORB }} />
        </div>

        <AnimatePresence>
          {open && ITEMS.map((item, i) => (
            <motion.div key={item.href} className="pointer-events-auto absolute inset-0"
              initial={{ x: 0, opacity: 0, scale: 0.4 }} animate={{ x: offset(i), opacity: 1, scale: 1 }} exit={{ x: 0, opacity: 0, scale: 0.4 }}
              transition={{ ...SPRING, delay: open ? (ITEMS.length - i) * 0.03 : 0 }}>
              <Link href={item.href} aria-label={item.label} onClick={() => onOpenChange(false)}
                className={`flex size-full items-center justify-center rounded-full border text-white shadow-[inset_0_1px_0_rgba(255,255,255,.45)] backdrop-blur-md focus-visible:outline-2 focus-visible:outline-white ${item.create ? 'border-white/60 bg-white/25 shadow-[inset_0_1px_0_rgba(255,255,255,.6),0_0_16px_rgba(255,255,255,.5)]' : 'border-white/25 bg-white/10'}`}>
                <item.Icon aria-hidden className={item.create ? 'size-6' : 'size-5'} strokeWidth={item.create ? 2.6 : 2} />
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>

        <motion.button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} aria-label={open ? 'Close navigation' : 'Open navigation'}
          whileTap={{ scale: 0.88 }} transition={SPRING}
          className="pointer-events-auto absolute inset-0 flex items-center justify-center rounded-full border border-white/40 text-white backdrop-blur-md transition-shadow duration-700 focus-visible:outline-2 focus-visible:outline-white"
          style={{ boxShadow: 'inset 0 1.5px 0 rgba(255,255,255,.55), inset 0 -6px 12px rgb(var(--feed-accent-rgb) / 0.35), 0 0 18px rgb(var(--feed-accent-rgb) / 0.55), 0 0 2px rgb(var(--feed-accent-rgb) / 0.9)' }}>
          {!open && !reduce && (
            <motion.span aria-hidden className="absolute -inset-1 rounded-full border border-white/25"
              animate={{ scale: [1, 1.18, 1], opacity: [0.5, 0, 0.5] }} transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }} />
          )}
          <span aria-hidden className="absolute left-2 top-1.5 h-3 w-5 rounded-full bg-gradient-to-b from-white/70 to-transparent blur-[1px]" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={String(open)} initial={{ rotate: -90, scale: 0.5, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} exit={{ rotate: 90, scale: 0.5, opacity: 0 }} transition={SPRING} className="relative flex">
              {open ? <X aria-hidden className="size-5" /> : <Sparkles aria-hidden className="size-5" />}
            </motion.span>
          </AnimatePresence>
        </motion.button>
      </nav>
    </>
  );
}
