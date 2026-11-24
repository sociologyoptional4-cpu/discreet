import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { authenticate } from '@/lib/server/request';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { xp?: unknown; token?: unknown } | null;
  const authHeader = req.headers.get('authorization');
  const effectiveReq =
    !authHeader && typeof body?.token === 'string'
      ? new Request(req.url, { method: 'POST', headers: { Authorization: `Bearer ${body.token}` } })
      : req;

  const auth = await authenticate(effectiveReq);
  if (auth instanceof Response) return auth;

  const xp = typeof body?.xp === 'number' && Number.isFinite(body.xp) ? Math.round(body.xp) : 0;
  if (xp <= 0 || xp > 500) {
    return NextResponse.json({ error: 'Invalid XP amount.' }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('increment_user_vibe_xp', {
    p_user_id: auth.userId,
    p_xp: xp,
  });

  if (error) {
    return NextResponse.json({ error: 'Could not update Vibe XP.' }, { status: 503 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({
    vibe_xp: row?.vibe_xp ?? xp,
    vibe_level: row?.vibe_level ?? 1,
    daily_watch_streak: row?.daily_watch_streak ?? 1,
  });
}
