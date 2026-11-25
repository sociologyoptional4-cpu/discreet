const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PostSharePayload = { postId: string; note?: string };

/** A shared post travels as a normal message whose `content` is this JSON (same pattern as avatar stickers). */
export function encodePostShare(postId: string, note?: string): string {
  const trimmed = note?.trim();
  return JSON.stringify(trimmed ? { postId, note: trimmed.slice(0, 300) } : { postId });
}

export function parsePostShare(content: string | null): PostSharePayload | null {
  if (!content) return null;
  try {
    const value = JSON.parse(content) as { postId?: unknown; note?: unknown };
    if (typeof value.postId !== 'string' || !UUID.test(value.postId)) return null;
    return { postId: value.postId, note: typeof value.note === 'string' ? value.note : undefined };
  } catch {
    return null;
  }
}
