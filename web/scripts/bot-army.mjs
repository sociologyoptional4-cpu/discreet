#!/usr/bin/env node
/**
 * Vybe 50-Account Synthetic Bot Army (Load, Semantic, Deep Engine & API Stress Test)
 * Commands:
 *   node --env-file=.env.local scripts/bot-army.mjs seed
 *   node --env-file=.env.local scripts/bot-army.mjs run
 *   node --env-file=.env.local scripts/bot-army.mjs sleep
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import {
  computeSemanticHashVector384,
  cosineSimilarity,
  formatPgVector,
  parsePgVector,
} from '../src/lib/brain/tasteVector.ts';
import { evolveGenomes } from '../src/lib/brain/recursiveBrain.ts';
import { HebbianVibeGraph } from '../src/lib/deepEngine/hebbianGraph.ts';
import { MarkovActionPredictor } from '../src/lib/deepEngine/markovPredictor.ts';
import { computeMicroSignalReward } from '../src/lib/deepEngine/microSignals.ts';
import { RotatingBloomFilter } from '../src/lib/deepEngine/rotatingBloom.ts';
import { rankPoolLocally } from '../src/lib/localBrain/localRanker.ts';
import { updateLocalTaste } from '../src/lib/localBrain/quantizedVector.ts';

const BASE_URL = (process.env.BOT_ARMY_BASE_URL || 'https://web-red-six-31.vercel.app').replace(/\/+$/, '');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const R2_BASE = (process.env.NEXT_PUBLIC_R2_PUBLIC_URL || 'https://pub-ae35fd27defb4719a41aa0f50c7dd2dc.r2.dev').replace(/\/+$/, '');

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error('Missing Supabase env vars. Run with: node --env-file=.env.local scripts/bot-army.mjs <cmd>');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TRIBES = [
  {
    id: 'shayari',
    avatarId: 'cyber_monk',
    topics: ['barish shayari', 'midnight poetry', 'urdu ghazal', 'monsoon mood', 'dil ki baat'],
    searchKw: 'shayari',
    captions: [
      'Bheegi raat aur ek adhoori shayari #shayari #monsoon',
      'Khamosh lafz jab dil ko chhoo jayein #poetry #ghazal',
      'Chaand aur chai ke saath midnight poetry #urdu #shayari',
      'Barish ki har boond mein teri yaad #barish #shayari',
      'Sukoon sirf alfaazon mein milta hai #midnight #poetry',
    ],
  },
  {
    id: 'gaming',
    avatarId: 'neon_bot',
    topics: ['fortnite clutch', 'apex ranked', 'valorant ace', 'fps aim', 'esports lobby'],
    searchKw: 'gaming',
    captions: [
      '1v4 clutch in final zone no heal left #gaming #fortnite',
      'Insane wingman headshots in Apex ranked #apex #gaming',
      '240Hz monitor par zero input lag #fps #esports',
      'Last second spike defuse in overtime #valorant #clutch',
      'Pro sensitivity settings for crazy flicks #aim #gaming',
    ],
  },
  {
    id: 'tech_ai',
    avatarId: 'street_artist',
    topics: ['local llm', 'webgl shaders', 'edge caching', 'rust wasm', 'ai agents'],
    searchKw: 'ai',
    captions: [
      'Running 64-dim quantized vectors in a Web Worker #tech #ai',
      'Zero server cost recursive coding agents #webdev #ai',
      'Edge cache TTFB dropped from 700ms to 30ms #cloud #tech',
      'On-device WASM face tracking at 20fps #mediapipe #ai',
      'Building self-healing apps with SSE streams #typescript #tech',
    ],
  },
  {
    id: 'fitness',
    avatarId: 'cozy_bear',
    topics: ['morning run', 'hypertrophy push', 'protein oats', 'zone 2 cardio', 'calisthenics'],
    searchKw: 'fitness',
    captions: [
      '5AM 5K run done before the city wakes up #fitness #running',
      'Progressive overload push day PR #gym #hypertrophy',
      'High protein post-workout bowl in 3 mins #nutrition #fitness',
      'Zone 2 cardio for unstoppable stamina #cardio #health',
      'Clean muscle-up progression tips #calisthenics #fitness',
    ],
  },
  {
    id: 'comedy',
    avatarId: 'neon_bot',
    topics: ['hostel life', 'desi mom', 'corporate meme', 'weekend plan', 'college canteen'],
    searchKw: 'comedy',
    captions: [
      'When Friday 5PM deployment breaks prod #comedy #corporate',
      'Desi mom vs Tupperware dabba logic #comedy #relatable',
      'Hostel mess paneer mystery solved #college #memes',
      'Me explaining my sleep schedule to my alarm #comedy #relatable',
      'Group trip plan that only exists on WhatsApp #memes #friends',
    ],
  },
];

const MEDIA_POOL = [
  {
    post_format: 'video',
    media_url: `${R2_BASE}/videos/trailer_02.mp4`,
    thumbnail_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    duration_sec: 15,
  },
  {
    post_format: 'video',
    media_url: `${R2_BASE}/videos/real_Fortnite_OyvZZGnrYmI.mp4`,
    thumbnail_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    duration_sec: 15,
  },
  {
    post_format: 'video',
    media_url: `${R2_BASE}/videos/real_PlayApex_TrnKEw_E8Hw.mp4`,
    thumbnail_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    duration_sec: 15,
  },
  {
    post_format: 'recipe_avatar',
    media_url: `${R2_BASE}/audio/arkit-test-10s.m4a`,
    thumbnail_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    duration_sec: 10,
    recipe_data: {
      version: 1,
      scenePreset: 'neon_rain',
      lighting: { ambientColor: '#1e1b4b', accentColor: '#22d3ee', intensity: 1.4, fogDensity: 0.03 },
      camera: { fov: 45, initialPos: [0, 0.2, 2.8], autoOrbitSpeed: 0.2 },
      avatarGlbUrl: `${R2_BASE}/avatars/arkit-facecap.glb`,
      motionTrackUrl: `${R2_BASE}/motion/arkit-test-10s.vmt`,
      audioUrl: `${R2_BASE}/audio/arkit-test-10s.m4a`,
    },
  },
  {
    post_format: 'living_post',
    media_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    thumbnail_url: `${R2_BASE}/living/barish-shayari-thumb.webp`,
    duration_sec: 15,
    recipe_data: {
      kind: 'living_post',
      version: 1,
      livingHtmlUrl: `${R2_BASE}/living/barish-shayari-demo.txt`,
      prompt: 'Barish + Bijli + Shayari interactive world',
    },
  },
];

function buildBotRoster() {
  const bots = [];
  for (const tribe of TRIBES) {
    for (let i = 1; i <= 10; i++) {
      const idx = String(i).padStart(2, '0');
      const username = `vybe_bot_${tribe.id}_${idx}`;
      const email = `bot.${tribe.id}.${idx}@vybe-synth.local`;
      const password = `VybeBot!2026#${tribe.id}_${idx}`;
      bots.push({ username, email, password, tribe, idx: i });
    }
  }
  return bots;
}

const latencyStats = new Map();
function recordMetric(name, ms, ok) {
  let entry = latencyStats.get(name);
  if (!entry) {
    entry = { times: [], ok: 0, fail: 0 };
    latencyStats.set(name, entry);
  }
  entry.times.push(ms);
  if (ok) entry.ok++;
  else entry.fail++;
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[idx]);
}

async function timedFetch(metricName, url, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, init);
    recordMetric(metricName, performance.now() - t0, res.ok);
    return res;
  } catch (err) {
    recordMetric(metricName, performance.now() - t0, false);
    throw err;
  }
}

async function cmdSeed() {
  const roster = buildBotRoster();
  console.log(`Seeding ${roster.length} synthetic accounts across 5 tribes...`);

  // Fetch existing synthetic users from public.users in 1 query for fast idempotency
  const existingByUsername = new Map();
  const { data: existingRows } = await admin
    .from('users')
    .select('id, username')
    .in(
      'username',
      roster.map((b) => b.username),
    );
  for (const r of existingRows ?? []) {
    existingByUsername.set(r.username, r.id);
  }

  let created = 0;
  let reused = 0;
  for (const bot of roster) {
    let userId = existingByUsername.get(bot.username);
    if (!userId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: bot.email,
        password: bot.password,
        email_confirm: true,
        user_metadata: { username: bot.username, bot_persona: bot.tribe.id },
      });
      if (error || !data?.user?.id) {
        throw new Error(`Failed to create auth user ${bot.username}: ${error?.message}`);
      }
      userId = data.user.id;
      created++;
    } else {
      reused++;
    }

    const { error: uErr } = await admin.from('users').upsert(
      {
        id: userId,
        username: bot.username,
        avatar_id: bot.tribe.avatarId,
        bio: `Synthetic ${bot.tribe.id} creator on Vybe`,
        is_synthetic: true,
        bot_status: 'sleeping',
        bot_persona: bot.tribe.id,
      },
      { onConflict: 'id' },
    );
    if (uErr) throw new Error(`Failed to upsert public.users for ${bot.username}: ${uErr.message}`);
  }

  console.log(`Seed complete: ${created} created, ${reused} reused (all sleeping).`);
}

async function cmdSleep() {
  const { data, error } = await admin
    .from('users')
    .update({ bot_status: 'sleeping' })
    .eq('is_synthetic', true)
    .select('id');
  if (error) throw new Error(`Sleep failed: ${error.message}`);
  console.log(`Put ${data?.length ?? 0} synthetic bot accounts into 'sleeping' mode.`);
}

const SESSION_CACHE_PATH = '/tmp/vybe-bot-sessions.json';

function loadCachedSessions() {
  try {
    const raw = JSON.parse(fs.readFileSync(SESSION_CACHE_PATH, 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

async function signInBot(bot, cachedMap) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const cached = cachedMap[bot.username];
  if (cached?.access_token && cached?.refresh_token && cached.expires_at > Date.now() / 1000 + 120) {
    await client.auth.setSession({
      access_token: cached.access_token,
      refresh_token: cached.refresh_token,
    });
    return {
      ...bot,
      userId: cached.user_id,
      token: cached.access_token,
      client,
    };
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    const { data, error } = await client.auth.signInWithPassword({
      email: bot.email,
      password: bot.password,
    });
    if (!error && data.session) {
      cachedMap[bot.username] = {
        user_id: data.session.user.id,
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
      };
      return {
        ...bot,
        userId: data.session.user.id,
        token: data.session.access_token,
        client,
      };
    }
    if (error?.message?.toLowerCase().includes('rate limit') && attempt < 4) {
      await new Promise((r) => setTimeout(r, attempt * 2500));
      continue;
    }
    throw new Error(`Sign-in failed for ${bot.username}: ${error?.message}`);
  }
  throw new Error(`Sign-in exhausted retries for ${bot.username}`);
}

async function cmdRun() {
  console.log(`Target API Base: ${BASE_URL}`);
  const roster = buildBotRoster();

  // Ensure seeded
  await cmdSeed();

  // Wake all 50 accounts
  await admin.from('users').update({ bot_status: 'active' }).eq('is_synthetic', true);

  // Sign in all 50 bots (paced + cached to respect Supabase Auth rate limits)
  const cachedMap = loadCachedSessions();
  const sessions = [];
  for (let i = 0; i < roster.length; i += 3) {
    const batch = roster.slice(i, i + 3);
    const signed = await Promise.all(batch.map((b) => signInBot(b, cachedMap)));
    sessions.push(...signed);
    fs.writeFileSync(SESSION_CACHE_PATH, JSON.stringify(cachedMap), 'utf8');
    if (i + 3 < roster.length) await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`Authenticated ${sessions.length}/50 synthetic bots.`);

  // HARD RULE #1: Strict Gemini Cap (<= 2 bots call /api/living/generate SSE)
  let geminiCalls = 0;
  const livingBots = new Set(['vybe_bot_shayari_01', 'vybe_bot_tech_ai_01']);
  const livingPrompts = {
    vybe_bot_shayari_01: 'Barish aur neeli bijli ke saath ek shaam ki shayari',
    vybe_bot_tech_ai_01: 'Neon matrix particles reacting to finger tap',
  };

  // Phase 2: Upload 5 posts per bot (250 posts total; idempotent deterministic UUIDs so reruns stay clean)
  let uploadedPosts = 0;
  const postTribeById = new Map();

  for (let i = 0; i < sessions.length; i += 10) {
    const batch = sessions.slice(i, i + 10);
    await Promise.all(
      batch.map(async (bot) => {
        for (let pIdx = 0; pIdx < 5; pIdx++) {
          const postId = crypto
            .createHash('sha256')
            .update(`vybe-bot-post:${bot.username}:${pIdx}`)
            .digest('hex')
            .replace(/^(.{8})(.{4})(.{3})(.{3})(.{12}).*$/, '$1-$2-4$3-8$4-$5');

          const topic = bot.tribe.topics[pIdx % bot.tribe.topics.length];
          const caption = `${bot.tribe.captions[pIdx % bot.tribe.captions.length]} (${bot.username})`;
          let mediaTemplate = MEDIA_POOL[(bot.idx + pIdx) % MEDIA_POOL.length];
          let recipeData = mediaTemplate.recipe_data ?? null;
          let postFormat = mediaTemplate.post_format;

          // Strictly <= 2 Gemini calls total across all 50 bots
          if (pIdx === 4 && livingBots.has(bot.username) && geminiCalls < 2) {
            geminiCalls++;
            const sseRes = await timedFetch(
              'POST /api/living/generate (SSE)',
              `${BASE_URL}/api/living/generate`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${bot.token}`,
                },
                body: JSON.stringify({ prompt: livingPrompts[bot.username] }),
              },
            );
            if (sseRes.ok) {
              const rawSse = await sseRes.text();
              const hasComplete = rawSse.includes('"stage":"complete"');
              if (hasComplete) {
                postFormat = 'living_post';
                recipeData = {
                  kind: 'living_post',
                  version: 1,
                  livingHtmlUrl: `${R2_BASE}/living/barish-shayari-demo.txt`,
                  prompt: livingPrompts[bot.username],
                };
              }
            }
          }

          const { error: insErr } = await bot.client.from('posts').insert({
            id: postId,
            user_id: bot.userId,
            mode: 'noface',
            post_format: postFormat,
            topic_entity: topic,
            media_url: mediaTemplate.media_url,
            thumbnail_url: mediaTemplate.thumbnail_url,
            duration_sec: mediaTemplate.duration_sec,
            is_incog: false,
            expiry_tier: '1y',
            recipe_data: recipeData,
          });
          if (insErr && insErr.code !== '23505') {
            throw new Error(`Post insert failed (${bot.username} #${pIdx}): ${insErr.message}`);
          }

          const doc = `${topic} ${bot.tribe.id} ${caption}`;
          const vec = computeSemanticHashVector384(doc);
          await admin
            .from('posts')
            .update({
              ai_summary: caption,
              category: bot.tribe.id === 'tech_ai' ? 'tech' : 'general',
              vibe_embedding: formatPgVector(vec),
            })
            .eq('id', postId);

          postTribeById.set(postId, bot.tribe.id);
          uploadedPosts++;
        }
      }),
    );
  }
  console.log(`Uploaded/synced ${uploadedPosts} posts (Gemini calls used: ${geminiCalls}/2).`);

  // Fetch global edge-cached pool once to verify /api/feed/pool + 64-dim Int8 payload
  const poolRes = await timedFetch('GET /api/feed/pool', `${BASE_URL}/api/feed/pool`);
  const poolCacheHeader = poolRes.headers.get('cache-control') || '';
  const poolJson = poolRes.ok ? await poolRes.json() : { pool: [] };
  const poolItems = Array.isArray(poolJson.pool) ? poolJson.pool : [];
  console.log(`/api/feed/pool -> ${poolItems.length} posts | Cache-Control: ${poolCacheHeader}`);

  // Phase 3: 5 parallel worker batches (10 bots per tribe)
  const coldRelevanceScores = [];
  const postRelevanceScores = [];
  let totalSwipes = 0;
  let bloomRepeats = 0;
  let creatorSpacingViolations = 0;
  let localRankTotalMs = 0;
  let localRankRuns = 0;
  let markovHits = 0;
  let markovChecks = 0;

  const globalHebbian = new HebbianVibeGraph();

  // Intentional Deep Engine unit verification during simulation: AFK + fast-skip + brake
  const afkReward = computeMicroSignalReward({
    watchMs: 15000, durationMs: 15000, activeLoops: 10, entryVelocityPxMs: 0.2,
    exitVelocityPxMs: 0, openedComments: false, heldScreen: false, afkDetected: true,
  });
  const skipReward = computeMicroSignalReward({
    watchMs: 800, durationMs: 15000, activeLoops: 0, entryVelocityPxMs: 0.3,
    exitVelocityPxMs: 1.9, openedComments: false, heldScreen: false, afkDetected: false,
  });
  const brakeReward = computeMicroSignalReward({
    watchMs: 14000, durationMs: 15000, activeLoops: 1, entryVelocityPxMs: 1.5,
    exitVelocityPxMs: 0.2, openedComments: true, heldScreen: true, afkDetected: false,
  });

  const tribeBatches = TRIBES.map((t) => sessions.filter((s) => s.tribe.id === t.id));
  await Promise.all(
    tribeBatches.map(async (tribeBots) => {
      for (const bot of tribeBots) {
        // 1. Follow 2 creators in own tribe via /api/users/[username]/follow
        const peer = tribeBots[(bot.idx) % tribeBots.length];
        if (peer && peer.username !== bot.username) {
          await timedFetch(
            'POST /api/users/[u]/follow',
            `${BASE_URL}/api/users/${encodeURIComponent(peer.username)}/follow`,
            { method: 'POST', headers: { Authorization: `Bearer ${bot.token}` } },
          );
          await timedFetch(
            'GET /api/users/[u]',
            `${BASE_URL}/api/users/${encodeURIComponent(peer.username)}`,
            { headers: { Authorization: `Bearer ${bot.token}` } },
          );
        }

        // 2. Search tribe keyword via /api/search
        await timedFetch(
          'GET /api/search',
          `${BASE_URL}/api/search?q=${encodeURIComponent(bot.tribe.searchKw)}`,
          { headers: { Authorization: `Bearer ${bot.token}` } },
        );

        // 3. Cold-start /api/feed
        const coldRes = await timedFetch('POST /api/feed', `${BASE_URL}/api/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}` },
          body: JSON.stringify({ seen_post_ids: [], session_downrank_topics: [], limit: 12 }),
        });
        const coldData = coldRes.ok ? await coldRes.json() : { posts: [], genomeId: null };
        const coldPosts = Array.isArray(coldData.posts) ? coldData.posts : [];
        const genomeId = coldData.genomeId || null;

        if (coldPosts.length > 0) {
          const matches = coldPosts.filter(
            (p) => postTribeById.get(p.id) === bot.tribe.id || (p.topic_entity && bot.tribe.topics.includes(p.topic_entity)),
          ).length;
          coldRelevanceScores.push(matches / coldPosts.length);
        }

        // 4. On-device Deep Engine + Local Brain + Batched /api/brain/signal (30 swipes/bot)
        const bloom = new RotatingBloomFilter();
        const markov = new MarkovActionPredictor();
        const hebbian = new HebbianVibeGraph();
        let localTaste = null;

        const r0 = performance.now();
        const localRanked = rankPoolLocally(poolItems, localTaste, new Set());
        localRankTotalMs += performance.now() - r0;
        localRankRuns++;

        // Verify 3-slide Creator Spacing Guard on localRanked
        for (let k = 0; k < localRanked.length; k++) {
          const c = localRanked[k].creatorId;
          if (!c) continue;
          const prev3 = localRanked.slice(Math.max(0, k - 3), k).map((x) => x.creatorId);
          if (prev3.includes(c)) creatorSpacingViolations++;
        }

        const simItems = localRanked.slice(0, 30);
        const signalBatch = [];

        for (let sIdx = 0; sIdx < simItems.length; sIdx++) {
          const item = simItems[sIdx];
          if (bloom.has(item.id)) bloomRepeats++;
          bloom.add(item.id);
          markov.record('SWIPE_NEXT');

          const isOwnTribe =
            postTribeById.get(item.id) === bot.tribe.id ||
            (item.post?.topic_entity && bot.tribe.topics.includes(item.post.topic_entity));

          if (isOwnTribe && sIdx % 3 === 0) markov.record('OPEN_COMMENTS');
          markovChecks++;
          if (markov.predictNext(0.55)) markovHits++;

          const reward = computeMicroSignalReward({
            watchMs: isOwnTribe ? 16000 : 1100,
            durationMs: 15000,
            activeLoops: isOwnTribe ? 1 : 0,
            entryVelocityPxMs: isOwnTribe ? 1.4 : 0.4,
            exitVelocityPxMs: isOwnTribe ? 0.3 : 1.7,
            openedComments: isOwnTribe && sIdx % 3 === 0,
            heldScreen: isOwnTribe,
            afkDetected: false,
          });

          const tag = item.post?.topic_entity || bot.tribe.id;
          hebbian.observe(tag, reward);
          globalHebbian.observe(tag, reward);
          if (Array.isArray(item.vibeInt8) && item.vibeInt8.length > 0) {
            localTaste = updateLocalTaste(localTaste, Int8Array.from(item.vibeInt8), reward);
          }

          signalBatch.push({
            postId: item.id,
            watchRatio: isOwnTribe ? 1.15 : 0.08,
            rewatched: isOwnTribe && sIdx % 4 === 0,
            shared: isOwnTribe && sIdx % 6 === 0,
            liked: isOwnTribe,
            fastSkip: !isOwnTribe,
          });
          totalSwipes++;

          if (signalBatch.length >= 5) {
            const batch = signalBatch.splice(0, 5);
            await timedFetch('POST /api/brain/signal', `${BASE_URL}/api/brain/signal`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}` },
              body: JSON.stringify({ genomeId, signals: batch }),
            });
          }
        }
        if (signalBatch.length > 0) {
          await timedFetch('POST /api/brain/signal', `${BASE_URL}/api/brain/signal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}` },
            body: JSON.stringify({ genomeId, signals: signalBatch }),
          });
        }

        // 5. Post-learning /api/feed check
        const warmRes = await timedFetch('POST /api/feed', `${BASE_URL}/api/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bot.token}` },
          body: JSON.stringify({ seen_post_ids: [], session_downrank_topics: [], limit: 12 }),
        });
        const warmData = warmRes.ok ? await warmRes.json() : { posts: [] };
        const warmPosts = Array.isArray(warmData.posts) ? warmData.posts : [];
        if (warmPosts.length > 0) {
          const matches = warmPosts.filter(
            (p) => postTribeById.get(p.id) === bot.tribe.id || (p.topic_entity && bot.tribe.topics.includes(p.topic_entity)),
          ).length;
          postRelevanceScores.push(matches / warmPosts.length);
        }
      }
    }),
  );

  // Trimurti Evolution verification (hit /api/brain/evolve if CRON_SECRET set, else simulate on live genomes)
  let evolveSummary = null;
  if (process.env.CRON_SECRET) {
    const evoRes = await timedFetch('POST /api/brain/evolve', `${BASE_URL}/api/brain/evolve?force=1`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    evolveSummary = evoRes.ok ? await evoRes.json() : null;
  }
  const { data: liveGenomes } = await admin
    .from('algo_genomes')
    .select('id, generation, w_vibe, w_pheromone, w_explore, decay_lambda, impressions, cumulative_reward')
    .eq('is_active', true);

  if (!evolveSummary && Array.isArray(liveGenomes) && liveGenomes.length >= 2) {
    const mapped = liveGenomes.map((g) => ({
      id: g.id,
      generation: g.generation,
      wVibe: g.w_vibe,
      wPheromone: g.w_pheromone,
      wExplore: g.w_explore,
      decayLambda: g.decay_lambda,
      impressions: g.impressions,
      cumulativeReward: g.cumulative_reward,
    }));
    evolveSummary = { simulatedLocally: true, ...evolveGenomes(mapped) };
  }

  // Semantic Intra-Tribe vs Cross-Tribe Cosine Similarity
  const { data: embRows } = await admin
    .from('posts')
    .select('id, vibe_embedding')
    .in('id', [...postTribeById.keys()])
    .limit(150);

  const vecsByTribe = new Map();
  for (const r of embRows ?? []) {
    const t = postTribeById.get(r.id);
    const v = parsePgVector(r.vibe_embedding);
    if (!t || !v) continue;
    const list = vecsByTribe.get(t) ?? [];
    list.push(v);
    vecsByTribe.set(t, list);
  }

  let intraSum = 0, intraCnt = 0, crossSum = 0, crossCnt = 0;
  const tribeKeys = [...vecsByTribe.keys()];
  for (let i = 0; i < tribeKeys.length; i++) {
    const listA = vecsByTribe.get(tribeKeys[i]);
    for (let a = 0; a < Math.min(listA.length, 10); a++) {
      for (let b = a + 1; b < Math.min(listA.length, 10); b++) {
        intraSum += cosineSimilarity(listA[a], listA[b]);
        intraCnt++;
      }
      if (i + 1 < tribeKeys.length) {
        const listB = vecsByTribe.get(tribeKeys[i + 1]);
        for (let b = 0; b < Math.min(listB.length, 5); b++) {
          crossSum += cosineSimilarity(listA[a], listB[b]);
          crossCnt++;
        }
      }
    }
  }

  const avgCold = coldRelevanceScores.length
    ? (coldRelevanceScores.reduce((a, b) => a + b, 0) / coldRelevanceScores.length) * 100
    : 0;
  const avgWarm = postRelevanceScores.length
    ? (postRelevanceScores.reduce((a, b) => a + b, 0) / postRelevanceScores.length) * 100
    : 0;

  // Phase 5: Always sleep all 50 accounts at the end
  await cmdSleep();

  // Structured Report
  console.log('\n================ VYBE 50-BOT AUDIT REPORT ================');
  console.log(`1. Gemini Quota Check: ${geminiCalls} / 2 max calls used`);
  console.log(`2. Total Swipes Simulated: ${totalSwipes} | Total Bot Posts: ${uploadedPosts}`);
  console.log('3. API Latency & Reliability:');
  for (const [name, s] of latencyStats.entries()) {
    console.log(
      `   - ${name}: ok=${s.ok} fail=${s.fail} | p50=${percentile(s.times, 50)}ms p95=${percentile(s.times, 95)}ms`,
    );
  }
  console.log('4. Semantic & Personalization Accuracy:');
  console.log(`   - Intra-Tribe Cosine Similarity: ${(intraCnt ? intraSum / intraCnt : 0).toFixed(4)}`);
  console.log(`   - Cross-Tribe Cosine Similarity: ${(crossCnt ? crossSum / crossCnt : 0).toFixed(4)}`);
  console.log(`   - Cold-Start Relevance: ${avgCold.toFixed(1)}% -> Post-Learning: ${avgWarm.toFixed(1)}% (Lift: ${(avgWarm - avgCold).toFixed(1)}%)`);
  console.log(`   - Bloom Repeats: ${bloomRepeats} | Creator Spacing Violations: ${creatorSpacingViolations}`);
  console.log('5. Deep Engine & Trimurti Metrics:');
  console.log(`   - Avg Local WebWorker/Ranker Time: ${(localRankTotalMs / Math.max(1, localRankRuns)).toFixed(2)}ms`);
  console.log(`   - MicroSignals Check: AFK=${afkReward}, FastSkip=${skipReward}, Brake=${brakeReward}`);
  console.log(`   - Markov Prediction Rate (>=0.55): ${markovHits}/${markovChecks}`);
  console.log(`   - Hebbian Nodes Learned: ${globalHebbian.getNodeCount()}`);
  console.log(`   - Active Genomes (${liveGenomes?.length ?? 0}):`, JSON.stringify(liveGenomes?.slice(0, 2)));
  console.log(`   - Evolution Check:`, JSON.stringify(evolveSummary));
  console.log('==========================================================\n');
}

const cmd = process.argv[2];
if (cmd === 'seed') await cmdSeed();
else if (cmd === 'run') await cmdRun();
else if (cmd === 'sleep') await cmdSleep();
else {
  console.error('Usage: node --env-file=.env.local scripts/bot-army.mjs <seed|run|sleep>');
  process.exit(1);
}
