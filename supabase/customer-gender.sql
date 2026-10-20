-- Optional customer-provided profile information. Existing records remain unknown.
begin;
alter table public.customers add column if not exists gender text;
comment on column public.customers.gender is 'Customer-provided gender: male / female; NULL or other values are unspecified in overview. Never infer from name or avatar.';
commit;
