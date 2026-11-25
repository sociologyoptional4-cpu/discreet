import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { authenticate, isUuid, json } from '@/lib/server/request';
import { fetchPostPreviews } from '@/lib/server/chatApi';
import { encodePostShare, parsePostShare } from '@/lib/chat/postShare';
import type { ApiChatMessage } from '@/types/chat';

const PAGE = 50;
const BODY_MAX = 2000;
const READABLE = new Set(['text', 'post_share', 'story_reply']);
const COLUMNS = 'id, conversation_id, sender_id, type, content, status, created_at';

type Row = { id: string; conversation_id: string; sender_id: string; type: ApiChatMessage['type']; content: string | null; status?: string; created_at: string };
type Context = { params: Promise<{ conversationId: string }> };

const toMessage = (row: Row, previews: Awaited<ReturnType<typeof fetchPostPreviews>>): ApiChatMessage => {
  const share = row.type === 'post_share' ? parsePostShare(row.content) : null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    type: row.type,
    body: share ? share.note ?? null : row.content,
    sharedPostId: share?.postId ?? null,
    sharedPost: share ? previews.get(share.postId) ?? null : null,
    createdAt: row.created_at,
  };
};

/** Row-level security only lets participants see a conversation, so "not found" here means "not yours". */
async function isParticipant(client: SupabaseClient, conversationId: string): Promise<boolean> {
  const { data } = await client.from('conversations').select('id').eq('id', conversationId).maybeSingle();
  return data !== null;
}

/** The latest 50 messages, oldest first. Unread incoming text is marked read through the same receipt RPC the thread uses. */
export async function GET(request: NextRequest, context: Context) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) return json({ error: 'Invalid chat.' }, 400);
  if (!(await isParticipant(auth.client, conversationId))) return json({ error: 'This chat is not yours.' }, 403);

  const { data, error } = await auth.client.from('messages').select(COLUMNS).eq('conversation_id', conversationId)
    .order('created_at', { ascending: false }).limit(PAGE);
  if (error) return json({ error: 'Could not load messages.' }, 503);

  const rows = ((data ?? []) as Row[]).reverse().filter((row) => row.type !== 'system_alert');
  const previews = await fetchPostPreviews(rows.flatMap((row) => (row.type === 'post_share' ? [parsePostShare(row.content)?.postId ?? ''] : [])).filter(Boolean));

  await Promise.allSettled(
    rows.filter((row) => row.sender_id !== auth.userId && READABLE.has(row.type) && row.status !== 'opened')
      .map((row) => auth.client.rpc('mark_message', { p_message_id: row.id, p_status: 'opened' })),
  );
  return json({ messages: rows.map((row) => toMessage(row, previews)) });
}

/** Sends text, a shared post, or both. The database still refuses anything until the request is accepted. */
export async function POST(request: NextRequest, context: Context) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { conversationId } = await context.params;
  if (!isUuid(conversationId)) return json({ error: 'Invalid chat.' }, 400);

  const input = (await request.json().catch(() => null)) as { body?: unknown; sharedPostId?: unknown } | null;
  const body = typeof input?.body === 'string' ? input.body.trim() : '';
  const sharedPostId = input?.sharedPostId;
  if (sharedPostId !== undefined && !isUuid(sharedPostId)) return json({ error: 'Invalid post.' }, 400);
  if (!body && !sharedPostId) return json({ error: 'Write a message or pick a post to share.' }, 400);
  if (body.length > BODY_MAX) return json({ error: 'That message is too long.' }, 400);

  if (!(await isParticipant(auth.client, conversationId))) return json({ error: 'This chat is not yours.' }, 403);

  const previews = await fetchPostPreviews(typeof sharedPostId === 'string' ? [sharedPostId] : []);
  if (typeof sharedPostId === 'string' && !previews.has(sharedPostId)) return json({ error: 'That post is not available.' }, 404);

  const id = crypto.randomUUID();
  const type = typeof sharedPostId === 'string' ? 'post_share' : 'text';
  const content = typeof sharedPostId === 'string' ? encodePostShare(sharedPostId, body) : body;
  const { data, error } = await auth.client.from('messages')
    .insert({ id, client_msg_id: id, conversation_id: conversationId, sender_id: auth.userId, type, content })
    .select(COLUMNS).single();
  if (error || !data) {
    const waiting = /not accepted/i.test(error?.message ?? '');
    return json({ error: waiting ? 'This chat request has not been accepted yet.' : 'Could not send your message.' }, waiting ? 409 : 400);
  }
  return json({ message: toMessage(data as Row, previews) }, 201);
}
