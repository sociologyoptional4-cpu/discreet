const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    if (v.length > 2048) throw new Error('value too large'); // mirrors the iOS Keychain limit
    mockStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => { mockStore.delete(k); }),
}));
import { secureStorage } from '../src/lib/secureStorage';

beforeEach(() => mockStore.clear());

test('round-trips a value larger than the 2 KB SecureStore limit', async () => {
  const session = JSON.stringify({ access_token: 'a'.repeat(5000), refresh_token: 'r'.repeat(300) });
  await secureStorage.setItem('sb', session);
  expect(await secureStorage.getItem('sb')).toBe(session);
});
test('returns null when nothing is stored', async () => { expect(await secureStorage.getItem('none')).toBeNull(); });
test('overwriting leaves no stale chunks behind', async () => {
  await secureStorage.setItem('sb', 'x'.repeat(6000));
  await secureStorage.setItem('sb', 'short');
  expect(await secureStorage.getItem('sb')).toBe('short');
  expect([...mockStore.keys()].filter((k) => k.startsWith('sb.')).sort()).toEqual(['sb.0', 'sb.n']);
});
test('a torn write reads as signed out, not as corrupt data', async () => {
  await secureStorage.setItem('sb', 'y'.repeat(6000));
  mockStore.delete('sb.1');
  expect(await secureStorage.getItem('sb')).toBeNull();
});
test('removeItem clears every chunk', async () => {
  await secureStorage.setItem('sb', 'z'.repeat(6000));
  await secureStorage.removeItem('sb');
  expect(mockStore.size).toBe(0);
});
