import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extensionForMime, isImageUrl } from '../src/lib/media/mediaKind.ts';
import { fitWithin } from '../src/lib/media/imageEngine.ts';

test('image URLs are recognised by extension, ignoring query strings', () => {
  assert.equal(isImageUrl('https://cdn/x/abc-snap.png'), true);
  assert.equal(isImageUrl('https://cdn/x/abc-snap.WEBP?v=2'), true);
  assert.equal(isImageUrl('https://cdn/x/abc-snap.mp4'), false);
  assert.equal(isImageUrl('https://cdn/x/abc-snap.webm'), false);
  assert.equal(isImageUrl(null), false);
});

test('file extensions follow the MIME type, not an assumption', () => {
  assert.equal(extensionForMime('image/png'), 'png');
  assert.equal(extensionForMime('image/jpeg'), 'jpg');
  assert.equal(extensionForMime('video/webm;codecs=vp9,opus'), 'webm');
  assert.equal(extensionForMime('video/mp4'), 'mp4');
  assert.equal(extensionForMime(''), 'bin');
});

test('photos are shrunk to the long edge and never upscaled', () => {
  assert.deepEqual(fitWithin(4000, 3000, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitWithin(3000, 4000, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitWithin(540, 960, 1280), { width: 540, height: 960 });
});
