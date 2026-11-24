'use client';

export type WatchedPostEntry = {
  postId: string;
  creatorId: string | null;
  creatorUsername: string | null;
  topic_entity: string | null;
  category: string | null;
  emotion_tag: string | null;
  sentiment: string | null;
  transcript: string | null;
  key_points: string[];
  watchDurationMs: number;
  completionRate: number;
  reacted: boolean;
  followedCreator?: boolean;
  watchedAt: number;
};

export type SessionAffinityContext = {
  watchedPosts: WatchedPostEntry[];
  seenPostIds: string[];
  favoriteCreators: string[];
  topicWeights: Record<string, number>;
  keywordWeights: Record<string, number>;
  emotionWeights: Record<string, number>;
  swipesSinceNudge: number;
  lastNudgeAt: number;
  consecutiveDismissals: number;
};

const STORAGE_KEY = 'vybe_feed_session_ctx_v1';
const MAX_HISTORY = 60;
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'your', 'just', 'like', 'very',
  'really', 'about', 'after', 'before', 'into', 'than', 'then', 'when', 'what', 'which', 'they',
  'hai', 'nahi', 'bhi', 'aur', 'kya', 'mein', 'ko', 'ka', 'ki', 'ke', 'se', 'par', 'toh', 'yeh', 'woh',
]);

function emptyContext(): SessionAffinityContext {
  return {
    watchedPosts: [],
    seenPostIds: [],
    favoriteCreators: [],
    topicWeights: {},
    keywordWeights: {},
    emotionWeights: {},
    swipesSinceNudge: 0,
    lastNudgeAt: 0,
    consecutiveDismissals: 0,
  };
}

let memoryCtx: SessionAffinityContext | null = null;

function persist(ctx: SessionAffinityContext): void {
  memoryCtx = ctx;
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore storage quota errors */
  }
}

export function getSessionContext(): SessionAffinityContext {
  if (memoryCtx) return memoryCtx;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SessionAffinityContext;
        if (parsed && Array.isArray(parsed.watchedPosts)) {
          memoryCtx = parsed;
          return parsed;
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }
  memoryCtx = emptyContext();
  return memoryCtx;
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .slice(0, 24);
}

/** Records a watched post and updates live transcript, meta-tag, and favorite-creator affinities. */
export function recordWatchedPost(entry: Omit<WatchedPostEntry, 'watchedAt'>): SessionAffinityContext {
  const ctx = getSessionContext();
  const fullEntry: WatchedPostEntry = { ...entry, watchedAt: Date.now() };

  const existingIdx = ctx.watchedPosts.findIndex((p) => p.postId === entry.postId);
  if (existingIdx >= 0) {
    const prev = ctx.watchedPosts[existingIdx];
    ctx.watchedPosts[existingIdx] = {
      ...fullEntry,
      watchDurationMs: prev.watchDurationMs + entry.watchDurationMs,
      completionRate: Math.max(prev.completionRate, entry.completionRate),
      reacted: prev.reacted || entry.reacted,
      followedCreator: prev.followedCreator || entry.followedCreator,
    };
  } else {
    ctx.watchedPosts.push(fullEntry);
    if (ctx.watchedPosts.length > MAX_HISTORY) ctx.watchedPosts.shift();
    ctx.swipesSinceNudge += 1;
  }

  if (!ctx.seenPostIds.includes(entry.postId)) {
    ctx.seenPostIds.push(entry.postId);
    if (ctx.seenPostIds.length > 200) ctx.seenPostIds.shift();
  }

  const engagementWeight =
    (entry.completionRate >= 0.7 ? 2.0 : entry.completionRate >= 0.4 ? 1.0 : 0.2) +
    (entry.reacted ? 1.5 : 0) +
    (entry.followedCreator ? 2.0 : 0);

  if (entry.topic_entity) {
    const t = entry.topic_entity.trim().toLowerCase();
    ctx.topicWeights[t] = (ctx.topicWeights[t] ?? 0) + engagementWeight;
  }
  if (entry.emotion_tag) {
    ctx.emotionWeights[entry.emotion_tag] = (ctx.emotionWeights[entry.emotion_tag] ?? 0) + engagementWeight;
  }

  const metaText = [entry.topic_entity ?? '', entry.category ?? '', ...entry.key_points, entry.transcript ?? ''].join(' ');
  for (const kw of extractKeywords(metaText)) {
    ctx.keywordWeights[kw] = (ctx.keywordWeights[kw] ?? 0) + engagementWeight * 0.5;
  }

  if (
    entry.creatorId &&
    (entry.followedCreator || entry.completionRate >= 0.85 || entry.reacted) &&
    !ctx.favoriteCreators.includes(entry.creatorId)
  ) {
    ctx.favoriteCreators.push(entry.creatorId);
  }

  persist(ctx);
  return ctx;
}

export function markNudgeShown(): void {
  const ctx = getSessionContext();
  ctx.swipesSinceNudge = 0;
  ctx.lastNudgeAt = Date.now();
  persist(ctx);
}

export function markNudgeDismissed(): void {
  const ctx = getSessionContext();
  ctx.consecutiveDismissals += 1;
  ctx.swipesSinceNudge = 0;
  ctx.lastNudgeAt = Date.now();
  persist(ctx);
}

export function markNudgeAccepted(): void {
  const ctx = getSessionContext();
  ctx.consecutiveDismissals = 0;
  ctx.swipesSinceNudge = 0;
  ctx.lastNudgeAt = Date.now();
  persist(ctx);
}

export function topKeywords(limit = 5): string[] {
  const ctx = getSessionContext();
  return Object.entries(ctx.keywordWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}
