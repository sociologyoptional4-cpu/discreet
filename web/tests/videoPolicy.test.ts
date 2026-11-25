import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTPUT_LIMITS, isFastStartMp4, outputDimensions, planConversion, readTopLevelAtoms, type SourceInfo } from '../src/lib/media/videoPolicy.ts';

function atom(type: string, payload = 4): Uint8Array {
  const out = new Uint8Array(8 + payload);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  return out;
}
const concat = (...parts: Uint8Array[]) => parts.reduce((all, p) => { const next = new Uint8Array(all.length + p.length); next.set(all); next.set(p, all.length); return next; }, new Uint8Array());

test('moov before mdat is fast start; mdat before moov is not', () => {
  assert.equal(isFastStartMp4(concat(atom('ftyp', 12), atom('moov', 100), atom('mdat', 500))), true);
  assert.equal(isFastStartMp4(concat(atom('ftyp', 12), atom('mdat', 500), atom('moov', 100))), false);
});

test('a file without ftyp, or with the moov beyond the bytes we have, is not reported as fast start', () => {
  assert.equal(isFastStartMp4(concat(atom('moov', 100), atom('mdat', 10))), false);
  assert.equal(isFastStartMp4(concat(atom('ftyp', 12), atom('free', 20))), false);
  assert.equal(isFastStartMp4(new Uint8Array([1, 2, 3])), false);
});

test('atom reader stops at a malformed box instead of looping or throwing', () => {
  const junk = concat(atom('ftyp', 12), new Uint8Array([0, 0, 0, 3, 0x41, 0x42, 0x43, 0x44, 0, 0, 0, 0]));
  assert.deepEqual(readTopLevelAtoms(junk).map((a) => a.type), ['ftyp']);
});

test('a size-0 box extends to the end of the data', () => {
  const body = atom('mdat', 40);
  new DataView(body.buffer).setUint32(0, 0);
  const atoms = readTopLevelAtoms(concat(atom('ftyp', 12), body));
  assert.equal(atoms[1].size, body.length);
});

test('output is never upscaled, keeps the aspect ratio and uses even sides', () => {
  assert.deepEqual(outputDimensions(1080, 1920), { width: 720, height: 1280, changed: true });
  assert.deepEqual(outputDimensions(1920, 1080), { width: 1280, height: 720, changed: true });
  assert.deepEqual(outputDimensions(480, 854), { width: 480, height: 854, changed: false });
  assert.deepEqual(outputDimensions(481, 855), { width: 482, height: 856, changed: true });
});

const optimal: SourceInfo = { container: 'mp4', bytes: 900_000, durationSec: 6, width: 720, height: 1280, videoCodec: 'avc', audioCodec: 'aac', fastStart: true };

test('an H.264/AAC fast-start MP4 within the size and bitrate limits is left untouched', () => {
  assert.deepEqual(planConversion(optimal), { action: 'bypass', reason: 'already-optimal' });
});

test('a small fast-start MP4 is bypassed even at a high bitrate', () => {
  assert.equal(planConversion({ ...optimal, bytes: 1_500_000, durationSec: 2 }).action, 'bypass');
});

test('trim or watermark always converts, and a watermark forces a re-encode', () => {
  assert.equal(planConversion(optimal, { trim: true }).action, 'convert');
  const marked = planConversion(optimal, { watermark: true });
  assert.equal(marked.action === 'convert' && marked.forceVideoTranscode, true);
});

test('a WebM recording is converted to H.264 and re-encoded', () => {
  const plan = planConversion({ ...optimal, container: 'webm', videoCodec: 'vp9', audioCodec: 'opus', fastStart: false });
  assert.deepEqual(plan, { action: 'convert', reason: 'webm-to-mp4', resize: null, forceVideoTranscode: true });
});

test('a 1080p phone MP4 is downscaled and re-encoded', () => {
  const plan = planConversion({ ...optimal, width: 1080, height: 1920, bytes: 30_000_000, fastStart: false });
  assert.equal(plan.action === 'convert' && plan.reason, 'downscale');
  assert.deepEqual(plan.action === 'convert' && plan.resize, { width: 720, height: 1280 });
});

test('a 720p H.264 MP4 that only lacks fast start is remuxed, with the video copied rather than re-encoded', () => {
  const plan = planConversion({ ...optimal, fastStart: false, bytes: 1_500_000 });
  assert.deepEqual(plan, { action: 'convert', reason: 'faststart-remux', resize: null, forceVideoTranscode: false });
});

test('a heavy 720p H.264 MP4 is re-encoded to the target bitrate', () => {
  const heavy = planConversion({ ...optimal, bytes: 40_000_000, durationSec: 20 });
  assert.equal(heavy.action === 'convert' && heavy.forceVideoTranscode, true);
  assert.ok(40_000_000 * 8 / 20 > OUTPUT_LIMITS.videoBitrate * OUTPUT_LIMITS.bitrateForceMultiple);
});

test('non-AAC audio in an otherwise optimal MP4 still gets converted', () => {
  assert.equal(planConversion({ ...optimal, audioCodec: 'opus' }).action, 'convert');
});
