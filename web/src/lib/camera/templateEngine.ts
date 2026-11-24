import type { AestheticFilterId } from './filterPipeline';

export type TemplateId = 'none' | 'fast_cut' | 'beat_drop' | 'storytime_glow' | 'before_after';

export type VideoTemplateBlueprint = {
  id: TemplateId;
  name: string;
  tagline: string;
  recommendedDurationSec: 15 | 30 | 60;
  filterId: AestheticFilterId;
  playbackRate: 0.5 | 1 | 1.25;
  captionPreset: 'bold_pop' | 'minimal_frosted' | 'neon_outline';
  badge: string;
};

export const VIDEO_TEMPLATES: readonly VideoTemplateBlueprint[] = [
  {
    id: 'none',
    name: 'Original',
    tagline: 'No template effects',
    recommendedDurationSec: 30,
    filterId: 'clean',
    playbackRate: 1,
    captionPreset: 'minimal_frosted',
    badge: '○',
  },
  {
    id: 'fast_cut',
    name: 'Fast-Cut Review',
    tagline: '15s punchy product take',
    recommendedDurationSec: 15,
    filterId: 'golden',
    playbackRate: 1.25,
    captionPreset: 'bold_pop',
    badge: '⚡',
  },
  {
    id: 'beat_drop',
    name: 'Beat Drop',
    tagline: 'High-contrast cyber vibe',
    recommendedDurationSec: 15,
    filterId: 'cyber',
    playbackRate: 1,
    captionPreset: 'neon_outline',
    badge: '🎵',
  },
  {
    id: 'storytime_glow',
    name: 'Storytime Glow',
    tagline: 'Warm soft-skin confessional',
    recommendedDurationSec: 60,
    filterId: 'soft_skin',
    playbackRate: 1,
    captionPreset: 'minimal_frosted',
    badge: '✨',
  },
  {
    id: 'before_after',
    name: 'Before / After',
    tagline: 'Crisp film comparison',
    recommendedDurationSec: 30,
    filterId: 'film',
    playbackRate: 1,
    captionPreset: 'bold_pop',
    badge: '🎬',
  },
];
