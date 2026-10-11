-- Tenants: each one receives payments into its own account. Run after schema.sql. Safe to re-run.

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  bank_code text not null,                        -- e.g. KBANK, SCB, BBL, PROMPTPAY
  account_number text not null
    check (account_number ~ '^[0-9]+$'),          -- digits only; for PROMPTPAY the phone / national id
  created_at timestamptz not null default now()
);

-- set null, not cascade: deleting a tenant must not delete the slips kept as evidence
alter table slips add column if not exists tenant_id uuid references tenants(id) on delete set null;
create index if not exists slips_tenant on slips (tenant_id, created_at desc);

-- policies: supabase/security.sql (the API writes with the service role)
alter table tenants enable row level security;
