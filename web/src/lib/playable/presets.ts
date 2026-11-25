import { PLAYABLE_PRESETS, parsePlayableRecipe, type PlayableSceneRecipe, type PlayableScenePreset } from '@/types/playable';
import data from './presets.json';

/** The four built-in demo scenes, run through the same parser as stored recipes. The JSON also feeds scripts/seed-playable-demos.mjs. */
export const PLAYABLE_DEMO_PRESETS = Object.fromEntries(
  PLAYABLE_PRESETS.map((preset) => [preset, parsePlayableRecipe(data[preset])]),
) as Record<PlayableScenePreset, PlayableSceneRecipe>;
