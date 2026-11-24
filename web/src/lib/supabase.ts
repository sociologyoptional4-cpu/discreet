import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** False until `.env.local` has the two public Supabase values. Screens use it to show a setup message instead of failing. */
export const isSupabaseConfigured = url !== '' && anonKey !== '';

/** With no Supabase keys the app runs on built-in demo data (see src/lib/demoData.ts). */
export const isDemoMode = !isSupabaseConfigured;

/**
 * Browser client (anon key, subject to Row-Level Security). The placeholder values only keep `import` from throwing
 * when the env file is missing; every request then fails and `isSupabaseConfigured` is false.
 */
export const supabase: SupabaseClient = createClient(url || 'http://localhost:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

let admin: SupabaseClient | null = null;

/** Server-only client with the service role key (bypasses RLS). Throws if called in a browser or without the key. */
export function getSupabaseAdmin(): SupabaseClient {
  if (typeof window !== 'undefined') throw new Error('getSupabaseAdmin must only be called on the server.');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('Supabase admin client is not configured (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  admin ??= createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}
