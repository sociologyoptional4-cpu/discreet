jest.mock('../src/lib/supabase', () => ({ supabase: {} }));
import { MAX_PHOTOS, photoKeys } from '../src/lib/photos';

test('photo keys stay inside the owner folder and are jpeg', () => {
  const k = photoKeys('user-1', 'abc');
  expect(k.object_key).toBe('user-1/abc.jpg');
  expect(k.thumb_key).toBe('user-1/abc_t.jpg');
  expect(k.object_key.startsWith('user-1/')).toBe(true);
});
test('gallery is limited to four photos', () => { expect(MAX_PHOTOS).toBe(4); });
