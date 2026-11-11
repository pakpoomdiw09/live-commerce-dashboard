-- Normalize legacy nullable columns before enforcing the default-off rule.
alter table public.tenants
  add column if not exists send_payment_link boolean;

update public.tenants
set send_payment_link = false
where send_payment_link is null;

alter table public.tenants
  alter column send_payment_link set default false,
  alter column send_payment_link set not null;

grant select (send_payment_link) on public.tenants to authenticated;
