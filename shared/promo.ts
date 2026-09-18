// The promotional commitment, in numbers that can be counted rather than
// forecast.
//
// The temptation on a sponsor page is to print a projected impressions figure.
// We deliberately don't, and the reason is worth keeping written down:
// Upload-Post returns daily time series with no post counts anywhere in them,
// so there is no measured impressions-per-post rate to project from. Followers
// multiplied by posts is not impressions, and a media buyer who spots one
// invented number stops believing the measured ones next to it.
//
// What we can state is what the lineup has agreed to do: every host posts a
// set number of times before their slot and a set number of times afterwards
// with the clips we cut for them. That is a commitment, it is auditable, and
// it multiplies out to a large honest number.

export const POSTS_BEFORE_PER_SHOW = 4;
export const POSTS_AFTER_PER_SHOW = 4;
export const POSTS_PER_SHOW = POSTS_BEFORE_PER_SHOW + POSTS_AFTER_PER_SHOW;

/** Total promotional posts the lineup will run, given how many shows are on it. */
export function plannedPosts(shows: number): number {
  return Math.max(0, shows) * POSTS_PER_SHOW;
}

/**
 * Compact display for a count: 136 stays 136, 1,240 stays 1,240.
 * Kept here so the flyer and the admin view can never disagree.
 */
export function postsLabel(shows: number): string {
  return plannedPosts(shows).toLocaleString("en-US");
}
