import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/server/admin';
import { authenticate, isUuid, json } from '@/lib/server/request';
import type { AvatarId } from '@/types/avatar';

export type CommentAuthor = {
  id: string;
  username: string;
  avatar_id: AvatarId;
  avatar_url: string | null;
};

export type HydratedComment = {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  likes_count: number;
  created_at: string;
  author: CommentAuthor;
  replies: HydratedComment[];
};

type RawCommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  likes_count: number;
  created_at: string;
};

type RawUserRow = {
  id: string;
  username: string;
  avatar_id: AvatarId;
  custom_avatar_url?: string | null;
};

const FALLBACK_AUTHOR: CommentAuthor = {
  id: '00000000-0000-0000-0000-000000000000',
  username: 'vybe_user',
  avatar_id: 'cyber_monk',
  avatar_url: null,
};

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  const { postId } = await context.params;
  if (!isUuid(postId)) {
    return json({ error: 'Invalid postId.' }, 400);
  }

  const admin = getSupabaseAdmin();
  const [{ data: rows, error }, { data: postRow }] = await Promise.all([
    admin
      .from('post_comments')
      .select('id, post_id, user_id, parent_id, content, likes_count, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .limit(200),
    admin.from('posts').select('comments_count').eq('id', postId).maybeSingle(),
  ]);

  if (error) {
    return json({ error: 'Could not load comments.' }, 500);
  }

  const commentRows = (rows ?? []) as RawCommentRow[];
  const userIds = [...new Set(commentRows.map((r) => r.user_id))];
  const authorMap = new Map<string, CommentAuthor>();

  if (userIds.length > 0) {
    const { data: users } = await admin
      .from('users')
      .select('id, username, avatar_id, custom_avatar_url')
      .in('id', userIds);

    for (const u of (users ?? []) as RawUserRow[]) {
      authorMap.set(u.id, {
        id: u.id,
        username: u.username,
        avatar_id: u.avatar_id ?? 'cyber_monk',
        avatar_url: u.custom_avatar_url ?? null,
      });
    }
  }

  const byId = new Map<string, HydratedComment>();
  const topLevel: HydratedComment[] = [];
  const replies: HydratedComment[] = [];

  for (const r of commentRows) {
    const hydrated: HydratedComment = {
      id: r.id,
      post_id: r.post_id,
      user_id: r.user_id,
      parent_id: r.parent_id,
      content: r.content,
      likes_count: r.likes_count ?? 0,
      created_at: r.created_at,
      author: authorMap.get(r.user_id) ?? { ...FALLBACK_AUTHOR, id: r.user_id },
      replies: [],
    };
    byId.set(r.id, hydrated);
    if (r.parent_id) {
      replies.push(hydrated);
    } else {
      topLevel.push(hydrated);
    }
  }

  // Sort replies oldest-first inside each parent thread
  replies.sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const reply of replies) {
    const parent = reply.parent_id ? byId.get(reply.parent_id) : undefined;
    if (parent) {
      parent.replies.push(reply);
    } else {
      topLevel.push(reply);
    }
  }

  const totalCount =
    typeof postRow?.comments_count === 'number'
      ? Math.max(postRow.comments_count, commentRows.length)
      : commentRows.length;

  return json({ comments: topLevel, totalCount }, 200, {
    'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60',
  });
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  const { postId } = await context.params;
  if (!isUuid(postId)) {
    return json({ error: 'Invalid postId.' }, 400);
  }

  const body = (await req.json().catch(() => null)) as {
    content?: string;
    parent_id?: string | null;
  } | null;

  const content = (body?.content ?? '').trim();
  if (content.length < 1 || content.length > 500) {
    return json({ error: 'Comment must be between 1 and 500 characters.' }, 400);
  }

  const admin = getSupabaseAdmin();
  let parentId: string | null = body?.parent_id ? body.parent_id.trim() : null;

  if (parentId) {
    if (!isUuid(parentId)) {
      return json({ error: 'Invalid parent_id.' }, 400);
    }
    // Enforce 1-level nesting: if target parent is itself a reply, attach to its root comment
    const { data: parentRow } = await admin
      .from('post_comments')
      .select('id, parent_id, post_id')
      .eq('id', parentId)
      .maybeSingle();

    if (!parentRow || parentRow.post_id !== postId) {
      return json({ error: 'Parent comment not found.' }, 404);
    }
    parentId = (parentRow.parent_id as string | null) ?? (parentRow.id as string);
  }

  const { data: inserted, error } = await admin
    .from('post_comments')
    .insert({
      post_id: postId,
      user_id: auth.userId,
      parent_id: parentId,
      content,
    })
    .select('id, post_id, user_id, parent_id, content, likes_count, created_at')
    .single();

  if (error || !inserted) {
    return json({ error: error?.message ?? 'Could not post comment.' }, 500);
  }

  const { data: userRow } = await admin
    .from('users')
    .select('id, username, avatar_id, custom_avatar_url')
    .eq('id', auth.userId)
    .maybeSingle();

  const u = userRow as RawUserRow | null;
  const comment: HydratedComment = {
    ...(inserted as RawCommentRow),
    author: u
      ? {
          id: u.id,
          username: u.username,
          avatar_id: u.avatar_id ?? 'cyber_monk',
          avatar_url: u.custom_avatar_url ?? null,
        }
      : { ...FALLBACK_AUTHOR, id: auth.userId },
    replies: [],
  };

  return json({ comment }, 201);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ postId: string }> }
) {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  const { postId } = await context.params;
  const commentId = req.nextUrl.searchParams.get('commentId')?.trim() ?? '';
  if (!isUuid(postId) || !isUuid(commentId)) {
    return json({ error: 'Invalid post or comment ID.' }, 400);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('post_comments')
    .delete()
    .eq('id', commentId)
    .eq('post_id', postId)
    .eq('user_id', auth.userId)
    .select('id');

  if (error || !data || data.length === 0) {
    return json({ error: 'Could not delete comment.' }, 403);
  }

  return json({ ok: true, deletedId: commentId });
}
