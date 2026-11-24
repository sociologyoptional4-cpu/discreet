import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import { BUCKET } from './photos';

const TTL = 3600; // seconds
const STALE = (TTL - 600) * 1000; // refresh ten minutes before expiry

/**
 * One batched request signs every key on screen. Signing is authorized by the storage policy,
 * so a block stops new URLs from being issued. URLs already issued expire on their own.
 */
export function useSignedUrls(keys: (string | null | undefined)[]): Record<string, string> {
  const unique = [...new Set(keys.filter((k): k is string => !!k))].sort();
  const q = useQuery({
    queryKey: ['signed', unique],
    enabled: unique.length > 0,
    staleTime: STALE,
    gcTime: STALE,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(unique, TTL);
      if (error) throw error;
      const map: Record<string, string> = {};
      for (const row of data ?? []) if (row.path && row.signedUrl) map[row.path] = row.signedUrl;
      return map;
    },
  });
  return q.data ?? {};
}
