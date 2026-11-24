export type ShareData = { title: string; text?: string; url: string };
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

/**
 * Opens the phone's share sheet when there is one; otherwise copies the link (desktop).
 * Closing the share sheet without choosing is `cancelled`, not an error.
 */
export async function handleShare(data: ShareData, nav: ShareNavigator | undefined = typeof navigator === 'undefined' ? undefined : navigator): Promise<ShareResult> {
  if (nav?.share) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // Any other share failure falls through to copying the link.
    }
  }
  if (nav?.clipboard) {
    try {
      await nav.clipboard.writeText(data.url);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  return 'failed';
}
