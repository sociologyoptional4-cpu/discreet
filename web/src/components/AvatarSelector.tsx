'use client';
import type { AvatarId } from '@/types/avatar';
import { AvatarPickerRail } from '@/components/AvatarPickerRail';

type Props = {
  selectedAvatar: AvatarId;
  onSelectAvatar: (id: AvatarId) => void;
  /** True while recording: the character cannot change mid-clip. */
  disabled?: boolean;
  className?: string;
};

/** Floating glass dock with the four character pills. */
export function AvatarSelector({ selectedAvatar, onSelectAvatar, disabled = false, className = '' }: Props) {
  return <div className={`pointer-events-auto transition-opacity ${disabled ? 'opacity-50' : ''} ${className}`}><AvatarPickerRail selected={selectedAvatar} onSelect={onSelectAvatar} disabled={disabled} /></div>;
}
