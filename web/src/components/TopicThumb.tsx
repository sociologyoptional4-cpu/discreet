'use client';
import { motion } from 'framer-motion';
import { AVATAR_META } from '@/lib/avatars';
import type { PublicPost } from '@/types/social';

const MODE_TINT: Record<PublicPost['mode'], string> = { mask: '#c4b5fd', blur: '#93c5fd', shadow: '#a1a1aa', noface: '#fda4af' };

type Props = { post: PublicPost; size: number; className?: string };

/** A round preview of one post. The shared layoutId lets it glide from a cluster into the orbital ring. */
export function TopicThumb({ post, size, className = '' }: Props) {
  const tint = post.avatar_id ? AVATAR_META[post.avatar_id].accent : MODE_TINT[post.mode];
  const initial = (post.is_incog ? 'A' : (post.creator_username ?? '?')).slice(0, 1).toUpperCase();
  return (
    <motion.div
      layoutId={`thumb-${post.id}`}
      aria-hidden
      className={`flex items-center justify-center rounded-full border border-white/30 text-sm font-semibold text-white/90 shadow-lg backdrop-blur-md ${className}`}
      style={{ width: size, height: size, background: `radial-gradient(circle at 35% 30%, ${tint}cc, ${tint}44 70%)` }}
    >
      {initial}
    </motion.div>
  );
}
