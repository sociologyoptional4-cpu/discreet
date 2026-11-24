import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
let admin: SupabaseClient | null = null;

/** Server-only client with the service role key (bypasses RLS). Throws if called in a browser or without the key. */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') throw new Error('getSupabaseAdmin must only be called on the server.');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase admin client is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  admin ??= createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
