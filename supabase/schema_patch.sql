-- Run after platform.sql. Keep this DDL patch separate from data backfills.
-- Run during a quiet period; lock_timeout prevents waiting DDL from queuing behind active traffic.
set lock_timeout = '5s';

alter table comments
  add column if not exists tenant_id uuid references tenants(id) on delete set null;
create index if not exists comments_tenant on comments (tenant_id, created_at desc);

alter table comment_rules
  add column if not exists tenant_id uuid references tenants(id) on delete cascade;
create index if not exists comment_rules_tenant on comment_rules (tenant_id);
