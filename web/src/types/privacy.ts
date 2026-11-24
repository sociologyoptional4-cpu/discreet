/**
 * How the person is hidden. The raw camera frame is never recorded in any mode.
 * `mask` replaces the person with a 3D avatar driven by captured motion.
 */
export type PrivacyMode = 'mask' | 'blur' | 'shadow' | 'noface';

/** When a posted snap is deleted. `never` is capped for free users server-side. */
export type ExpiryTier = '1d' | '1w' | '1y' | 'never';

export type RecorderState = 'idle' | 'recording' | 'preview';

export type RecordedSnapPayload = {
  blob: Blob;
  /** Object URL for local preview. The owner of the payload must `URL.revokeObjectURL` it. */
  url: string;
  mimeType: string;
  expiry: ExpiryTier;
  mode: PrivacyMode;
  durationSec: number;
};
