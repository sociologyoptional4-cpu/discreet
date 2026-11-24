import { flushOutbox, storeOutgoing } from '@/lib/offlineQueue';
import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';
import { safeRandomUUID } from '@/lib/uuid';

export const STORY_REACTIONS = ['🔥', '😂', '❤️', '😮'] as const;
export type StoryReaction = (typeof STORY_REACTIONS)[number];

/** What happened to a reaction. Only `sent` reached the creator's chat straight away. */
export type ReactionResult = 'sent' | 'queued' | 'requested' | 'waiting' | 'own-story';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends a reaction to a story as a `story_reply` message in the viewer's conversation with the creator.
 * With no conversation yet, a message request is started instead (the reaction is its note), because the database
 * allows no messages until a request is accepted. A request that is still waiting cannot carry messages either.
 */
export async function sendStoryReaction(creatorId: string, storyId: string, reaction: string): Promise<ReactionResult> {
  if (!UUID.test(creatorId) || !UUID.test(storyId)) throw new Error('Invalid story.');
  const content = reaction.trim();
  if (!content || content.length > 500) throw new Error('Story replies can be 1–500 characters.');
  const session = await ensureSession();
  const viewerId = session.user.id;
  if (viewerId === creatorId) return 'own-story';

  const {data: id,error} = await supabase.rpc('get_story_conversation', {p_story_id:storyId});
  if (error || typeof id !== 'string') throw new Error('Could not start this conversation.');
  const {data: conversation,error: lookupError} = await supabase.from('conversations').select('status,initiator_id').eq('id',id).single();
  if (lookupError || !conversation) throw new Error('Could not open this conversation.');
  if (conversation.status !== 'accepted') return conversation.initiator_id === viewerId ? 'requested' : 'waiting';
  const clientId = safeRandomUUID();
  await storeOutgoing({row:{
    id:clientId, client_msg_id:clientId, conversation_id:id, sender_id:viewerId, type:'story_reply', content,
    story_id:storyId, snap_mode:null, avatar_id:null, media_url:null, motion_url:null, viewed_at:null,
    expires_at:null, created_at:new Date().toISOString(),
  }, attempts:0, retryAt:0});
  await flushOutbox(viewerId);
  const {data} = await supabase.from('messages').select('id').eq('id',clientId).maybeSingle();
  return data ? 'sent' : 'queued';
}

export const REACTION_MESSAGE: Record<ReactionResult, string> = {
  sent: 'Sent',
  queued: 'Queued for delivery',
  requested: 'Message request sent',
  waiting: 'Waiting for the message request to be accepted',
  'own-story': 'This is your story',
};
