'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { demoToggleFollow, demoToggleLike } from '@/lib/demoData';
import { trackPost } from '@/lib/telemetry';
import { FollowRequestError, requestFollowToggle } from '@/lib/followClient';
import { currentUserId, ensureSession } from '@/lib/session';
import { isDemoMode, supabase } from '@/lib/supabase';

type LikeOverride = { liked: boolean; delta: number };
type FollowOverride = { following: boolean; delta: number };

const UNIQUE_VIOLATION = '23505';

export type SocialActions = {
  /** Signed-in visitor, or null before their first like/follow/post. */
  viewerId: string | null;
  /** The like state to show for a post: the server's value with the visitor's unsynced taps applied. */
  likeView: (post: { id: string; liked: boolean; likes_count: number }) => { liked: boolean; count: number };
  followView: (creatorId: string, base: { following: boolean; followers: number }) => { following: boolean; followers: number };
  toggleLike: (postId: string, currentlyLiked: boolean) => Promise<void>;
  toggleFollow: (creator: { id: string; username: string }, currentlyFollowing: boolean, postId?: string) => Promise<void>;
  error: string | null;
  clearError: () => void;
};

/**
 * Optimistic likes and follows. A tap changes the screen at once (+1 / -1); the Supabase write follows, and if it
 * fails the change is undone and `error` is set. A second tap on the same item while its write is in flight is ignored,
 * so rapid taps can never leave the count and the database disagreeing.
 */
export function useSocialActions(): SocialActions {
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [likes, setLikes] = useState<Record<string, LikeOverride>>({});
  const [follows, setFollows] = useState<Record<string, FollowOverride>>({});
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    void currentUserId().then((id) => { if (alive) setViewerId(id); });
    return () => { alive = false; };
  }, []);

  const likeView = useCallback<SocialActions['likeView']>((post) => {
    const o = likes[post.id];
    return { liked: o?.liked ?? post.liked, count: Math.max(0, post.likes_count + (o?.delta ?? 0)) };
  }, [likes]);

  const followView = useCallback<SocialActions['followView']>((creatorId, base) => {
    const o = follows[creatorId];
    return { following: o?.following ?? base.following, followers: Math.max(0, base.followers + (o?.delta ?? 0)) };
  }, [follows]);

  const toggleLike = useCallback(async (postId: string, currentlyLiked: boolean) => {
    const key = `like:${postId}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const step = currentlyLiked ? -1 : 1;
    const apply = (direction: 1 | -1, liked: boolean) =>
      setLikes((prev) => ({ ...prev, [postId]: { liked, delta: (prev[postId]?.delta ?? 0) + step * direction } }));
    apply(1, !currentlyLiked);
    try {
      const session = await ensureSession();
      setViewerId(session.user.id);
      if (isDemoMode) {
        demoToggleLike(postId, currentlyLiked);
        return;
      }
      const result = currentlyLiked
        ? await supabase.from('post_likes').delete().eq('user_id', session.user.id).eq('post_id', postId)
        : await supabase.from('post_likes').insert({ user_id: session.user.id, post_id: postId });
      if (result.error && result.error.code !== UNIQUE_VIOLATION) throw result.error;
      if (!result.error) trackPost(postId, currentlyLiked ? 'unlike' : 'like');
    } catch {
      apply(-1, currentlyLiked);
      setError(currentlyLiked ? 'Could not remove your like.' : 'Could not like this post.');
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  const toggleFollow = useCallback(async (creator: { id: string; username: string }, currentlyFollowing: boolean, postId?: string) => {
    const creatorId = creator.id;
    const key = `follow:${creatorId}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const step = currentlyFollowing ? -1 : 1;
    const apply = (direction: 1 | -1, following: boolean) =>
      setFollows((prev) => ({ ...prev, [creatorId]: { following, delta: (prev[creatorId]?.delta ?? 0) + step * direction } }));
    apply(1, !currentlyFollowing);
    try {
      const session = await ensureSession();
      setViewerId(session.user.id);
      if (session.user.id === creatorId) throw new FollowRequestError(400, 'You cannot follow yourself');
      if (isDemoMode) {
        demoToggleFollow(creatorId, currentlyFollowing);
        return;
      }
      const result = await requestFollowToggle(creator.username, session.access_token);
      if (result.isFollowing === currentlyFollowing) apply(-1, currentlyFollowing);
      else if (postId && result.isFollowing) trackPost(postId, 'follow_from_post');
    } catch (caught) {
      apply(-1, currentlyFollowing);
      if (caught instanceof FollowRequestError && caught.status === 401) setError('Sign in to follow creators.');
      else if (caught instanceof FollowRequestError && caught.status === 404) setError('This creator no longer exists.');
      else setError(currentlyFollowing ? 'Could not unfollow.' : 'Could not follow.');
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { viewerId, likeView, followView, toggleLike, toggleFollow, error, clearError };
}
