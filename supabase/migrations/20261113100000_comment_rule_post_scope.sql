begin;

alter table public.comment_rules
  add column if not exists target_post_mode text not null default 'all',
  add column if not exists target_post_id text,
  add column if not exists target_post_title text;

alter table public.comment_rules
  drop constraint if exists comment_rules_target_post_scope_check;

alter table public.comment_rules
  add constraint comment_rules_target_post_scope_check
  check (
    (target_post_mode = 'all' and target_post_id is null)
    or (
      target_post_mode = 'specific'
      and target_post_id ~ '^[0-9]{1,40}(_[0-9]{1,40})?$'
    )
  );

create index if not exists comment_rules_tenant_specific_post
  on public.comment_rules (tenant_id, target_post_id)
  where is_active and target_post_mode = 'specific';

comment on column public.comment_rules.target_post_mode is
  'Whether a general comment reply rule applies to every Page post or one selected post.';
comment on column public.comment_rules.target_post_id is
  'Selected Facebook post ID; accepts raw post ID or pageId_postId form.';
comment on column public.comment_rules.target_post_title is
  'Optional human-readable preview for the selected Facebook post.';

notify pgrst, 'reload schema';

commit;
