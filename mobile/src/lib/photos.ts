import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabase';
import { ApiError, toApiError } from './errors';
import type { Photo } from './types';

export const BUCKET = 'profile-photos';
export const MAIN_WIDTH = 1080;
export const THUMB_WIDTH = 360;
export const MAX_PHOTOS = 4;

/** Object keys always live in the owner's folder; the server and storage policy enforce this too. */
export const photoKeys = (userId: string, id: string): Photo => ({
  object_key: `${userId}/${id}.jpg`,
  thumb_key: `${userId}/${id}_t.jpg`,
});

async function reencode(uri: string, width: number, compress: number): Promise<ArrayBuffer> {
  // Re-encoding writes a fresh JPEG, which drops EXIF and GPS metadata from the original.
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri).resize({ width });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ format: ImageManipulator.SaveFormat.JPEG, compress });
  const res = await fetch(out.uri);
  return res.arrayBuffer();
}

async function put(key: string, bytes: ArrayBuffer): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(key, bytes, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error.message.match(/network|fetch/i) ? new ApiError('offline', true) : toApiError({ message: 'invalid_photo_key' });
}

/** Opens the iOS photo picker and returns the chosen local URI, or null if cancelled. */
export async function pickPhoto(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: false, quality: 1, exif: false,
  });
  return res.canceled ? null : res.assets[0].uri;
}

/** Resize + re-encode off the tap path, upload main and thumbnail, return the keys. */
export async function uploadPhoto(userId: string, uri: string): Promise<Photo> {
  const keys = photoKeys(userId, Crypto.randomUUID());
  const [main, thumb] = await Promise.all([reencode(uri, MAIN_WIDTH, 0.65), reencode(uri, THUMB_WIDTH, 0.6)]);
  await put(keys.object_key, main);
  await put(keys.thumb_key, thumb);
  return keys;
}
