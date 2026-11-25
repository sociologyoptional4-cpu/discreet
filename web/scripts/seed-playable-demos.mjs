// Seeds the four demo playable-scene posts. Run AFTER supabase/playable_scenes_module1.sql:
//   node --env-file=.env.local scripts/seed-playable-demos.mjs   (from web/)
// Idempotent: a preset that already has a demo post is skipped.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const presets = JSON.parse(readFileSync(new URL('../src/lib/playable/presets.json', import.meta.url), 'utf8'));
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_R2_PUBLIC_URL } = process.env;
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !NEXT_PUBLIC_R2_PUBLIC_URL) throw new Error('Run with --env-file=.env.local from web/.');

const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const base = NEXT_PUBLIC_R2_PUBLIC_URL.replace(/\/$/, '');
const CREATOR = '11111111-1111-4111-8111-111111111201';

const probe = await db.from('public_posts').select('post_format').limit(1);
if (probe.error) throw new Error('public_posts has no post_format yet. Run supabase/playable_scenes_module1.sql first.');

for (const [name, recipe] of Object.entries(presets)) {
  const mediaUrl = `${base}/playable/${name}`;
  const exists = await db.from('posts').select('id', { head: true, count: 'exact' }).eq('media_url', mediaUrl);
  if (exists.count) { console.log('skip', name); continue; }
  const { error } = await db.from('posts').insert({
    user_id: CREATOR,
    mode: 'noface',
    media_url: mediaUrl,
    thumbnail_url: `${base}/playable/thumbs/${name}.webp`,
    post_format: name === 'pastel_clouds' ? 'recipe_shayari' : 'recipe_avatar',
    recipe_data: recipe,
    topic_entity: 'Playable',
    expiry_tier: 'never',
    is_incog: false,
    ai_summary: recipe.textOverlay.lines[0],
  });
  console.log(error ? `FAILED ${name}: ${error.message}` : `seeded ${name}`);
}
