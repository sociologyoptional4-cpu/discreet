// Server functions raise short machine codes; these become calm, specific sentences.
const MESSAGES: Record<string, string> = {
  under_18: 'Nearby Chat is for adults 18 and over.',
  profile_exists: 'You already have a profile.',
  request_exists: 'There is already a request open between you two.',
  already_connected: 'You are already connected. Open your chat instead.',
  not_found: 'That person is no longer available.',
  not_pending: 'That request was already answered.',
  conversation_unavailable: 'This conversation is unavailable.',
  account_unavailable: 'Your account is not available right now.',
  rate_limited: 'You are going a little fast. Try again in a minute.',
  invalid_body: 'Messages need 1 to 1,000 characters.',
  too_many_photos: 'You can add up to four photos.',
  invalid_photo_key: 'That photo could not be saved. Try another.',
  not_authenticated: 'Please sign in again.',
};

export class ApiError extends Error {
  constructor(readonly code: string, readonly offline = false) {
    super(code);
  }
  get userMessage(): string {
    if (this.offline) return 'You appear to be offline. Check your connection and try again.';
    return MESSAGES[this.code] ?? 'Something went wrong. Please try again.';
  }
}

/** Turns a Supabase/PostgREST error into an ApiError. Never include server detail in UI text. */
export function toApiError(error: { message?: string; code?: string } | null | undefined): ApiError {
  const msg = (error?.message ?? '').trim();
  if (/network request failed|failed to fetch|timed out/i.test(msg)) return new ApiError('offline', true);
  if (error?.code === 'PGRST301' || /jwt/i.test(msg)) return new ApiError('not_authenticated');
  return new ApiError(msg in MESSAGES ? msg : 'unknown');
}

export const messageOf = (e: unknown): string => (e instanceof ApiError ? e.userMessage : 'Something went wrong. Please try again.');
