'use client';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { AVATAR_IDS, AVATAR_META } from '@/lib/avatars';
import { isDemoMode } from '@/lib/supabase';

const BADGES = ['Mask', 'Blur', 'Shadow', 'NoFace'] as const;
const OUTER_SECONDS = 70;
const INNER_SECONDS = 48;

/** Places something on a ring: `percent` of the ring box, from the centre, at `index` of `count` evenly spaced spots. */
function onRing(index: number, count: number, radiusPercent: number, offset = 0): { left: string; top: string } {
  const angle = (index / count) * Math.PI * 2 + offset;
  return { left: `${50 + Math.cos(angle) * radiusPercent}%`, top: `${50 + Math.sin(angle) * radiusPercent}%` };
}

/** Welcome screen: a glowing orb, two thin rings slowly turning the four characters and the four privacy modes. */
export function WelcomeOrbit() {
  const reduceMotion = useReducedMotion();
  const spin = (seconds: number, direction: 1 | -1) =>
    reduceMotion ? undefined : { animate: { rotate: 360 * direction }, transition: { duration: seconds, repeat: Infinity, ease: 'linear' as const } };

  return (
    <main
      className="mesh-aura relative flex min-h-dvh flex-col items-center justify-between overflow-hidden px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(3rem,env(safe-area-inset-top))] text-neutral-900"
      style={{ background: 'radial-gradient(120% 80% at 50% 30%, #fffaf5 0%, #f5effb 45%, #e7f2fb 82%, #f2f4f7 100%)' }}
    >
      <div className="relative my-auto aspect-square w-[min(88vw,380px)]" aria-hidden>
        {/* centre orb */}
        <motion.span
          className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle at 40% 35%, #ffffff, #ffe3c8 60%, #f6c7dc)', boxShadow: '0 0 70px 24px rgba(255,255,255,0.85)' }}
          animate={reduceMotion ? undefined : { scale: [1, 1.1, 1] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* inner ring: the four privacy modes */}
        <motion.div className="absolute inset-[24%] rounded-full border border-neutral-900/15" {...spin(INNER_SECONDS, -1)}>
          {BADGES.map((badge, i) => (
            <span key={badge} className="absolute -translate-x-1/2 -translate-y-1/2" style={onRing(i, BADGES.length, 50)}>
              <motion.span
                className="block whitespace-nowrap rounded-full border border-white/60 bg-white/50 px-2.5 py-1 text-[11px] font-medium backdrop-blur-md"
                {...spin(INNER_SECONDS, 1)}
              >
                {badge}
              </motion.span>
            </span>
          ))}
        </motion.div>

        {/* outer ring: the four characters */}
        <motion.div className="absolute inset-0 rounded-full border border-neutral-900/15" {...spin(OUTER_SECONDS, 1)}>
          {AVATAR_IDS.map((id, i) => {
            const { accent, label } = AVATAR_META[id];
            return (
              <span key={id} className="absolute -translate-x-1/2 -translate-y-1/2" style={onRing(i, AVATAR_IDS.length, 50, Math.PI / 4)}>
                <motion.span
                  className="flex size-14 items-center justify-center rounded-full border border-white/70 text-sm font-semibold text-white shadow-lg"
                  style={{ background: `radial-gradient(circle at 35% 30%, ${accent}, ${accent}99 70%)` }}
                  {...spin(OUTER_SECONDS, -1)}
                >
                  {label.split(' ').map((w) => w[0]).join('')}
                </motion.span>
              </span>
            );
          })}
        </motion.div>
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-slate-500">Private by nature</p>
        <h1 className="text-5xl font-semibold tracking-tight">Vybe</h1>
        <p className="text-base leading-snug text-neutral-700">Say what you really think.<br />Faceless reviews, voiced by you.</p>
        <Link href="/feed" className="mt-4 flex h-14 w-full items-center justify-center gap-2 rounded-full bg-neutral-900 text-base font-medium text-white shadow-[0_12px_28px_rgba(15,23,42,.2)] transition-transform active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-neutral-900">
          Get Started <span aria-hidden>↗</span>
        </Link>
        {isDemoMode && <p className="text-xs text-neutral-600">Demo mode: sample data, nothing is saved.</p>}
      </div>
    </main>
  );
}
