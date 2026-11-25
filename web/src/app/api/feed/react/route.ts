import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { authenticate, isUuid, rateLimit } from '@/lib/server/request';

const ALLOWED_EMOJIS = new Set(['heart', 'love', 'laugh', 'fire', 'mindblown']);

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const limited = await rateLimit(auth.userId, 'react');
  if (limited) return limited;

  const body = (await req.json().catch(() => null)) as { postId?: unknown; emoji?: unknown } | null;
  if (!body || !isUuid(body.postId) || typeof body.emoji !== 'string' || !ALLOWED_EMOJIS.has(body.emoji)) {
    return NextResponse.json({ error: 'Invalid reaction payload.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('increment_post_reaction', {
    p_post_id: body.postId,
    p_emoji: body.emoji,
  });

  if (error) {
    return NextResponse.json({ error: 'Could not save reaction.' }, { status: 503 });
  }

  return NextResponse.json({ postId: body.postId, reaction_counts: data ?? {} });
}
