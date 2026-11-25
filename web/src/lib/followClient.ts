import type { FollowToggleResponse } from '@/types/social';

export class FollowRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function requestFollowToggle(username: string, accessToken: string): Promise<FollowToggleResponse> {
  const response = await fetch(`/api/users/${encodeURIComponent(username)}/follow`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => null)) as (Partial<FollowToggleResponse> & { error?: string }) | null;
  if (!response.ok || typeof body?.isFollowing !== 'boolean' || typeof body.followersCount !== 'number') {
    throw new FollowRequestError(response.status, body?.error ?? 'Could not update the follow.');
  }
  return { isFollowing: body.isFollowing, followersCount: body.followersCount };
}
