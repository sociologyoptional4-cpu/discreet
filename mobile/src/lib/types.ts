export type Photo = { object_key: string; thumb_key: string };
export type Tonight = { text: string; area: string | null; until: string };
export type Prompt = { q: string; a: string };

export type MyProfile = {
  id: string; name: string; bio: string; city_id: number; city: string; age: number;
  tags: string[]; prompts: Prompt[]; discoverable: boolean; status: string;
  tonight: Tonight | null; approx_location: boolean; notifications: boolean; photos: Photo[];
};

export type NearbyRow = {
  id: string; name: string; age: number; city: string; bio: string; tags: string[]; shared_tags: number;
  tonight_text: string | null; tonight_area: string | null; tonight_until: string | null;
  thumb_key: string | null; created_at: string; distance_band: string | null;
};

export type Relation = 'none' | 'request_sent' | 'request_received' | 'connected';
export type OtherProfile = {
  id: string; name: string; bio: string; city: string; age: number; tags: string[]; prompts: Prompt[];
  tonight: Tonight | null; photos: Photo[]; relation: Relation; request_id: string | null; conversation_id: string | null;
};

export type RequestItem = {
  id: string; direction: 'incoming' | 'sent'; other_id: string; name: string; note: string | null;
  prompt: string | null; created_at: string; thumb_key: string | null;
};

export type ConversationRow = {
  conversation_id: string; other_id: string; other_name: string; other_thumb: string | null; unavailable: boolean;
  last_body: string | null; last_sender: string | null; last_at: string | null; unread: number; sort_at: string;
};

export type MessageRow = { id: string; seq: number; sender_id: string; client_id: string; body: string; created_at: string };
export type City = { id: number; name: string };
