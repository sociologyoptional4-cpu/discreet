import type { SessionAffinityContext, WatchedPostEntry } from './sessionContext';

export type NudgeTriggerType = 'favorite_creator_drop' | 'transcript_deep_match' | 'counter_take_flip';

export type FeedNudgePayload = {
  id: string;
  triggerType: NudgeTriggerType;
  message: string;
  targetPostId: string;
  targetPostPreview: {
    topic_entity: string | null;
    creator_username: string | null;
    emotion_tag: string | null;
    sentiment: string | null;
    ai_summary: string | null;
  };
  ctaLabel: string;
};

const MIN_POSTS_BEFORE_NUDGE = 2;
const BASE_SWIPE_COOLDOWN = 4;
const BASE_TIME_COOLDOWN_MS = 90_000;

/** Evaluates anti-spam guardrails before requesting a contextual AI nudge from the server. */
export function canTriggerNudge(ctx: SessionAffinityContext, now = Date.now()): boolean {
  if (ctx.watchedPosts.length < MIN_POSTS_BEFORE_NUDGE) return false;
  const backoffMultiplier = ctx.consecutiveDismissals >= 2 ? 2 : 1;
  const requiredSwipes = BASE_SWIPE_COOLDOWN * backoffMultiplier;
  const requiredMs = BASE_TIME_COOLDOWN_MS * backoffMultiplier;

  if (ctx.swipesSinceNudge < requiredSwipes) return false;
  if (ctx.lastNudgeAt > 0 && now - ctx.lastNudgeAt < requiredMs) return false;
  return true;
}

export async function evaluateFeedNudge(
  ctx: SessionAffinityContext,
  currentPost: WatchedPostEntry | null,
  signal?: AbortSignal,
): Promise<FeedNudgePayload | null> {
  if (!canTriggerNudge(ctx)) return null;
  try {
    const res = await fetch('/api/feed/nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        seenPostIds: ctx.seenPostIds,
        favoriteCreators: ctx.favoriteCreators,
        topicWeights: ctx.topicWeights,
        keywordWeights: ctx.keywordWeights,
        currentPost: currentPost
          ? {
              postId: currentPost.postId,
              topic_entity: currentPost.topic_entity,
              sentiment: currentPost.sentiment,
              completionRate: currentPost.completionRate,
            }
          : null,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { nudge?: FeedNudgePayload | null };
    return data.nudge ?? null;
  } catch {
    return null;
  }
}
