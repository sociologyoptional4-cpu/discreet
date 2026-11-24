import { findConversationWith, requestConversation } from '@/lib/chatData';
import { ensureSession } from '@/lib/session';
import { supabase } from '@/lib/supabase';

export const STORY_REACTIONS = ['🔥', '😂', '❤️', '😮'] as const;
export type StoryReaction = (typeof STORY_REACTIONS)[number];

/** What happened to a reaction. Only `sent` reached the creator's chat straight away. */
export type ReactionResult = 'sent' | 'requested' | 'waiting' | 'own-story';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sends a reaction to a story as a `story_reply` message in the viewer's conversation with the creator.
 * With no conversation yet, a message request is started instead (the reaction is its note), because the database
 * allows no messages until a request is accepted. A request that is still waiting cannot carry messages either.
 */
export async function sendStoryReaction(creatorId: string, storyId: string, reaction: StoryReaction): Promise<ReactionResult> {
  if (!UUID.test(creatorId) || !UUID.test(storyId)) throw new Error('Invalid story.');
  const session = await ensureSession();
  const viewerId = session.user.id;
  if (viewerId === creatorId) return 'own-story';

  const conversation = await findConversationWith(viewerId, creatorId);
  if (!conversation) {
    await requestConversation(viewerId, creatorId, `Reacted ${reaction} to your story`);
    return 'requested';
  }

  if (conversation.status !== 'accepted') return 'waiting';
  const { error } = await supabase.from('messages').insert({
    id: crypto.randomUUID(), conversation_id: conversation.id, sender_id: viewerId, type: 'story_reply', content: reaction, story_id: storyId,
  });
  if (error) throw new Error('Could not send your reaction.');
  return 'sent';
}

export const REACTION_MESSAGE: Record<ReactionResult, string> = {
  sent: 'Sent',
  requested: 'Message request sent',
  waiting: 'Waiting for the message request to be accepted',
  'own-story': 'This is your story',
};
