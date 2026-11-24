import * as SecureStore from 'expo-secure-store';

// SecureStore values are limited to ~2 KB on iOS and a Supabase session is larger, so each
// value is split across numbered chunks plus a count entry. Session material never leaves SecureStore.
const CHUNK = 1800;
const countKey = (k: string) => `${k}.n`;
const chunkKey = (k: string, i: number) => `${k}.${i}`;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await SecureStore.getItemAsync(countKey(key));
    if (n === null) return null;
    const parts: string[] = [];
    for (let i = 0; i < Number(n); i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null; // torn write: treat as signed out rather than return garbage
      parts.push(part);
    }
    return parts.join('');
  },

  async setItem(key: string, value: string): Promise<void> {
    await secureStorage.removeItem(key);
    const chunks = value.match(new RegExp(`.{1,${CHUNK}}`, 'gs')) ?? [''];
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
    await SecureStore.setItemAsync(countKey(key), String(chunks.length)); // written last: marks the value complete
  },

  async removeItem(key: string): Promise<void> {
    const n = await SecureStore.getItemAsync(countKey(key));
    await SecureStore.deleteItemAsync(countKey(key));
    for (let i = 0; i < Number(n ?? 0); i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
  },
};
