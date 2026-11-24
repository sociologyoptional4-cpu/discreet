import type { Detection, MPMask } from '@mediapipe/tasks-vision';

/**
 * Pure canvas renderers for the faceless recorder. No React, no module state except two scratch canvases.
 * Detections must come from the SAME frame/element that is drawn, in that element's native pixel space.
 * Nothing here mirrors the image; if the preview is mirrored, mirror the whole canvas at the CSS layer.
 */
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
/** A camera element. Images/canvases are accepted so the renderers can be tested without a camera. */
export type FrameSource = HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export type Box = { x: number; y: number; w: number; h: number };

const FACE_EXPAND = 0.25; // each side grows by 25% of the box size
const BLUR_PX = 28;
// Value the selfie segmenter's category mask uses for "person" (verified against a portrait in-browser).
const PERSON_CATEGORY = 0;

/* ---------- geometry ---------- */

const sourceSize = (s: FrameSource): { w: number; h: number } =>
  s instanceof HTMLVideoElement
    ? { w: s.videoWidth, h: s.videoHeight }
    : s instanceof HTMLImageElement
      ? { w: s.naturalWidth, h: s.naturalHeight }
      : { w: s.width, h: s.height };

/** Center-crop ("object-fit: cover") of the source into a width x height canvas. */
export function getCoverTransform(src: FrameSource, width: number, height: number) {
  const { w: vw, h: vh } = sourceSize(src);
  if (!vw || !vh) return null;
  const scale = Math.max(width / vw, height / vh);
  const sw = width / scale; // source pixels visible horizontally
  const sh = height / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  return { vw, vh, scale, sx, sy, sw, sh };
}

/** Maps a detection (video pixels) to canvas pixels, grows it by 25% on every side, clamps to the canvas. */
export function faceBoxOnCanvas(d: Detection, src: FrameSource, width: number, height: number): Box | null {
  const b = d.boundingBox;
  const t = getCoverTransform(src, width, height);
  if (!b || !t) return null;
  const w = b.width * t.scale;
  const h = b.height * t.scale;
  const x = (b.originX - t.sx) * t.scale - w * FACE_EXPAND;
  const y = (b.originY - t.sy) * t.scale - h * FACE_EXPAND;
  const bw = w * (1 + 2 * FACE_EXPAND);
  const bh = h * (1 + 2 * FACE_EXPAND);
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(width, x + bw);
  const y1 = Math.min(height, y + bh);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

const faceBoxes = (dets: Detection[], src: FrameSource, w: number, h: number): Box[] =>
  dets.flatMap((d) => faceBoxOnCanvas(d, src, w, h) ?? []);

/* ---------- scratch canvases (lazy, reused every frame) ---------- */

const makeCanvas = (w: number, h: number): AnyCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};
const ctxOf = (c: AnyCanvas): Ctx => c.getContext('2d', { willReadFrequently: false }) as Ctx;

let pixelScratch: AnyCanvas | null = null; // downscaled face region for the mosaic
let maskScratch: AnyCanvas | null = null; // segmentation mask at its native resolution
let maskImage: ImageData | null = null;

function resize(c: AnyCanvas, w: number, h: number) {
  if (c.width !== w) c.width = w;
  if (c.height !== h) c.height = h;
}

/* ---------- 1. cover video ---------- */

/** Draws the source center-cropped to fill the canvas without stretching. Returns false if no frame is ready yet. */
export function drawCoverVideo(ctx: Ctx, video: FrameSource, width: number, height: number): boolean {
  const t = getCoverTransform(video, width, height);
  if (!t) return false;
  ctx.drawImage(video, t.sx, t.sy, t.sw, t.sh, 0, 0, width, height);
  return true;
}

/** Draws only a canvas-space rectangle of the cover-cropped frame (cheap: no full-frame blur). */
function drawVideoRegion(ctx: Ctx, video: FrameSource, width: number, height: number, r: Box) {
  const t = getCoverTransform(video, width, height);
  if (!t) return;
  const inv = 1 / t.scale;
  ctx.drawImage(video, t.sx + r.x * inv, t.sy + r.y * inv, r.w * inv, r.h * inv, r.x, r.y, r.w, r.h);
}

/* ---------- 2. blur ---------- */

const supportsCanvasFilter = (ctx: Ctx): boolean => 'filter' in ctx;

/**
 * Crisp frame, with every face replaced by a heavy blur (or a pixel mosaic).
 * Safari versions without `ctx.filter` would silently draw a SHARP face, so they are forced onto the mosaic path.
 */
export function drawBlurFrame(
  ctx: Ctx,
  video: FrameSource,
  detections: Detection[],
  width: number,
  height: number,
  usePixelFallback: boolean,
): { faceDetected: boolean } {
  if (!drawCoverVideo(ctx, video, width, height)) return { faceDetected: false };
  const boxes = faceBoxes(detections, video, width, height);
  const mosaic = usePixelFallback || !supportsCanvasFilter(ctx);

  for (const b of boxes) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
    if (mosaic) {
      drawMosaic(ctx, video, width, height, b);
    } else {
      // Pad the source so the blur has real pixels to sample at the ellipse edge (no transparent halo).
      const pad = BLUR_PX * 2;
      const r: Box = {
        x: Math.max(0, b.x - pad),
        y: Math.max(0, b.y - pad),
        w: 0,
        h: 0,
      };
      r.w = Math.min(width, b.x + b.w + pad) - r.x;
      r.h = Math.min(height, b.y + b.h + pad) - r.y;
      ctx.filter = `blur(${BLUR_PX}px)`;
      drawVideoRegion(ctx, video, width, height, r);
    }
    ctx.restore(); // also resets ctx.filter
  }
  return { faceDetected: boxes.length > 0 };
}

