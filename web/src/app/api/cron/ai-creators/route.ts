import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { runAiCreatorCycle, seedInitialDemoVideos } from '@/lib/server/aiCreators';
import { json } from '@/lib/server/request';

export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const auth = req.headers.get('authorization');
  return auth === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const admin = getSupabaseAdmin();
  const seededCount = await seedInitialDemoVideos(admin, 12);
  const published = await runAiCreatorCycle(admin);

  return json({
    ok: true,
    seededCount,
    published,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
