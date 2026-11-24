export type FilterId = 'natural' | 'golden' | 'pastel' | 'vintage' | 'bw' | 'neon';

export type CameraFilterPreset = {
  id: FilterId;
  label: string;
  swatch: string;
  cssFilter: string;
  tint?: string;
};

export const CAMERA_FILTERS: readonly CameraFilterPreset[] = [
  { id: 'natural', label: 'Natural', swatch: 'linear-gradient(135deg,#e2e8f0,#94a3b8)', cssFilter: 'none' },
  { id: 'golden', label: 'Golden', swatch: 'linear-gradient(135deg,#fde68a,#f59e0b)', cssFilter: 'sepia(0.24) saturate(1.25) brightness(1.04)', tint: 'rgba(251, 191, 36, 0.08)' },
  { id: 'pastel', label: 'Pastel', swatch: 'linear-gradient(135deg,#fbcfe8,#c4b5fd)', cssFilter: 'brightness(1.06) contrast(0.92) saturate(1.18)', tint: 'rgba(244, 114, 182, 0.08)' },
  { id: 'vintage', label: 'Vintage', swatch: 'linear-gradient(135deg,#d6d3d1,#78716c)', cssFilter: 'sepia(0.38) contrast(1.08) brightness(0.96)', tint: 'rgba(120, 113, 108, 0.1)' },
  { id: 'bw', label: 'B&W', swatch: 'linear-gradient(135deg,#f8fafc,#0f172a)', cssFilter: 'grayscale(1) contrast(1.15)' },
  { id: 'neon', label: 'Neon', swatch: 'linear-gradient(135deg,#22d3ee,#a855f7)', cssFilter: 'contrast(1.2) saturate(1.45) hue-rotate(-8deg)', tint: 'rgba(139, 92, 246, 0.1)' },
];

export function buildCanvasFilter(preset: CameraFilterPreset, exposureBias = 0): string {
  const b = Math.max(0.6, Math.min(1.5, 1 + exposureBias));
  const exp = Math.abs(exposureBias) > 0.01 ? `brightness(${b.toFixed(2)})` : '';
  if (preset.cssFilter === 'none') return exp || 'none';
  return exp ? `${preset.cssFilter} ${exp}` : preset.cssFilter;
}
