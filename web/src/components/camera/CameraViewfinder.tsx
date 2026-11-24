'use client';

import type { ReactNode } from 'react';
import { useRef } from 'react';

type CameraViewfinderProps = {
  children: ReactNode;
  className?: string;
  swipeEnabled: boolean;
  onSwipeNext: () => void;
  onSwipePrev: () => void;
  onTouchStartExtra?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMoveExtra?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEndExtra?: () => void;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
};

export function CameraViewfinder({
  children,
  className = '',
  swipeEnabled,
  onSwipeNext,
  onSwipePrev,
  onTouchStartExtra,
  onTouchMoveExtra,
  onTouchEndExtra,
  onClick,
}: CameraViewfinderProps) {
  const swipeStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    onTouchStartExtra?.(e);
    if (!swipeEnabled || e.touches.length !== 1) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now(),
    };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    onTouchMoveExtra?.(e);
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    onTouchEndExtra?.();
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!swipeEnabled || !start || e.changedTouches.length === 0) return;

    const end = e.changedTouches[0];
    const dx = end.clientX - start.x;
    const dy = end.clientY - start.y;
    const dt = Math.max(1, Date.now() - start.time);
    const velocity = Math.abs(dx) / dt;

    if (Math.abs(dx) > Math.abs(dy) * 1.25 && (Math.abs(dx) > 48 || velocity > 0.35)) {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
          navigator.vibrate(12);
        } catch {
          // ignore
        }
      }
      if (dx < 0) onSwipeNext();
      else onSwipePrev();
    }
  };

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onClick={onClick}
      style={{ touchAction: 'pan-y' }}
      className={className}
    >
      {children}
    </div>
  );
}
