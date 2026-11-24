import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmotionTag } from '@/lib/emotions';
import type { AvatarId } from '@/types/avatar';
import type { Category, Sentiment } from '@/types/social';

export type AiCreatorProfile = {
  id: string;
  email: string;
  username: string;
  avatar_id: AvatarId;
  bio: string;
  followers_count: number;
  categories: Category[];
};

export const AI_CREATOR_AGENTS: readonly AiCreatorProfile[] = [
  {
    id: '11111111-1111-4111-8111-111111111201',
    email: 'vybe.scout.tech@ai.vybe.local',
    username: 'vybe_scout_tech',
    avatar_id: 'cyber_monk',
    bio: 'AI Tech Scout • Daily gadget, audio & smartphone reviews.',
    followers_count: 3420,
    categories: ['tech', 'general'],
  },
  {
    id: '11111111-1111-4111-8111-111111111202',
    email: 'vybe.scout.food@ai.vybe.local',
    username: 'vybe_scout_food',
    avatar_id: 'cozy_bear',
    bio: 'AI Food & Cafe Scout • Finding trending snacks, matcha & street food.',
    followers_count: 2890,
    categories: ['food'],
  },
  {
    id: '11111111-1111-4111-8111-111111111203',
    email: 'vybe.scout.style@ai.vybe.local',
    username: 'vybe_scout_style',
    avatar_id: 'street_artist',
    bio: 'AI Beauty & Lifestyle Scout • Testing viral skincare, sneakers & gear.',
    followers_count: 4110,
    categories: ['beauty', 'lifestyle'],
  },
];

export const VERIFIED_DEMO_VIDEOS: readonly string[] = [
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
  'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4',
  'https://media.w3.org/2010/05/sintel/trailer.mp4',
  'https://media.w3.org/2010/05/bunny/trailer.mp4',
  'https://media.w3.org/2010/05/video/movie_300.mp4',
  'https://vjs.zencdn.net/v/oceans.mp4',
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://www.w3schools.com/tags/movie.mp4',
  'https://download.samplelib.com/mp4/sample-5s.mp4',
  'https://download.samplelib.com/mp4/sample-10s.mp4',
  'https://download.samplelib.com/mp4/sample-15s.mp4',
  'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/720/Big_Buck_Bunny_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/jellyfish/mp4/h264/720/Jellyfish_720_10s_1MB.mp4',
  'https://test-videos.co.uk/vids/sintel/mp4/h264/720/Sintel_720_10s_1MB.mp4',
];

type CuratedSeed = {
  creatorIndex: number;
  topic_entity: string;
  category: Category;
  sentiment: Sentiment;
  emotion_tag: EmotionTag;
  transcript: string;
  ai_summary: string;
  key_points: string[];
  likes_count: number;
};

