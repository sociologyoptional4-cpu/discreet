'use client';

import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { ArrowUp, Heart, LoaderCircle, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClayBuddy } from '@/components/chat/AvatarStickerMessage';
import { usePostComments, type PostComment } from '@/hooks/usePostComments';
import { AVATAR_META, isAvatarId } from '@/lib/avatars';

const QUICK_EMOJIS = ['🔥', '❤️', '😂', '👏', '😮', '💯'] as const;

type CommentsDrawerProps = {
  postId: string | null;
  initialCount?: number;
  onClose: () => void;
  onCountChange?: (postId: string, count: number) => void;
};

function relativeTime(iso: string): string {
  const diffSec = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (diffSec < 60) return 'just now';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export function CommentsDrawer({
  postId,
  initialCount = 0,
  onClose,
  onCountChange,
}: CommentsDrawerProps) {
  const {
    comments,
    totalCount,
    isLoading,
    isSubmitting,
    error,
    viewerId,
    likedIds,
    addComment,
    deleteComment,
    toggleLike,
  } = usePostComments(postId, initialCount);

  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; username: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (postId && onCountChange) {
      onCountChange(postId, totalCount);
    }
  }, [postId, totalCount, onCountChange]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 420) {
      onClose();
    }
  };

  const insertEmoji = (emoji: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(8);
      } catch {
        // ignore
      }
    }
    setDraft((prev) => `${prev}${emoji}`.slice(0, 500));
    inputRef.current?.focus();
  };

  const handleReplyClick = (comment: PostComment, rootId?: string) => {
    setReplyTo({ id: rootId ?? comment.id, username: comment.author.username });
    inputRef.current?.focus();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isSubmitting) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(12);
      } catch {
        // ignore
      }
    }
    const targetParentId = replyTo?.id ?? null;
    setDraft('');
    setReplyTo(null);
    await addComment(text, targetParentId);
  };

  return (
    <AnimatePresence>
      {postId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Comments"
          className="fixed inset-0 z-[65] mx-auto flex max-w-[430px] flex-col justify-end"
        >
          {/* Dimmed backdrop — video continues playing behind it */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[2px]"
          />

          {/* Luminous Frosted Acrylic Bottom Sheet (68dvh) */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.35 }}
            onDragEnd={handleDragEnd}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 flex h-[68dvh] w-full flex-col overflow-hidden rounded-t-[32px] border-t border-white/95 bg-white/88 text-slate-900 shadow-[0_-18px_48px_rgba(15,23,42,0.22)] backdrop-blur-2xl"
          >
            {/* Drag Handle Pill + Header */}
            <div className="shrink-0 border-b border-slate-200/70 px-5 pb-3 pt-2.5">
              <div className="mx-auto mb-2.5 h-1.5 w-11 rounded-full bg-slate-300/90" />
              <div className="flex items-center justify-between">
                <h2 className="text-[15px] font-extrabold tracking-tight text-slate-900">
                  Comments ({totalCount})
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close comments"
                  className="flex size-8 items-center justify-center rounded-full border border-white/90 bg-white/75 text-slate-700 shadow-sm transition active:scale-95"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </div>

            {/* Scrollable Comment List */}
            <div className="flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:none]">
              {isLoading && comments.length === 0 ? (
                <div className="flex h-44 flex-col items-center justify-center gap-2 text-slate-400">
                  <LoaderCircle aria-hidden className="size-6 animate-spin text-violet-500" />
                  <p className="text-xs font-semibold">Loading vibes…</p>
                </div>
              ) : comments.length === 0 ? (
                <div className="flex h-48 flex-col items-center justify-center text-center">
                  <span className="mb-2 text-3xl">✨</span>
                  <p className="text-sm font-bold text-slate-800">Be the first to drop a vibe ✨</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Tap an emoji below or share your honest take.
                  </p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3.5 pb-4">
                  {comments.map((comment) => (
                    <li key={comment.id} className="flex flex-col gap-2">
                      <CommentItem
                        comment={comment}
                        isOwn={viewerId === comment.user_id}
                        liked={likedIds.has(comment.id)}
                        onLike={() => toggleLike(comment.id)}
                        onReply={() => handleReplyClick(comment, comment.id)}
                        onDelete={() => void deleteComment(comment.id, null)}
                      />

                      {/* 1-Level Indented Replies */}
                      {comment.replies.length > 0 && (
                        <ul className="ml-6 flex flex-col gap-2.5 border-l-2 border-slate-200/80 pl-3.5">
                          {comment.replies.map((reply) => (
                            <li key={reply.id}>
                              <CommentItem
                                comment={reply}
                                isOwn={viewerId === reply.user_id}
                                liked={likedIds.has(reply.id)}
                                onLike={() => toggleLike(reply.id)}
                                onReply={() => handleReplyClick(reply, comment.id)}
                                onDelete={() => void deleteComment(reply.id, comment.id)}
                                compact
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && (
              <p role="alert" className="bg-rose-50 px-4 py-1.5 text-center text-xs font-semibold text-rose-600">
                {error}
              </p>
            )}

            {/* Sticky Bottom Input Bar */}
            <div className="shrink-0 border-t border-white/90 bg-white/80 px-3.5 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
              {/* Replying Banner */}
              <AnimatePresence>
                {replyTo && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mb-1.5 flex items-center justify-between rounded-full bg-slate-100/90 px-3 py-1 text-xs font-semibold text-slate-600"
                  >
                    <span>
                      Replying to <strong className="text-slate-900">@{replyTo.username}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setReplyTo(null)}
                      aria-label="Cancel reply"
                      className="text-slate-400 hover:text-slate-700"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* 6 Quick-Tap Emoji Pills */}
              <div className="mb-2 flex items-center justify-between gap-1.5">
                {QUICK_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    aria-label={`Insert ${emoji}`}
                    className="flex h-8 flex-1 items-center justify-center rounded-full border border-white/95 bg-white/85 text-base shadow-sm transition active:scale-90"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              {/* Frosted Input + Luminous Send Button */}
              <form onSubmit={(e) => void handleSubmit(e)} className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={500}
                  placeholder={replyTo ? `Reply to @${replyTo.username}…` : 'Add a comment...'}
                  className="h-11 flex-1 rounded-full border border-white/95 bg-white/90 px-4 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-inner focus:border-violet-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || isSubmitting}
                  aria-label="Send comment"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-slate-900 via-violet-900 to-slate-900 text-white shadow-[0_6px_18px_rgba(15,23,42,0.25)] transition active:scale-90 disabled:opacity-40"
                >
                  <ArrowUp aria-hidden className="size-5" />
                </button>
              </form>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function CommentItem({
  comment,
  isOwn,
  liked,
  onLike,
  onReply,
  onDelete,
  compact = false,
}: {
  comment: PostComment;
  isOwn: boolean;
  liked: boolean;
  onLike: () => void;
  onReply: () => void;
  onDelete: () => void;
  compact?: boolean;
}) {
  const avatarId = isAvatarId(comment.author.avatar_id) ? comment.author.avatar_id : 'cyber_monk';
  const accent = AVATAR_META[avatarId].accent;

  return (
    <div className={`flex items-start gap-2.5 ${comment.optimistic ? 'opacity-70' : ''}`}>
      <Link
        href={`/profile/${comment.author.username}`}
        className="mt-0.5 flex shrink-0 items-center justify-center rounded-full shadow-sm"
        style={{
          background: accent,
          width: compact ? 28 : 34,
          height: compact ? 28 : 34,
        }}
      >
        <ClayBuddy avatarId={avatarId} stickerId="wave" size={compact ? 24 : 30} />
      </Link>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Link
            href={`/profile/${comment.author.username}`}
            className="truncate text-xs font-extrabold text-slate-900"
          >
            @{comment.author.username}
          </Link>
          <span className="text-[11px] font-medium text-slate-400">
            {relativeTime(comment.created_at)}
          </span>
        </div>

        <p className="mt-0.5 break-words text-[13px] leading-snug text-slate-800">
          {comment.content}
        </p>

        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={onReply}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-900"
          >
            Reply
          </button>
          {isOwn && !comment.optimistic && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete comment"
              className="flex items-center gap-0.5 text-[11px] font-semibold text-rose-500 hover:text-rose-700"
            >
              <Trash2 aria-hidden className="size-3" />
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onLike}
        aria-pressed={liked}
        aria-label={liked ? 'Unlike comment' : 'Like comment'}
        className="flex shrink-0 flex-col items-center gap-0.5 pt-1 text-slate-400 transition active:scale-125"
      >
        <Heart
          aria-hidden
          className={`size-4 transition ${
            liked ? 'fill-rose-500 text-rose-500 scale-110' : 'text-slate-400'
          }`}
        />
        {comment.likes_count > 0 && (
          <span className="text-[10px] font-bold tabular-nums text-slate-500">
            {comment.likes_count}
          </span>
        )}
      </button>
    </div>
  );
}
