import { liveRuleCode, type CommentRule } from './comment-rules'

/** Specific comment rules accept either raw post IDs or Meta's pageId_postId form. */
export function commentRuleTargetsPost(
  rule: Pick<CommentRule, 'target_post_mode' | 'target_post_id'>,
  postIds: string[],
  pageId: string,
) {
  if ((rule.target_post_mode ?? 'all') === 'all') return true
  if (rule.target_post_mode !== 'specific' || !rule.target_post_id) return false
  const target = rule.target_post_id.trim()
  if (!/^\d{1,40}(?:_\d{1,40})?$/.test(target)) return false
  const [targetPage, targetPost] = target.includes('_') ? target.split('_') : ['', target]
  if (targetPage && targetPage !== pageId) return false
  return postIds.some((id) => id.split('_').at(-1) === targetPost)
}

/** A configured post is explicit scope; an unscoped rule requires Live evidence. */
export function liveRuleCandidates(
  rules: CommentRule[],
  text: string,
  postIds: string[],
  live: boolean,
) {
  return rules
    .filter(
      (r) =>
        r.mode === 'live_cf' &&
        r.is_active &&
        (r.live_post_id
          ? postIds.some((id) => id.split('_').at(-1) === r.live_post_id!.split('_').at(-1))
          : live),
    )
    .map((rule) => ({ rule, code: liveRuleCode(rule, text) }))
    .filter((m): m is { rule: CommentRule; code: string } => m.code !== null)
}

export function commentPostIds(value: Record<string, any>) {
  return [
    ...new Set(
      [value.post_id, value.video_id, value.live_video_id, value.video?.id, value.post?.id]
        .filter((id): id is string => typeof id === 'string' && /^\d+(?:_\d+)?$/.test(id))
        .flatMap((id) => [id, id.split('_').at(-1)!]),
    ),
  ]
}

/** Pass the observed ID that actually matched the rule, not an unrelated feed post ID. */
export function liveRulePostId(rule: Pick<CommentRule, 'live_post_id'>, ids: string[]) {
  if (!rule.live_post_id) return ids[0] ?? null
  return ids.find((id) => id.split('_').at(-1) === rule.live_post_id!.split('_').at(-1)) ?? null
}
