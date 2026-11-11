-- Control whether automated invoices include signed checkout/slip links.
-- Slip verification in Messenger remains governed separately by auto_verify_enabled.
alter table public.tenants
  add column if not exists send_payment_link boolean not null default false;

grant select (send_payment_link) on public.tenants to authenticated;
