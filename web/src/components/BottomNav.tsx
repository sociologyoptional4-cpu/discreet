'use client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, MessageCircle, Plus, Search, User, type LucideIcon } from 'lucide-react';
import { useOfflineDelivery } from '@/hooks/useOfflineDelivery';
import { useNotifications } from '@/hooks/useNotifications';
import { useImmersive } from '@/lib/immersive';

const ITEMS: { href: string; label: string; Icon: LucideIcon; center?: boolean }[] = [
  { href: '/feed', label: 'Feed', Icon: Home },
  { href: '/search', label: 'Search', Icon: Search },
  { href: '/record', label: 'Record', Icon: Plus, center: true },
  { href: '/chats', label: 'Chats', Icon: MessageCircle },
  { href: '/profile/me', label: 'Profile', Icon: User },
];

/** Screens that take over the display have no navigation: the welcome page, camera, calibration and open chat threads. */
const HIDDEN_EXACT = ['/'];
const HIDDEN_SECTIONS = ['/record', '/persona'];
/** An open thread (`/chats/<id>`) hides the nav; the inbox (`/chats`) keeps it. */
const isHidden = (path: string) =>
  HIDDEN_EXACT.includes(path) || HIDDEN_SECTIONS.some((p) => path === p || path.startsWith(`${p}/`)) || path.startsWith('/chats/');

/** A floating glass pill. It slides away while a feed card is expanded or the camera is open. */
export function BottomNav() {
  useOfflineDelivery();
  const pathname = usePathname();
  const { unreadCount } = useNotifications();
  const immersive = useImmersive();
  const reduceMotion = useReducedMotion();

  if (isHidden(pathname)) return null;
  const onFeed = pathname === '/feed' || pathname.startsWith('/feed/');

  return (
    <>
      {/* Normal pages keep room under their content; the feed runs edge to edge under the pill. */}
      {!onFeed && <div aria-hidden className="h-[var(--nav-h)] shrink-0" />}
      <AnimatePresence>
        {!immersive && (
          <motion.nav
            aria-label="Main"
            initial={reduceMotion ? false : { y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            className="fixed inset-x-0 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 flex justify-center px-4"
          >
            <ul className="acrylic-pill flex items-center gap-1 px-2 py-1.5">
              {ITEMS.map(({ href, label, Icon, center }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                const dot = href === '/profile/me' && unreadCount > 0;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      aria-current={active ? 'page' : undefined}
                      aria-label={dot ? `${label}, ${unreadCount} unread notifications` : label}
                      className={`relative flex items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-slate-900 motion-reduce:transition-none ${
                        center ? 'size-12 bg-slate-900 text-white shadow-[0_6px_18px_rgba(15,23,42,.22)]' : `size-11 ${active ? 'text-slate-900' : 'text-slate-500'}`
                      }`}
                    >
                      {active && !center && <motion.span layoutId="activeNavPill" className="absolute inset-0 -z-0 rounded-full bg-white shadow-[0_3px_12px_rgba(15,23,42,.09)]" transition={{ type: 'spring', stiffness: 360, damping: 30 }} />}
                      <Icon aria-hidden className={`relative z-[1] ${center ? 'size-6' : 'size-5'}`} strokeWidth={center ? 2.5 : 2} />
                      {dot && <span aria-hidden className="absolute right-2 top-2 size-2 rounded-full bg-rose-500 ring-2 ring-black/40" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </motion.nav>
        )}
      </AnimatePresence>
    </>
  );
}
