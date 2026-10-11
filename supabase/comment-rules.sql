-- Comment auto-reply rules. Run after schema.sql. Safe to re-run.

create table if not exists comment_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  page_ids text[] not null default '{}',          -- Facebook Page ids this rule runs on
  match_type text not null default 'keyword'
    check (match_type in ('exact', 'keyword')),   -- exact = whole comment, keyword = comment contains it
  keywords text[] not null default '{}',
  reply_enabled boolean not null default true,    -- public reply under the comment
  reply_text text,
  inbox_enabled boolean not null default false,   -- private reply in Messenger (one message per comment)
  inbox_type text not null default 'text' check (inbox_type in ('text', 'image')),
  inbox_text text,
  inbox_image_url text,                           -- public URL (Meta downloads it)
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists comment_rules_pages on comment_rules using gin (page_ids);

-- which rule answered a comment (also gives the per-rule usage count)
alter table comments add column if not exists rule_id uuid references comment_rules(id) on delete set null;
create index if not exists comments_rule on comments (rule_id);

-- policies: supabase/security.sql
alter table comment_rules enable row level security;

-- Public bucket for images sent by private reply: Meta must be able to fetch them without a login
insert into storage.buckets (id, name, public) values ('comment-media', 'comment-media', true) on conflict do nothing;
drop policy if exists staff_upload_comment_media on storage.objects;
create policy staff_upload_comment_media on storage.objects
  for insert to authenticated with check (bucket_id = 'comment-media');
