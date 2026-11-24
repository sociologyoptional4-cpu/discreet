import type { Detection } from '@mediapipe/tasks-vision';
import { faceBoxOnCanvas, getCoverTransform, type Ctx, type FrameSource } from '@/lib/canvasRenderers';

export type AestheticFilterId = 'clean' | 'soft_skin' | 'pastel' | 'golden' | 'film' | 'bw' | 'glow' | 'cyber';
export type ArLensId = 'none' | 'cyber_shades' | 'neon_halo' | 'sparkle_blush' | 'pixel_censor';

export type AestheticFilterPreset = {
  id: AestheticFilterId;
  label: string;
  swatch: string;
  cssFilter: string;
  tint?: string;
  softSkin?: boolean;
  vignette?: boolean;
};

export const AESTHETIC_FILTERS: readonly AestheticFilterPreset[] = [
  { id: 'clean', label: 'Clean', swatch: 'linear-gradient(135deg,#f8fafc,#94a3b8)', cssFilter: 'none' },
  {
    id: 'soft_skin',
    label: 'Soft Skin',
    swatch: 'linear-gradient(135deg,#ffe4e6,#fda4af)',
    cssFilter: 'brightness(1.05) contrast(0.96) saturate(1.08)',
    tint: 'rgba(255, 228, 230, 0.06)',
    softSkin: true,
  },
  {
    id: 'pastel',
    label: 'Pastel',
    swatch: 'linear-gradient(135deg,#fbcfe8,#c4b5fd)',
    cssFilter: 'brightness(1.07) contrast(0.92) saturate(1.18)',
    tint: 'rgba(244, 114, 182, 0.08)',
  },
  {
    id: 'golden',
    label: 'Golden',
    swatch: 'linear-gradient(135deg,#fde68a,#f59e0b)',
    cssFilter: 'sepia(0.22) saturate(1.28) brightness(1.04)',
    tint: 'rgba(251, 191, 36, 0.09)',
  },
  {
    id: 'film',
    label: 'Film',
    swatch: 'linear-gradient(135deg,#d6d3d1,#78716c)',
    cssFilter: 'sepia(0.35) contrast(1.08) brightness(0.97)',
    tint: 'rgba(120, 113, 108, 0.1)',
    vignette: true,
  },
  {
    id: 'bw',
    label: 'B&W',
    swatch: 'linear-gradient(135deg,#f8fafc,#0f172a)',
    cssFilter: 'grayscale(1) contrast(1.18)',
    vignette: true,
  },
  {
    id: 'glow',
    label: 'Glow',
    swatch: 'linear-gradient(135deg,#fef08a,#f472b6)',
    cssFilter: 'brightness(1.09) contrast(0.95) saturate(1.15)',
    tint: 'rgba(253, 224, 71, 0.07)',
  },
  {
    id: 'cyber',
    label: 'Cyber',
    swatch: 'linear-gradient(135deg,#22d3ee,#a855f7)',
    cssFilter: 'contrast(1.18) saturate(1.42) hue-rotate(-10deg)',
    tint: 'rgba(139, 92, 246, 0.1)',
  },
];

export const AR_LENSES: readonly { id: ArLensId; label: string; badge: string }[] = [
  { id: 'none', label: 'No Lens', badge: '○' },
  { id: 'cyber_shades', label: 'Cyber Shades', badge: '🕶️' },
  { id: 'neon_halo', label: 'Neon Halo', badge: '😇' },
  { id: 'sparkle_blush', label: 'Blush Glow', badge: '✨' },
  { id: 'pixel_censor', label: 'Censor Bar', badge: '⬛' },
];

export function composeCssFilter(preset: AestheticFilterPreset, exposureBias = 0): string {
  const b = Math.max(0.6, Math.min(1.5, 1 + exposureBias));
  const exp = Math.abs(exposureBias) > 0.01 ? `brightness(${b.toFixed(2)})` : '';
  if (preset.cssFilter === 'none') return exp || 'none';
  return exp ? `${preset.cssFilter} ${exp}` : preset.cssFilter;
}

/** Draws the natural camera frame in Normal mode with optional soft-skin smoothing and vignette. */
export function drawNormalFrame(
  ctx: Ctx,
  src: FrameSource,
  detections: Detection[],
  width: number,
  height: number,
  preset: AestheticFilterPreset,
): void {
  const t = getCoverTransform(src, width, height);
  if (!t) return;
  ctx.drawImage(src, t.sx, t.sy, t.sw, t.sh, 0, 0, width, height);

  if (preset.softSkin && detections.length > 0) {
    for (const det of detections) {
      const box = faceBoxOnCanvas(det, src, width, height);
      if (!box) continue;
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w * 0.44, box.h * 0.48, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalAlpha = 0.36;
      ctx.filter = 'blur(4px) brightness(1.04)';
      ctx.drawImage(src, t.sx, t.sy, t.sw, t.sh, 0, 0, width, height);
      ctx.restore();
    }
  }
}

/** Renders 60fps on-device AR face overlays anchored to MediaPipe detections. */
export function drawArLensOverlay(
  ctx: Ctx,
  src: FrameSource,
  detections: Detection[],
  width: number,
  height: number,
  lens: ArLensId,
  nowMs: number,
): void {
  if (lens === 'none' || detections.length === 0) return;

  for (const det of detections) {
    const box = faceBoxOnCanvas(det, src, width, height);
    if (!box) continue;
    const cx = box.x + box.w / 2;
    const eyeY = box.y + box.h * 0.41;

    ctx.save();
    if (lens === 'cyber_shades') {
      const visorW = box.w * 0.78;
      const visorH = box.h * 0.19;
      const vx = cx - visorW / 2;
      const vy = eyeY - visorH / 2;
      const grad = ctx.createLinearGradient(vx, vy, vx + visorW, vy + visorH);
      grad.addColorStop(0, 'rgba(34, 211, 238, 0.88)');
      grad.addColorStop(0.5, 'rgba(168, 85, 247, 0.88)');
      grad.addColorStop(1, 'rgba(244, 63, 94, 0.88)');

      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(vx - 3, vy - 3, visorW + 6, visorH + 6, 12);
      ctx.fill();

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(vx, vy, visorW, visorH, 10);
      ctx.fill();

      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillRect(vx + 10, vy + 4, visorW * 0.35, 4);
    } else if (lens === 'neon_halo') {
      const bob = Math.sin(nowMs * 0.004) * 5;
      const haloY = Math.max(22, box.y + box.h * 0.04 + bob);
      ctx.strokeStyle = '#38bdf8';
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 18;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(cx, haloY, box.w * 0.38, box.h * 0.08, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (lens === 'sparkle_blush') {
      const cheekY = box.y + box.h * 0.56;
      const offset = box.w * 0.24;
      for (const side of [-1, 1]) {
        const gx = cx + side * offset;
        const rad = box.w * 0.13;
        const g = ctx.createRadialGradient(gx, cheekY, 2, gx, cheekY, rad);
        g.addColorStop(0, 'rgba(251, 113, 133, 0.55)');
        g.addColorStop(1, 'rgba(251, 113, 133, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(gx, cheekY, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (lens === 'pixel_censor') {
      const barW = box.w * 0.82;
      const barH = box.h * 0.2;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(cx - barW / 2, eyeY - barH / 2, barW, barH);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(barH * 0.45)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('REDACTED', cx, eyeY);
    }
    ctx.restore();
  }
}
