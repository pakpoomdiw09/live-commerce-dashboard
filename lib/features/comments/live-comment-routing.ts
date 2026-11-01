import { liveRuleCode, type CommentRule } from './comment-rules'

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
