/** The four bundled characters. Their `.glb` files ship with the app, so a clip only needs the id. */
export type AvatarId = 'cyber_monk' | 'street_artist' | 'cozy_bear' | 'neon_bot';

/** One captured sample of the performer. All numbers are rounded before storage to keep clips tiny. */
export type MotionFrame = {
  /** Seconds since the clip started. Playback is driven by audio time, never by frame count. */
  t: number;
  /** Head rotation as Euler angles in radians: [pitch (x), yaw (y), roll (z)]. */
  head: [number, number, number];
  /** ARKit-style blendshape weights, 0..1, keyed by name (for example `jawOpen`, `mouthSmileLeft`). */
  shapes: Record<string, number>;
  /** Normalised hand position [x, y, z]. Absent when that hand was not visible in this frame. */
  leftHand?: [number, number, number];
  rightHand?: [number, number, number];
};

/** Everything a finished `Mask` recording hands to the next step (upload or preview). */
export type MaskRecordingPayload = {
  avatarId: AvatarId;
  fps: number;
  frames: MotionFrame[];
  /** Size of the gzipped motion track in kilobytes. */
  compressedSizeKB: number;
  audioBlob: Blob;
  /** Object URL for local playback. The receiver owns it and must `URL.revokeObjectURL` it. */
  audioUrl: string;
  durationSec: number;
};
