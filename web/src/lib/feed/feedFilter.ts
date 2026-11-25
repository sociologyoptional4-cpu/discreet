// Living posts (sandboxed iframe animations) are kept out of the swipe feed: they hurt scroll smoothness.
export const isFeedPlayable = (post: { post_format?: string | null }): boolean => post.post_format !== 'living_post';

export const feedPlayable = <T extends { post_format?: string | null }>(posts: readonly T[]): T[] => posts.filter(isFeedPlayable);
