import { supabase } from './supabase';
import { ApiError, toApiError } from './errors';
import type {
  City, ConversationRow, MessageRow, MyProfile, NearbyRow, OtherProfile, Photo, Prompt, RequestItem,
} from './types';

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch {
    throw new ApiError('offline', true); // fetch itself failed
  }
  if (res.error) throw toApiError(res.error);
  return res.data as T;
}

export const api = {
  cities: async (): Promise<City[]> => {
    const { data, error } = await supabase.from('cities').select('id,name').order('name');
    if (error) throw toApiError(error);
    return data ?? [];
  },
  myProfile: () => rpc<MyProfile | null>('get_my_profile'),
  createProfile: (a: { name: string; dob: string; cityId: number; bio: string; tags: string[] }) =>
    rpc<void>('create_profile', { p_name: a.name, p_dob: a.dob, p_city_id: a.cityId, p_bio: a.bio, p_tags: a.tags }),
  updateProfile: (a: { name: string; bio: string; cityId: number; tags: string[]; prompts: Prompt[]; discoverable: boolean }) =>
    rpc<void>('update_profile', {
      p_name: a.name, p_bio: a.bio, p_city_id: a.cityId, p_tags: a.tags, p_prompts: a.prompts, p_discoverable: a.discoverable,
    }),
  setTonight: (text: string | null, area?: string) => rpc<void>('set_tonight', { p_text: text, p_area: area ?? null }),
  setPhotos: (photos: Photo[]) => rpc<void>('set_photos', { p_photos: photos }),

  listNearby: (a: { cityId?: number; tonightOnly?: boolean; after?: { createdAt: string; id: string } }) =>
    rpc<NearbyRow[]>('list_nearby', {
      p_city_id: a.cityId ?? null, p_tonight_only: a.tonightOnly ?? false, p_limit: 30,
      p_after_created: a.after?.createdAt ?? null, p_after_id: a.after?.id ?? null,
    }),
  getProfile: (id: string) => rpc<OtherProfile>('get_profile', { p_id: id }),

  sendRequest: (to: string, note?: string, prompt?: string) =>
    rpc<string>('send_request', { p_to: to, p_note: note ?? null, p_prompt: prompt ?? null }),
  respond: (id: string, accept: boolean) => rpc<string | null>('respond_to_request', { p_id: id, p_accept: accept }),
  cancelRequest: (id: string) => rpc<void>('cancel_request', { p_id: id }),
  listRequests: () => rpc<RequestItem[]>('list_requests'),

  listConversations: () => rpc<ConversationRow[]>('list_conversations', { p_limit: 50 }),
  listMessages: (conversation: string, opts: { beforeSeq?: number; afterSeq?: number } = {}) =>
    rpc<MessageRow[]>('list_messages', {
      p_conversation: conversation, p_before_seq: opts.beforeSeq ?? null, p_after_seq: opts.afterSeq ?? null, p_limit: 30,
    }),
  sendMessage: (conversation: string, clientId: string, body: string) =>
    rpc<{ id: string; seq: number; created_at: string }[]>('send_message', {
      p_conversation: conversation, p_client_id: clientId, p_body: body,
    }),
  markRead: (conversation: string, seq: number) => rpc<void>('mark_read', { p_conversation: conversation, p_seq: seq }),

  block: (id: string) => rpc<void>('block_user', { p_user: id }),
  unblock: (id: string) => rpc<void>('unblock_user', { p_user: id }),
};
