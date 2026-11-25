import { NextRequest } from 'next/server';
import { fetchPostPreviews } from '@/lib/server/chatApi';
import { authenticate, isUuid, json } from '@/lib/server/request';

/** Thumbnail, caption and format of one live public post, for cards in chat. Incog and expired posts return 404. */
export async function GET(request: NextRequest, context: { params: Promise<{ postId: string }> }) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { postId } = await context.params;
  if (!isUuid(postId)) return json({ error: 'Invalid post.' }, 400);
  const preview = (await fetchPostPreviews([postId])).get(postId);
  return preview ? json({ post: preview }) : json({ error: 'Post not found' }, 404);
}
