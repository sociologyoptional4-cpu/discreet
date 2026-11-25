import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { AI_CREATOR_AGENTS } from '@/lib/server/aiCreators';
import { toParticipant } from '@/lib/server/chatApi';
import { authenticate, isUuid, json } from '@/lib/server/request';
import { safeRandomUUID } from '@/lib/uuid';

const AI_WELCOME_MESSAGES: Record<string, string> = {
  '11111111-1111-4111-8111-111111111201': 'Hey! 👋 Main Vybe Tech Scout hu — kisi gadget ya phone ka honest take chahiye?',
  '11111111-1111-4111-8111-111111111202': 'Yo! ☕ Matcha, cold brew ya late-night snacks — aaj kya try kar rahe ho?',
  '11111111-1111-4111-8111-111111111203': 'Hii ✨ Skincare, sneakers ya style drops — batao kispe vibe karein!',
  '11111111-1111-4111-8111-111111111101': 'Hey! 👋 Arjun here — bina sponsor wale tech takes. Kya chal raha hai?',
  '11111111-1111-4111-8111-111111111102': 'Hi! ☕ Meera here — coffee aur skincare par baat karein?',
  '11111111-1111-4111-8111-111111111103': 'Yo! 🎧 Kabir here — headphones ya music gear?',
  '11111111-1111-4111-8111-111111111104': 'Heyy ✨ Zoya here — kaunsa viral product test karna hai next?',
};

const USERNAME = /^[a-z0-9_]{3,24}$/;

/** Only the app's own seeded creators accept on the spot; everyone else must accept the request themselves. */
const SEEDED_CREATORS = new Set([...AI_CREATOR_AGENTS.map((agent) => agent.id), ...Object.keys(AI_WELCOME_MESSAGES)]);

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  const body = (await req.json().catch(() => null)) as { otherId?: string; username?: string; note?: string } | null;
  const note = (body?.note ?? 'Wave 👋').trim().slice(0, 200);
  const admin = getSupabaseAdmin();

  let otherId = body?.otherId?.trim() ?? '';
  if (!otherId && typeof body?.username === 'string') {
    const handle = body.username.trim().replace(/^@/, '').toLowerCase();
    if (!USERNAME.test(handle)) return json({ error: 'Creator not found' }, 404);
    const { data: target } = await admin.from('users').select('id').eq('username', handle).maybeSingle();
    if (!target) return json({ error: 'Creator not found' }, 404);
    otherId = target.id as string;
  }

  if (otherId === auth.userId) return json({ error: 'You cannot message yourself' }, 400);
  if (!isUuid(otherId)) {
    return json({ error: 'Invalid creator ID.' }, 400);
  }

  const { data: existing } = await admin
    .from('conversations')
    .select('id, status')
    .or(`and(user_a.eq.${auth.userId},user_b.eq.${otherId}),and(user_a.eq.${otherId},user_b.eq.${auth.userId})`)
    .maybeSingle();

  let conversationId = existing?.id as string | undefined;

  if (!conversationId) {
    conversationId = safeRandomUUID();
    const { error: insertErr } = await admin.from('conversations').insert({
      id: conversationId,
      user_a: auth.userId,
      user_b: otherId,
      initiator_id: auth.userId,
      request_note: note,
    });
    if (insertErr) {
      return json({ error: insertErr.message }, 400);
    }
  }

  const accepted = SEEDED_CREATORS.has(otherId) || existing?.status === 'accepted';
  if (accepted) {
    await admin
      .from('conversations')
      .update({ status: 'accepted', last_message_at: new Date().toISOString() })
      .eq('id', conversationId);
  }

  const welcome = AI_WELCOME_MESSAGES[otherId];
  if (welcome) {
    const { count } = await admin
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId);

    if (!count || count === 0) {
      const msgId = safeRandomUUID();
      await admin.from('messages').insert({
        id: msgId,
        client_msg_id: msgId,
        conversation_id: conversationId,
        sender_id: otherId,
        type: 'text',
        content: welcome,
      });
    }
  }

  const { data: person } = await admin.from('users').select('*').eq('id', otherId).maybeSingle();
  return json({ id: conversationId, conversationId, status: accepted ? 'accepted' : 'pending', participant: toParticipant(person) });
}