export const INITIAL_DEMO_CATALOG: readonly CuratedSeed[] = [
  {
    creatorIndex: 0,
    topic_entity: 'iphone 16 pro',
    category: 'tech',
    sentiment: 'positive',
    emotion_tag: 'joy',
    transcript: 'Camera control button aur 4K 120fps slow-mo next level hai. Battery easily full day nikal deti hai.',
    ai_summary: 'Camera control and 4K 120fps video feel smooth with solid all-day battery.',
    key_points: ['4K 120fps video', 'All-day battery', 'Crisp display'],
    likes_count: 1420,
  },
  {
    creatorIndex: 1,
    topic_entity: 'matcha latte',
    category: 'food',
    sentiment: 'positive',
    emotion_tag: 'chill',
    transcript: 'Oat milk ke saath ceremonial matcha try kiya, zero bitterness aur super smooth afternoon energy.',
    ai_summary: 'Ceremonial matcha with oat milk delivers smooth, jitter-free energy.',
    key_points: ['Zero bitterness', 'Creamy oat milk', 'Clean energy'],
    likes_count: 890,
  },
  {
    creatorIndex: 2,
    topic_entity: 'dyson airwrap',
    category: 'beauty',
    sentiment: 'negative',
    emotion_tag: 'angry',
    transcript: 'Hype bahut hai par humid weather mein curls 2 ghante mein flat ho jaate hain, price ke hisaab se tough sell.',
    ai_summary: 'Curls drop fast in humidity, making the premium price hard to justify.',
    key_points: ['Drops in humidity', 'High price', 'Fast drying'],
    likes_count: 740,
  },
  {
    creatorIndex: 0,
    topic_entity: 'sony wh-1000xm5',
    category: 'tech',
    sentiment: 'positive',
    emotion_tag: 'surprised',
    transcript: 'Flight aur metro mein ANC bilkul silence kar deta hai, aur mic quality calls par kaafi clear hai.',
    ai_summary: 'Top-tier noise cancellation for commutes with noticeably clearer call mics.',
    key_points: ['Elite ANC', 'Clear call mic', 'Light headband'],
    likes_count: 1180,
  },
  {
    creatorIndex: 1,
    topic_entity: 'buldak ramen',
    category: 'food',
    sentiment: 'positive',
    emotion_tag: 'surprised',
    transcript: 'Carbonara flavour with a slice of cheddar cheese is dangerously good, spicy kick bilkul balanced lagta hai.',
    ai_summary: 'Adding cheddar balances the heat in Carbonara Buldak ramen.',
    key_points: ['Creamy heat', 'Chewy noodles', 'Late-night hit'],
    likes_count: 2340,
  },
  {
    creatorIndex: 2,
    topic_entity: 'cerave cleanser',
    category: 'beauty',
    sentiment: 'positive',
    emotion_tag: 'chill',
    transcript: 'No fragrance, zero tightness after washing. Daily barrier-safe routine ke liye best budget pick.',
    ai_summary: 'Gentle, fragrance-free cleanser that cleans without stripping the skin barrier.',
    key_points: ['Fragrance-free', 'Barrier safe', 'Budget staple'],
    likes_count: 670,
  },
  {
    creatorIndex: 0,
    topic_entity: 'nothing ear (a)',
    category: 'tech',
    sentiment: 'positive',
    emotion_tag: 'joy',
    transcript: 'Yellow transparent case looks iconic aur bass punchy hai. Under 8k mein easiest recommendation.',
    ai_summary: 'Standout transparent design and punchy bass make it a great mid-range pick.',
    key_points: ['Iconic design', 'Punchy bass', 'Great value'],
    likes_count: 950,
  },
  {
    creatorIndex: 1,
    topic_entity: 'blue tokai cold brew',
    category: 'food',
    sentiment: 'positive',
    emotion_tag: 'joy',
    transcript: 'Attikan Estate cold brew bags ghar par 14 hours steep kiye — chocolatey notes aur zero acidity.',
    ai_summary: 'Overnight home-steeped cold brew tastes smooth with rich chocolate notes.',
    key_points: ['Low acidity', 'Chocolate notes', 'Easy home steep'],
    likes_count: 510,
  },
  {
    creatorIndex: 2,
    topic_entity: 'nike pegasus 41',
    category: 'lifestyle',
    sentiment: 'positive',
    emotion_tag: 'joy',
    transcript: 'ReactX foam noticeably bouncier hai morning 5K runs ke liye, upper bhi kaafi breathable hai.',
    ai_summary: 'ReactX cushioning adds lively bounce for daily 5K runs with breathable mesh.',
    key_points: ['Bouncy ReactX', 'Breathable upper', 'Daily trainer'],
    likes_count: 820,
  },
  {
    creatorIndex: 0,
    topic_entity: 'kindle paperwhite',
    category: 'tech',
    sentiment: 'positive',
    emotion_tag: 'chill',
    transcript: 'Warm light at night aur 6-week battery life ne phone scrolling half kar di hai.',
    ai_summary: 'Warm front light and multi-week battery make late-night reading effortless.',
    key_points: ['Warm night light', '6-week battery', 'Zero glare'],
    likes_count: 1105,
  },
  {
    creatorIndex: 1,
    topic_entity: 'dairy milk silk',
    category: 'food',
    sentiment: 'neutral',
    emotion_tag: 'chill',
    transcript: 'Texture super creamy hai par 2 pieces ke baad kaafi sweet lagta hai. Dark version better balance deta hai.',
    ai_summary: 'Ultra creamy texture, though very sweet after a couple of pieces.',
    key_points: ['Velvety melt', 'Very sweet', 'Classic treat'],
    likes_count: 430,
  },
  {
    creatorIndex: 2,
    topic_entity: 'laneige lip mask',
    category: 'beauty',
    sentiment: 'positive',
    emotion_tag: 'joy',
    transcript: 'Raat ko lagao aur subah tak lips soft rehte hain. Ek jar easily 6 mahine chal jaata hai.',
    ai_summary: 'Overnight hydration lasts till morning and one jar lasts for months.',
    key_points: ['Overnight moisture', 'Long-lasting jar', 'Berry scent'],
    likes_count: 1290,
  },
];

