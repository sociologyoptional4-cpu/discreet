'use client';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { MaskPlayback } from '@/components/MaskPlayback';
import { isAvatarId } from '@/lib/avatars';
import type { SnapView } from '@/types/chat';
import type { ChatMessage } from '@/lib/chatMessages';

type Props = {
  message: ChatMessage;
  isOwnMessage: boolean;
  onOpen: (id: string) => Promise<SnapView | null>;
  canReplay: boolean;
  onSignal: (reason: 'key' | 'hidden') => void;
  /** Tapped with a second finger while the snap is held open. */
  onQuickReact?: (emoji: string) => void;
};

const QUICK = ['🔥', '😂', '❤️', '😮'];

export function HoldToViewSnap({ message, isOwnMessage, onOpen, canReplay, onSignal, onQuickReact }: Props) {
  const [media, setMedia] = useState<{url: string; motionUrl: string | null} | null>(null);
  const gesture = useRef(0);
  const held = useRef(false);
  const captureReported = useRef(false);
  const pending = useRef(false);
  const signal = useRef(onSignal);
  useEffect(() => { signal.current = onSignal; }, [onSignal]);
  const localPreview = isOwnMessage && message.media_url?.startsWith('blob:');
  const canOpen = Boolean(localPreview || (!isOwnMessage && !message.replayed_by_recipient && (!message.viewed_at || canReplay)));
  const open = media !== null;
  const finish = useCallback(() => {
    held.current = false;
    gesture.current++;
    setMedia(null);
  }, []);
  const start = async () => {
    if (!canOpen || held.current || pending.current) return;
    held.current = true;
    captureReported.current = false;
    const id = ++gesture.current;
    if (localPreview && message.media_url) {
      setMedia({url: message.media_url, motionUrl: message.motion_url});
      return;
    }
    pending.current = true;
    try {
      const result = await onOpen(message.id);
      if (result && gesture.current === id && held.current && document.visibilityState === 'visible') setMedia(result);
    } finally { pending.current = false; }
  };
  useEffect(() => () => { held.current = false; gesture.current++; }, []);
  useEffect(() => {
    if (!open) return;
    const hidden = () => {
      if (document.visibilityState !== 'hidden') return;
      if (!isOwnMessage) signal.current('hidden');
      finish();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (!isOwnMessage && e.key === 'PrintScreen' && !captureReported.current) {
        captureReported.current = true;
        signal.current('key');
      }
    };
    const expiry = window.setTimeout(finish, 60000);
    window.addEventListener('keyup', key);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', finish);
    return () => {
      window.clearTimeout(expiry);
      window.removeEventListener('keyup', key);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', finish);
    };
  }, [open, isOwnMessage, finish]);

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
    : canReplay ? 'Hold to replay' : message.viewed_at ? 'Opened' : 'Hold to view snap';

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
        className="flex min-h-11 items-center gap-2 rounded-[22px] border border-white/90 bg-white/80 px-4 py-2 text-sm font-semibold text-slate-800 shadow-[0_10px_28px_rgba(15,23,42,.06)] backdrop-blur-xl disabled:opacity-60"
      >
        <span aria-hidden className={`size-3 rounded-sm ${message.snap_mode === 'mask' ? 'bg-violet-400' : 'bg-rose-400'} ${canOpen ? '' : 'opacity-40'}`} />
        {label}
      </button>

      {open && (
        <div role="dialog" aria-modal="true" aria-label="Snap" className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <div className="relative h-full w-[min(100vw,calc(100dvh*9/16))]">
            {message.snap_mode === 'mask' ? (
              <MaskPlayback avatarId={isAvatarId(message.avatar_id) ? message.avatar_id : null} motionUrl={media.motionUrl} audioUrl={media.url} soundOn />
            ) : (
              <SnapVideo src={media.url} />
            )}
          </div>
          {!isOwnMessage && onQuickReact && (
            // Stop pointer events here so a second finger reacting does not count as releasing the snap.
            <div role="group" aria-label="Quick react" className="absolute inset-x-0 bottom-16 flex justify-center gap-4"
              onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerLeave={(e) => e.stopPropagation()} onPointerCancel={(e) => e.stopPropagation()}>
              {QUICK.map((emoji) => (
                <button key={emoji} type="button" aria-label={`React ${emoji}`} onClick={() => onQuickReact(emoji)}
                  className="flex size-12 items-center justify-center rounded-full border border-white/40 bg-white/20 text-2xl shadow-[0_8px_20px_rgba(0,0,0,.25)] backdrop-blur-md transition-transform active:scale-90">
                  {emoji}
                </button>
              ))}
            </div>
          )}
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
