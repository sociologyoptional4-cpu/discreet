'use client';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MaskPlayback } from '@/components/MaskPlayback';
import { isAvatarId } from '@/lib/avatars';
import type { ChatMessage } from '@/lib/chatMessages';

type Props = {
  message: ChatMessage;
  isOwnMessage: boolean;
  /** Called once when the viewer lets go (or the page is hidden) so the snap cannot be opened again. */
  onViewed: (messageId: string) => void;
};

/**
 * A disappearing snap. The receiver holds the pill to see it; letting go, losing focus, leaving the page or
 * unmounting closes it at once and marks it viewed. The sender only sees whether it was opened.
 */
export function HoldToViewSnap({ message, isOwnMessage, onViewed }: Props) {
  const [open, setOpen] = useState(false);
  const [consumed, setConsumed] = useState(false); // what the screen shows; the ref below is what handlers check
  const closedRef = useRef(true); // true while nothing is showing, so closing twice only reports once
  const consumedRef = useRef(false); // set the moment a view ends, before the parent's state catches up
  const onViewedRef = useRef(onViewed);
  const idRef = useRef(message.id);
  useEffect(() => {
    onViewedRef.current = onViewed;
    idRef.current = message.id;
  });

  const unviewed = message.viewed_at === null && !consumed;
  const canOpen = !isOwnMessage && message.status === 'sent' && unviewed && message.media_url !== null;

  const start = useCallback(() => {
    if (!canOpen || !closedRef.current || consumedRef.current) return;
    closedRef.current = false;
    setOpen(true);
  }, [canOpen]);

  const finish = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    consumedRef.current = true;
    setConsumed(true);
    setOpen(false);
    onViewedRef.current(idRef.current);
  }, []);

  // Anything that takes the viewer away from the screen ends the view: switching tabs, locking the phone, leaving the page.
  useEffect(() => {
    if (!open) return;
    const onHide = () => { if (document.visibilityState === 'hidden') finish(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', finish);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', finish);
      finish(); // unmounted while open
    };
  }, [open, finish]);

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      start();
    }
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Enter') finish();
  };

  const label = isOwnMessage
    ? message.status === 'sending' ? 'Sending snap…' : message.status === 'failed' ? 'Snap failed to send' : message.viewed_at ? 'Snap opened' : 'Snap sent, not opened yet'
    : message.viewed_at || consumed ? 'Opened' : message.status !== 'sent' ? 'Snap not ready' : 'Hold to view snap';

  return (
    // Pointer handlers sit on the wrapper and the overlay is inside it, so moving over the overlay is not "leaving".
    <div
      onPointerDown={start}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={finish}
      onContextMenu={(e) => e.preventDefault()}
      className="inline-block select-none [-webkit-touch-callout:none] [touch-action:none]"
    >
      <button
        type="button"
        disabled={!canOpen && !open}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={finish}
        aria-label={canOpen ? 'Hold to view snap. Press and hold Space or Enter, or press and hold with your finger.' : label}
        className="rounded-full border border-white/30 px-4 py-2 text-sm disabled:opacity-60"
      >
        {label}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Snap" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="relative h-full w-[min(100vw,calc(100dvh*9/16))]">
            {message.snap_mode === 'mask' ? (
              <MaskPlayback avatarId={isAvatarId(message.avatar_id) ? message.avatar_id : null} motionUrl={message.motion_url} audioUrl={message.media_url ?? ''} soundOn />
            ) : (
              <SnapVideo src={message.media_url ?? ''} />
            )}
          </div>
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-white/80">Release to close</p>
        </div>
      )}
    </div>
  );
}

/** Plays with sound (the press that opened it counts as permission); if the browser still refuses, plays muted. */
function SnapVideo({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => {});
    });
  }, [src]);
  return <video ref={ref} src={src} playsInline autoPlay loop className="size-full object-cover" />;
}
