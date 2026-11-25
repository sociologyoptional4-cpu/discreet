import { isCorsSafeMediaUrl } from '@/lib/media/corsSafe';
import { getFeedPrefetcher } from '@/lib/media/rangePrefetcher';

/** The app's prefetcher: it may only touch hosts that serve CORS (and `Range`), which is our R2 bucket. */
export const feedPrefetcher = getFeedPrefetcher({ allowUrl: isCorsSafeMediaUrl });
