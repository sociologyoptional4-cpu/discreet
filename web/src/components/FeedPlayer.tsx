'use client';
import { LayoutGroup } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FeedCard } from '@/components/FeedCard';
import { LiquidWarpCard } from '@/components/LiquidWarpCard';
import { SwipeBubbleOverlay } from '@/components/SwipeBubbleOverlay';
import { useSocialActions } from '@/hooks/useSocialActions';
import { findConversationWith } from '@/lib/chatData';
import { setImmersive } from '@/lib/immersive';
import { ensureSession } from '@/lib/session';
import { handleShare } from '@/lib/share';
import type { FeedItem } from '@/types/social';

const ACTIVE_RATIO = 0.6;
const PEEK_PX = 18; // how much of the neighbouring cards shows above and below the current one
const GAP_PX = 6;

type Props = { items: FeedItem[] };

/**
 * Vertical snap feed of rounded cards on a black background. One card is "active" (the one in view) and only that
 * card may own the shared WebGL canvas, so the feed never holds more than one context however far you scroll.
 * Tapping a card expands it to full screen; the navigation hides while it is open.
 */
export function FeedPlayer({ items }: Props) {
  const router = useRouter();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [observedId, setObservedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pausedId, setPausedId] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(false); // browsers allow sound only after a tap, so the feed starts muted
  const [note, setNote] = useState<string | null>(null);
  const [swipe, setSwipe] = useState<{ id: string; direction: 'up' | 'down' } | null>(null);
  const previousIndex = useRef<number | null>(null);
  const social = useSocialActions();

  const activeId = observedId !== null && items.some((p) => p.id === observedId) ? observedId : (items[0]?.id ?? null);
  const activeIndex = items.findIndex((p) => p.id === activeId);
  const expanded = expandedId !== null;

  useEffect(() => {
    if (activeIndex < 0) return;
    if (previousIndex.current !== null && previousIndex.current !== activeIndex && activeId) {
      setSwipe({ id: `${activeId}-${Date.now()}`, direction: activeIndex > previousIndex.current ? 'up' : 'down' });
    }
    previousIndex.current = activeIndex;
  }, [activeId, activeIndex]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTop = 0; // a new list always starts on its first card
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting && e.intersectionRatio >= ACTIVE_RATIO);
        const id = visible?.target.getAttribute('data-post-id');
        if (id) setObservedId(id);
      },
      { root: scroller, threshold: [ACTIVE_RATIO] },
    );
    scroller.querySelectorAll('[data-post-id]').forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  useEffect(() => {
    setImmersive('feed-card', expanded);
    return () => setImmersive('feed-card', false);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpandedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const flash = (text: string) => {
    setNote(text);
    setTimeout(() => setNote(null), 2500);
  };

  const share = async (item: FeedItem) => {
    const url = `${window.location.origin}/feed?postId=${item.id}`;
    // Incog posts never name their creator, not even in the share text.
    const title = item.is_incog || !item.creator_username ? 'A review on Vybe' : `A review by @${item.creator_username} on Vybe`;
    const result = await handleShare({ title, text: item.ai_summary ?? undefined, url });
    if (result === 'copied') flash('Link copied');
    else if (result === 'failed') flash('Could not share this post');
  };

  /** Opens the chat if you already talk; otherwise the profile, where a request with a reason can be sent. */
  const message = async (item: FeedItem) => {
    if (!item.user_id || !item.creator_username) return;
    try {
      const session = await ensureSession();
      const existing = await findConversationWith(session.user.id, item.user_id);
      router.push(existing?.status === 'accepted' ? `/chats/${existing.id}` : `/profile/${item.creator_username}`);
    } catch {
      router.push(`/profile/${item.creator_username}`);
    }
  };

  return (
    <div className="relative h-dvh w-full bg-black text-white">
      <LayoutGroup>
        <div
          ref={scrollerRef}
          role="feed"
          aria-label="Posts"
          tabIndex={0}
          className={`h-dvh snap-y snap-mandatory overscroll-y-contain [scrollbar-width:none] focus-visible:outline-none ${expanded ? 'overflow-hidden' : 'overflow-y-auto'}`}
          style={{ scrollSnapType: 'y mandatory', paddingBlock: PEEK_PX }}
        >
          {items.map((item, index) => (
            <article
              key={item.id}
              data-post-id={item.id}
              aria-posinset={index + 1}
              aria-setsize={items.length}
              className="relative w-full snap-center snap-always"
              style={{ height: `calc(100dvh - ${PEEK_PX * 2}px)`, marginBottom: GAP_PX }}
            >
              <LiquidWarpCard axis="vertical" className="absolute inset-0">
              <FeedCard
                item={item}
                active={item.id === activeId}
                near={Math.abs(index - activeIndex) <= 1}
                expanded={item.id === expandedId}
                paused={pausedId === item.id}
                soundOn={soundOn}
                social={social}
                onExpand={() => { setExpandedId(item.id); setSoundOn(true); }}
                onCollapse={() => setExpandedId(null)}
                onTogglePause={() => setPausedId((p) => (p === item.id ? null : item.id))}
                onToggleSound={() => setSoundOn((on) => !on)}
                onShare={() => void share(item)}
                onMessage={() => void message(item)}
              />
              </LiquidWarpCard>
            </article>
          ))}
        </div>
        <SwipeBubbleOverlay trigger={swipe?.id ?? ''} direction={swipe?.direction} />
      </LayoutGroup>

      {(note || social.error) && (
        <p role="status" className="fixed inset-x-0 top-6 z-[60] mx-auto w-fit max-w-[90%] rounded-full bg-white/15 px-4 py-2 text-sm font-medium backdrop-blur-md">
          {note ?? social.error}
          {social.error && !note && <button type="button" onClick={social.clearError} className="ml-2 underline">Dismiss</button>}
        </p>
      )}
    </div>
  );
}
