import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import type { FeedNudgePayload } from '@/lib/feed/aiNudgeEngine';

type CandidateRow = {
  id: string;
  user_id: string | null;
  creator_username: string | null;
  topic_entity: string | null;
  emotion_tag: string | null;
  sentiment: string | null;
  ai_summary: string | null;
  likes_count: number;
};

type NudgeBody = {
  seenPostIds?: string[];
  favoriteCreators?: string[];
  topicWeights?: Record<string, number>;
  keywordWeights?: Record<string, number>;
  currentPost?: {
    postId?: string;
    topic_entity?: string | null;
    sentiment?: string | null;
    completionRate?: number;
  } | null;
};

const toPreview = (row: CandidateRow): FeedNudgePayload['targetPostPreview'] => ({
  topic_entity: row.topic_entity,
  creator_username: row.creator_username,
  emotion_tag: row.emotion_tag,
  sentiment: row.sentiment,
  ai_summary: row.ai_summary,
});

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as NudgeBody | null;
    if (!body) return NextResponse.json({ nudge: null });

    const seen = new Set(Array.isArray(body.seenPostIds) ? body.seenPostIds : []);
    const favCreators = Array.isArray(body.favoriteCreators) ? body.favoriteCreators.filter(Boolean) : [];
    const current = body.currentPost;
    const admin = getSupabaseAdmin();

    // 1. Favorite Creator Drop
    if (favCreators.length > 0) {
      const { data: creatorPosts } = await admin
        .from('public_posts')
        .select('id,user_id,creator_username,topic_entity,emotion_tag,sentiment,ai_summary,likes_count')
        .in('user_id', favCreators)
        .order('created_at', { ascending: false })
        .limit(10);

      const unseen = (creatorPosts as CandidateRow[] | null)?.find((p) => !seen.has(p.id) && p.creator_username);
      if (unseen) {
        const nudge: FeedNudgePayload = {
          id: `nudge-creator-${unseen.id}`,
          triggerType: 'favorite_creator_drop',
          message: `Aapke pasandida creator @${unseen.creator_username} ki nayi video aayi hai — dekhna pasand karenge?`,
          targetPostId: unseen.id,
          targetPostPreview: toPreview(unseen),
          ctaLabel: 'Watch now',
        };
        return NextResponse.json({ nudge });
      }
    }

    // 2. Transcript / Meta-Tag Deep Match (when user watched > 70% of current post)
    const activeTopic = current?.topic_entity?.trim() || Object.entries(body.topicWeights ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
    if ((current?.completionRate ?? 0) > 0.7 && activeTopic) {
      const { data: topicPosts } = await admin
        .from('public_posts')
        .select('id,user_id,creator_username,topic_entity,emotion_tag,sentiment,ai_summary,likes_count')
        .ilike('topic_entity', activeTopic)
        .order('likes_count', { ascending: false })
        .limit(12);

      const match = (topicPosts as CandidateRow[] | null)?.find((p) => !seen.has(p.id) && p.id !== current?.postId);
      if (match) {
        const nudge: FeedNudgePayload = {
          id: `nudge-topic-${match.id}`,
          triggerType: 'transcript_deep_match',
          message: 'Oh, aap yeh dekh rahe ho? Iske baad wali toh aur bhi acchi hai!',
          targetPostId: match.id,
          targetPostPreview: toPreview(match),
          ctaLabel: 'Jump to next',
        };
        return NextResponse.json({ nudge });
      }
    }

    // 3. Counter-Take / Emotion Flip on same topic_entity
    if (current?.topic_entity && current.sentiment) {
      const opposite = current.sentiment === 'positive' ? 'negative' : current.sentiment === 'negative' ? 'positive' : null;
      if (opposite) {
        const { data: counterPosts } = await admin
          .from('public_posts')
          .select('id,user_id,creator_username,topic_entity,emotion_tag,sentiment,ai_summary,likes_count')
          .ilike('topic_entity', current.topic_entity)
          .eq('sentiment', opposite)
          .order('likes_count', { ascending: false })
          .limit(8);

        const flip = (counterPosts as CandidateRow[] | null)?.find((p) => !seen.has(p.id) && p.id !== current.postId);
        if (flip) {
          const nudge: FeedNudgePayload = {
            id: `nudge-flip-${flip.id}`,
            triggerType: 'counter_take_flip',
            message: `Is topic (#${flip.topic_entity}) par bilkul alag opinion dekhein?`,
            targetPostId: flip.id,
            targetPostPreview: toPreview(flip),
            ctaLabel: 'See counter-take',
          };
          return NextResponse.json({ nudge });
        }
      }
    }

    return NextResponse.json({ nudge: null });
  } catch {
    return NextResponse.json({ nudge: null });
  }
}