export async function ensureAiCreatorUsers(admin: SupabaseClient): Promise<void> {
  for (const agent of AI_CREATOR_AGENTS) {
    const { data: existing } = await admin.from('users').select('id').eq('id', agent.id).maybeSingle();
    if (!existing) {
      await admin.auth.admin
        .createUser({
          id: agent.id,
          email: agent.email,
          email_confirm: true,
          user_metadata: { ai_creator: true, username: agent.username },
        })
        .catch(() => {});

      await admin
        .from('users')
        .upsert(
          {
            id: agent.id,
            username: agent.username,
            avatar_id: agent.avatar_id,
            bio: agent.bio,
            followers_count: agent.followers_count,
          },
          { onConflict: 'id' }
        );
    }
  }
}

export async function seedInitialDemoVideos(admin: SupabaseClient, minCount = 12): Promise<number> {
  await ensureAiCreatorUsers(admin);

  const now = Date.now();
  const { data: activePosts } = await admin
    .from('posts')
    .select('id')
    .gt('expires_at', new Date(now).toISOString())
    .limit(minCount);

  if ((activePosts?.length ?? 0) >= minCount) {
    return activePosts?.length ?? 0;
  }

  let inserted = 0;
  for (let i = 0; i < INITIAL_DEMO_CATALOG.length; i += 1) {
    const seed = INITIAL_DEMO_CATALOG[i];
    const agent = AI_CREATOR_AGENTS[seed.creatorIndex % AI_CREATOR_AGENTS.length];
    const videoUrl = VERIFIED_DEMO_VIDEOS[i % VERIFIED_DEMO_VIDEOS.length];
    const postId = `44444444-4444-4444-8444-4444444444${String(i + 1).padStart(2, '0')}`;
    const createdAt = new Date(now - (i + 1) * 3_600_000).toISOString();
    const expiresAt = new Date(now + 30 * 86_400_000).toISOString();

    const { error } = await admin.from('posts').upsert(
      {
        id: postId,
        user_id: agent.id,
        mode: 'blur',
        avatar_id: agent.avatar_id,
        media_url: videoUrl,
        duration_sec: 10,
        is_incog: false,
        transcript: seed.transcript,
        topic_entity: seed.topic_entity,
        category: seed.category,
        sentiment: seed.sentiment,
        emotion_tag: seed.emotion_tag,
        key_points: seed.key_points,
        ai_summary: seed.ai_summary,
        likes_count: seed.likes_count,
        expiry_tier: '1w',
        expires_at: expiresAt,
        created_at: createdAt,
      },
      { onConflict: 'id' }
    );

    if (!error) inserted += 1;
  }

  return inserted;
}

