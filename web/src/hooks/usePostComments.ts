'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HydratedComment } from '@/app/api/posts/[postId]/comments/route';
import { fetchOwnProfile } from '@/lib/feedData';
import { currentUserId, ensureSession } from '@/lib/session';
import { isDemoMode, isSupabaseConfigured, supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';
import type { AvatarId } from '@/types/avatar';

export type PostComment = HydratedComment & {
  optimistic?: boolean;
};

export function usePostComments(postId: string | null | undefined, initialCount = 0) {
  const [trackedPostId, setTrackedPostId] = useState<string | null | undefined>(postId);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [totalCount, setTotalCount] = useState<number>(initialCount);
  const [isLoading, setIsLoading] = useState<boolean>(Boolean(postId));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set());

  const viewerProfileRef = useRef<{ id: string; username: string; avatar_id: AvatarId } | null>(null);
  const aliveRef = useRef(true);

  if (trackedPostId !== postId) {
    setTrackedPostId(postId);
    setComments([]);
    setTotalCount(initialCount);
    setIsLoading(Boolean(postId));
    setError(null);
  }

  const loadComments = useCallback(async () => {
    if (!postId) return;
    try {
      const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`);
      if (!res.ok) throw new Error('Could not load comments.');
      const data = (await res.json()) as { comments?: PostComment[]; totalCount?: number };
      if (!aliveRef.current) return;
      setComments(data.comments ?? []);
      setError(null);
      if (typeof data.totalCount === 'number') {
        setTotalCount(data.totalCount);
      }
    } catch (e) {
      if (aliveRef.current) {
        setError(e instanceof Error ? e.message : 'Could not load comments.');
      }
    } finally {
      if (aliveRef.current) setIsLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    aliveRef.current = true;
    if (!postId) return;

    void currentUserId().then((uid) => {
      if (aliveRef.current) setViewerId(uid);
    });
    void fetchOwnProfile()
      .then((p) => {
        if (p && aliveRef.current) {
          viewerProfileRef.current = { id: p.id, username: p.username, avatar_id: p.avatar_id };
        }
      })
      .catch(() => {});

    queueMicrotask(() => {
      if (aliveRef.current) void loadComments();
    });

    if (!isSupabaseConfigured || isDemoMode) {
      return () => {
        aliveRef.current = false;
      };
    }

    const channel = supabase
      .channel(`post-comments:${postId}:${safeRandomUUID().slice(0, 8)}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'post_comments',
          filter: `post_id=eq.${postId}`,
        },
        () => {
          queueMicrotask(() => {
      if (aliveRef.current) void loadComments();
    });
        }
      )
      .subscribe();

    return () => {
      aliveRef.current = false;
      void supabase.removeChannel(channel);
    };
  }, [postId, loadComments]);

  const addComment = useCallback(
    async (rawContent: string, parentId: string | null = null): Promise<boolean> => {
      const content = rawContent.trim();
      if (!postId || !content || content.length > 500) return false;

      const tempId = `optimistic-${safeRandomUUID()}`;
      const me = viewerProfileRef.current;
      const optimisticItem: PostComment = {
        id: tempId,
        post_id: postId,
        user_id: me?.id ?? viewerId ?? 'me',
        parent_id: parentId,
        content,
        likes_count: 0,
        created_at: new Date().toISOString(),
        author: {
          id: me?.id ?? viewerId ?? 'me',
          username: me?.username ?? 'you',
          avatar_id: me?.avatar_id ?? 'cyber_monk',
          avatar_url: null,
        },
        replies: [],
        optimistic: true,
      };

      setIsSubmitting(true);
      setError(null);
      setTotalCount((c) => c + 1);

      if (parentId) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId ? { ...c, replies: [...c.replies, optimisticItem] } : c
          )
        );
      } else {
        setComments((prev) => [optimisticItem, ...prev]);
      }

      try {
        const session = await ensureSession();
        const res = await fetch(`/api/posts/${encodeURIComponent(postId)}/comments`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content, parent_id: parentId }),
        });

        if (!res.ok) {
          const errData = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(errData?.error ?? 'Could not post comment.');
        }

        const { comment } = (await res.json()) as { comment: PostComment };
        if (!aliveRef.current) return true;

        if (comment.parent_id) {
          setComments((prev) =>
            prev.map((c) =>
              c.id === comment.parent_id
                ? {
                    ...c,
                    replies: c.replies.map((r) => (r.id === tempId ? comment : r)),
                  }
                : c
            )
          );
        } else {
          setComments((prev) => prev.map((c) => (c.id === tempId ? comment : c)));
        }
        return true;
      } catch (e) {
        if (aliveRef.current) {
          setError(e instanceof Error ? e.message : 'Could not post comment.');
          setTotalCount((c) => Math.max(0, c - 1));
          if (parentId) {
            setComments((prev) =>
              prev.map((c) =>
                c.id === parentId
                  ? { ...c, replies: c.replies.filter((r) => r.id !== tempId) }
                  : c
              )
            );
          } else {
            setComments((prev) => prev.filter((c) => c.id !== tempId));
          }
        }
        return false;
      } finally {
        if (aliveRef.current) setIsSubmitting(false);
      }
    },
    [postId, viewerId]
  );

  const deleteComment = useCallback(
    async (commentId: string, parentId: string | null = null): Promise<boolean> => {
      if (!postId) return false;
      const snapshot = comments;
      setTotalCount((c) => Math.max(0, c - 1));
      if (parentId) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === parentId
              ? { ...c, replies: c.replies.filter((r) => r.id !== commentId) }
              : c
          )
        );
      } else {
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      }

      try {
        const session = await ensureSession();
        const res = await fetch(
          `/api/posts/${encodeURIComponent(postId)}/comments?commentId=${encodeURIComponent(commentId)}`,
          {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );
        if (!res.ok) throw new Error('Could not delete comment.');
        return true;
      } catch (e) {
        if (aliveRef.current) {
          setComments(snapshot);
          setTotalCount((c) => c + 1);
          setError(e instanceof Error ? e.message : 'Could not delete comment.');
        }
        return false;
      }
    },
    [postId, comments]
  );

  const toggleLike = useCallback((commentId: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        navigator.vibrate(10);
      } catch {
        // ignore
      }
    }
    setLikedIds((prev) => {
      const next = new Set(prev);
      const willLike = !next.has(commentId);
      if (willLike) next.add(commentId);
      else next.delete(commentId);

      const delta = willLike ? 1 : -1;
      setComments((list) =>
        list.map((c) => {
          if (c.id === commentId) {
            return { ...c, likes_count: Math.max(0, c.likes_count + delta) };
          }
          if (c.replies.some((r) => r.id === commentId)) {
            return {
              ...c,
              replies: c.replies.map((r) =>
                r.id === commentId ? { ...r, likes_count: Math.max(0, r.likes_count + delta) } : r
              ),
            };
          }
          return c;
        })
      );
      return next;
    });
  }, []);

  return {
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
    reload: loadComments,
  };
}
