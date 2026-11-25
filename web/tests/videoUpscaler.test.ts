import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameGuard, coverMapping, coverScale, isReadableByWebGL, shouldUpscale } from '../src/lib/media/videoUpscaler.ts';
import { readUpscaleMode } from '../src/lib/media/upscaleMode.ts';

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !~ ${b}`);

test('a 9:16 video on a taller phone is cropped at the sides, like object-fit: cover', () => {
  const m = coverMapping(720, 1280, 390, 844);
  close(m.scaleY, 1);
  assert.ok(m.scaleX < 1);
  close(m.offsetX, (1 - m.scaleX) / 2);
  close(m.offsetY, 0);
  // the visible window must have the destination's aspect ratio
  close((720 * m.scaleX) / (1280 * m.scaleY), 390 / 844);
});

test('a 16:9 video on a portrait phone fills the height and loses most of its width', () => {
  const m = coverMapping(1920, 1080, 390, 844);
  close(m.scaleY, 1);
  assert.ok(m.scaleX < 0.5);
  close((1920 * m.scaleX) / (1080 * m.scaleY), 390 / 844);
});

test('a video wider-than-tall into a wide box crops vertically instead', () => {
  const m = coverMapping(1080, 1920, 800, 400);
  close(m.scaleX, 1);
  assert.ok(m.scaleY < 1);
  close(m.offsetY, (1 - m.scaleY) / 2);
});

test('equal aspect ratios use the whole frame', () => {
  assert.deepEqual(coverMapping(720, 1280, 360, 640), { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
});

test('cover scale is how much one source pixel is stretched', () => {
  close(coverScale(540, 960, 780, 1688), 1688 / 960);
  close(coverScale(1080, 1920, 540, 960), 0.5);
});

test('upscaling is skipped when the source already fills the screen', () => {
  assert.equal(shouldUpscale(720, 1280, 780, 1688, 1.4), false);
  assert.equal(shouldUpscale(540, 960, 780, 1688, 1.4), true);
  assert.equal(shouldUpscale(1080, 1920, 780, 1688, 1.4), false);
  assert.equal(shouldUpscale(0, 0, 780, 1688, 1.4), false);
});

test('WebGL may read same-origin, blob and data videos, and cross-origin ones only with CORS', () => {
  const page = 'https://vybe.app';
  assert.equal(isReadableByWebGL({ currentSrc: 'https://vybe.app/a.mp4', crossOrigin: null }, page), true);
  assert.equal(isReadableByWebGL({ currentSrc: 'blob:https://vybe.app/123', crossOrigin: null }, page), true);
  assert.equal(isReadableByWebGL({ currentSrc: 'https://cdn.r2.dev/a.mp4', crossOrigin: null }, page), false);
  assert.equal(isReadableByWebGL({ currentSrc: 'https://cdn.r2.dev/a.mp4', crossOrigin: 'anonymous' }, page), true);
  assert.equal(isReadableByWebGL({ currentSrc: 'not a url at all %%', crossOrigin: null }, 'bad origin'), false);
});

test('the guard trips only after repeated bad windows and recovers after a good one', () => {
  const guard = new FrameGuard();
  assert.equal(guard.evaluate(8, 30), null);
  assert.equal(guard.evaluate(0, 30), null);
  assert.equal(guard.evaluate(8, 30), null);
  assert.equal(guard.evaluate(9, 30), 'dropped_frames');
});

test('a slow 15 fps clip is not mistaken for a struggling GPU', () => {
  const guard = new FrameGuard();
  for (let i = 0; i < 5; i++) assert.equal(guard.evaluate(0, 15), null);
});

test('very short windows are ignored', () => {
  const guard = new FrameGuard();
  for (let i = 0; i < 5; i++) assert.equal(guard.evaluate(5, 6), null);
});

test('slow frame uploads trip the guard too', () => {
  const guard = new FrameGuard({ maxUploadMs: 5 });
  for (let w = 0; w < 2; w++) {
    for (let i = 0; i < 20; i++) guard.addUpload(8);
    const verdict = guard.evaluate(0, 30);
    assert.equal(verdict, w === 1 ? 'slow_upload' : null);
  }
});

test('?upscale= selects a mode and anything else is auto', () => {
  assert.equal(readUpscaleMode('?upscale=split'), 'split');
  assert.equal(readUpscaleMode('?postId=1&upscale=on'), 'on');
  assert.equal(readUpscaleMode('?upscale=off'), 'off');
  assert.equal(readUpscaleMode('?upscale=banana'), 'auto');
  assert.equal(readUpscaleMode(''), 'auto');
});
