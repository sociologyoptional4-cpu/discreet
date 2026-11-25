import { authenticate, isUuid, json } from '@/lib/server/request';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { embedPostById } from '@/lib/server/vibeEmbedding';

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;

  const body = (await request.json().catch(() => null)) as { postId?: unknown } | null;
  if (!isUuid(body?.postId)) return json({ error: 'Invalid post ID.' }, 400);

  const { data: post } = await getSupabaseAdmin()
    .from('posts')
    .select('id, user_id')
    .eq('id', body.postId)
    .maybeSingle();

  if (!post || post.user_id !== auth.userId) {
    return json({ error: 'Post not found.' }, 404);
  }

  const ok = await embedPostById(body.postId);
  return json({ ok }, ok ? 200 : 503);
}