function drawMosaic(ctx: Ctx, video: FrameSource, width: number, height: number, b: Box) {
  const cell = Math.max(6, Math.round(Math.min(b.w, b.h) / 10)); // about 10 blocks across the face
  const tw = Math.max(1, Math.ceil(b.w / cell));
  const th = Math.max(1, Math.ceil(b.h / cell));
  pixelScratch ??= makeCanvas(tw, th);
  resize(pixelScratch, tw, th);
  const s = ctxOf(pixelScratch);
  s.imageSmoothingEnabled = true; // averaging on the way down
  s.clearRect(0, 0, tw, th);
  const t = getCoverTransform(video, width, height);
  if (!t) return;
  const inv = 1 / t.scale;
  s.drawImage(video, t.sx + b.x * inv, t.sy + b.y * inv, b.w * inv, b.h * inv, 0, 0, tw, th);
  ctx.imageSmoothingEnabled = false; // hard blocks on the way up
  ctx.drawImage(pixelScratch as CanvasImageSource, 0, 0, tw, th, b.x, b.y, b.w, b.h);
}

/* ---------- 3. shadow silhouette ---------- */

const BG_TOP = '#0A0A0A';
const BG_BOTTOM = '#18181B';
const SILHOUETTE = '#050507';
const GLOW_VIOLET = 'rgba(139, 92, 246, 0.9)';
const GLOW_CYAN = 'rgba(34, 211, 238, 0.85)';

/**
 * Matte-black silhouette with a violet/cyan edge glow on a dark gradient. No camera pixel is ever drawn,
 * so if the mask is missing the result is just the empty background (safe by default).
 * The caller owns `categoryMask` and must close() it after this returns.
 */
export function drawShadowFrame(
  ctx: Ctx,
  video: FrameSource,
  categoryMask: MPMask | null,
  width: number,
  height: number,
  offscreenCanvas: AnyCanvas,
): void {
  const t = getCoverTransform(video, width, height);
  resize(offscreenCanvas, width, height);
  const off = ctxOf(offscreenCanvas);
  off.globalCompositeOperation = 'source-over';
  off.clearRect(0, 0, width, height);

  if (t && categoryMask) {
    // 1) person mask -> alpha, at the mask's own resolution
    const mw = categoryMask.width;
    const mh = categoryMask.height;
    const data = categoryMask.getAsUint8Array();
    maskScratch ??= makeCanvas(mw, mh);
    resize(maskScratch, mw, mh);
    if (!maskImage || maskImage.width !== mw || maskImage.height !== mh) maskImage = new ImageData(mw, mh);
    const px = maskImage.data;
    for (let i = 0, n = mw * mh; i < n; i++) px[i * 4 + 3] = data[i] === PERSON_CATEGORY ? 255 : 0;
    ctxOf(maskScratch).putImageData(maskImage, 0, 0);

    // 2) upscale (smoothed = soft edge) into the cover-cropped position, then make it matte black
    off.imageSmoothingEnabled = true;
    off.imageSmoothingQuality = 'high';
    off.drawImage(maskScratch as CanvasImageSource, -t.sx * t.scale, -t.sy * t.scale, t.vw * t.scale, t.vh * t.scale);
    off.globalCompositeOperation = 'source-in';
    off.fillStyle = SILHOUETTE;
    off.fillRect(0, 0, width, height);
    off.globalCompositeOperation = 'source-over';
  }

  // 3) glow passes (wide violet, tight cyan) then the clean matte fill, all on a transparent target
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, width, height);
  const src = offscreenCanvas as CanvasImageSource;
  const glow = (color: string, blur: number) => {
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.drawImage(src, 0, 0);
  };
  glow(GLOW_VIOLET, width * 0.07);
  glow(GLOW_CYAN, width * 0.025);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.drawImage(src, 0, 0);

  // 4) background goes BEHIND the silhouette and its glow
  ctx.globalCompositeOperation = 'destination-over';
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, BG_TOP);
  g.addColorStop(1, BG_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

/* ---------- 4. no-face guard ---------- */

const BADGE_TEXT = 'FACE DETECTED — PRIVACY LOCK';

/** Raw POV frame. Any face is covered at once by a solid black box and a warning badge. */
export function drawNoFaceGuardFrame(
  ctx: Ctx,
  video: FrameSource,
  detections: Detection[],
  width: number,
  height: number,
): { faceDetected: boolean } {
  if (!drawCoverVideo(ctx, video, width, height)) return { faceDetected: false };
  const boxes = faceBoxes(detections, video, width, height);
  if (!boxes.length) return { faceDetected: false };

  ctx.save();
  ctx.fillStyle = '#000';
  for (const b of boxes) ctx.fillRect(b.x, b.y, b.w, b.h);

  // glassmorphic red badge, centred, text shrunk to fit narrow canvases
  let font = Math.round(width * 0.042);
  ctx.font = `700 ${font}px system-ui, -apple-system, sans-serif`;
  const maxText = width * 0.84;
  const measured = ctx.measureText(BADGE_TEXT).width;
  if (measured > maxText) {
    font = Math.floor(font * (maxText / measured));
    ctx.font = `700 ${font}px system-ui, -apple-system, sans-serif`;
  }
  const textW = ctx.measureText(BADGE_TEXT).width;
  const bw = textW + font * 1.8;
  const bh = font * 2.4;
  const bx = (width - bw) / 2;
  const by = (height - bh) / 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(220, 38, 38, 0.82)';
  ctx.fill();
  ctx.lineWidth = Math.max(1, width * 0.003);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(BADGE_TEXT, width / 2, by + bh / 2 + font * 0.04);
  ctx.restore();
  return { faceDetected: true };
}
