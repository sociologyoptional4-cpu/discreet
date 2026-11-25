import type { AvatarId } from './avatar';

/** Supported post storage formats in `public.posts.post_format`. */
export const POST_FORMATS = ['video', 'image', 'recipe_avatar', 'recipe_shayari', 'living_post'] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

/** Deduplicated media asset stored in `public.media_assets` and hosted on Cloudflare R2. */
export interface MediaAsset {
  id: string;
  /** 64-character lowercase/uppercase SHA-256 hex digest of the file contents. */
  file_hash: string;
  r2_url: string;
  thumbnail_url: string | null;
  mime_type: string;
  file_size_bytes: number;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  is_archived: boolean;
  ref_count: number;
  created_at: string;
}

/** Insert payload for registering a newly uploaded file in `public.media_assets`. */
export interface MediaAssetInsert {
  id?: string;
  file_hash: string;
  r2_url: string;
  thumbnail_url?: string | null;
  mime_type: string;
  file_size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_sec?: number | null;
}

/** Lightweight JSON blueprint for 3D Avatar recipe posts (`post_format = 'recipe_avatar'`). */
export interface AvatarRecipeData {
  kind: 'recipe_avatar';
  version: 1;
  avatarId: AvatarId;
  motionUrl: string;
  audioUrl: string;
  durationSec: number;
  backdrop?: string;
  captions?: Array<{
    startSec: number;
    endSec: number;
    text: string;
  }>;
}

/** Lightweight JSON blueprint for Shayari / text-card recipe posts (`post_format = 'recipe_shayari'`). */
export interface ShayariRecipeData {
  kind: 'recipe_shayari';
  version: 1;
  lines: string[];
  theme: {
    background: string;
    textColor: string;
    accentColor: string;
    fontFamily?: 'sans' | 'serif' | 'mono';
  };
  audioUrl?: string | null;
  durationSec?: number;
}

/** Lightweight JSON blueprint for AI-generated Living Posts (`post_format = 'living_post'`). */
export interface LivingPostRecipeData {
  kind: 'living_post';
  version: 1;
  livingHtmlUrl: string;
  prompt: string;
  remixedFromPostId?: string | null;
  /** Optional inline fallback used only in offline/demo mode. */
  livingHtml?: string;
}

/** Discriminated union stored in `public.posts.recipe_data`. */
export type RecipeData = AvatarRecipeData | ShayariRecipeData | LivingPostRecipeData;

/** Media pipeline columns added to `public.posts`. */
export interface PostMediaColumns {
  post_format: PostFormat;
  media_asset_id: string | null;
  recipe_data: RecipeData | null;
  thumbnail_url: string | null;
  expires_at: string | null;
}

/** Arguments for `increment_media_ref` RPC. */
export interface IncrementMediaRefArgs {
  p_asset_id: string;
}

/** Return row of `increment_media_ref` RPC. */
export type IncrementMediaRefResult = MediaAsset;

/** Arguments for `decrement_media_ref` RPC. */
export interface DecrementMediaRefArgs {
  p_asset_id: string;
}

/** Return value (`ref_count`) of `decrement_media_ref` RPC. */
export type DecrementMediaRefResult = number;