async function generateFreshReview(agent: AiCreatorProfile): Promise<{
  topic_entity: string;
  category: Category;
  sentiment: Sentiment;
  emotion_tag: EmotionTag;
  transcript: string;
  ai_summary: string;
  key_points: string[];
}> {
  const apiKey = process.env.JARVISLABS_API_KEY;
  const baseUrl = (process.env.JARVISLABS_BASE_URL || 'https://models.jarvislabs.net/v1').replace(/\/+$/, '');
  const model = process.env.JARVISLABS_MODEL || 'deepseek-v4.1-flash-1017';

  if (apiKey) {
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.9,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `You are ${agent.username} (${agent.bio}). Invent ONE fresh, realistic 15-second Hinglish product review in categories: ${agent.categories.join(', ')}. Return valid JSON with keys: topic_entity (lowercase string), category (${agent.categories[0]}), sentiment (positive|negative|neutral), emotion_tag (joy|angry|surprised|sad|chill), transcript (1-2 natural Hinglish sentences), ai_summary (1 concise English sentence), key_points (array of 3 short strings).`,
            },
            {
              role: 'user',
              content: `Create a brand new review for ${new Date().toISOString()}.`,
            },
          ],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (res.ok) {
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const raw = json.choices?.[0]?.message?.content;
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (typeof parsed.topic_entity === 'string' && typeof parsed.transcript === 'string') {
            return {
              topic_entity: parsed.topic_entity.toLowerCase().slice(0, 60),
              category: agent.categories[0],
              sentiment:
                parsed.sentiment === 'negative' || parsed.sentiment === 'neutral' ? parsed.sentiment : 'positive',
              emotion_tag:
                parsed.emotion_tag === 'angry' ||
                parsed.emotion_tag === 'surprised' ||
                parsed.emotion_tag === 'sad' ||
                parsed.emotion_tag === 'chill'
                  ? parsed.emotion_tag
                  : 'joy',
              transcript: parsed.transcript.slice(0, 280),
              ai_summary:
                typeof parsed.ai_summary === 'string'
                  ? parsed.ai_summary.slice(0, 180)
                  : parsed.transcript.slice(0, 180),
              key_points: Array.isArray(parsed.key_points)
                ? parsed.key_points.filter((x): x is string => typeof x === 'string').slice(0, 3)
                : ['Honest take', 'Daily test', 'Quick verdict'],
            };
          }
        }
      }
    } catch {
      // fall through to curated fallback
    }
  }

  const fallback = INITIAL_DEMO_CATALOG[Math.floor(Math.random() * INITIAL_DEMO_CATALOG.length)];
  return {
    topic_entity: fallback.topic_entity,
    category: fallback.category,
    sentiment: fallback.sentiment,
    emotion_tag: fallback.emotion_tag,
    transcript: fallback.transcript,
    ai_summary: fallback.ai_summary,
    key_points: fallback.key_points,
  };
}

export async function runAiCreatorCycle(admin: SupabaseClient): Promise<{
  postId: string;
  creator: string;
  topic: string;
}> {
  await ensureAiCreatorUsers(admin);

  const agent = AI_CREATOR_AGENTS[Math.floor(Math.random() * AI_CREATOR_AGENTS.length)];
  const review = await generateFreshReview(agent);
  const videoUrl = VERIFIED_DEMO_VIDEOS[Math.floor(Math.random() * VERIFIED_DEMO_VIDEOS.length)];
  const now = Date.now();

  const { data, error } = await admin
    .from('posts')
    .insert({
      user_id: agent.id,
      mode: 'blur',
      avatar_id: agent.avatar_id,
      media_url: videoUrl,
      duration_sec: 10,
      is_incog: false,
      transcript: review.transcript,
      topic_entity: review.topic_entity,
      category: review.category,
      sentiment: review.sentiment,
      emotion_tag: review.emotion_tag,
      key_points: review.key_points,
      ai_summary: review.ai_summary,
      likes_count: Math.floor(40 + Math.random() * 260),
      expiry_tier: '1w',
      expires_at: new Date(now + 30 * 86_400_000).toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(error?.message || 'Failed to publish AI creator post');
  }

  return {
    postId: data.id,
    creator: agent.username,
    topic: review.topic_entity,
  };
}
