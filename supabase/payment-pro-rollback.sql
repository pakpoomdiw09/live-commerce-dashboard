-- Non-destructive rollback. Apply only with the database owner's authorization.
-- Disables Pro for every shop; preserves flags, proofs, ledgers, credits, orders and audit history.
-- Never drop proof guards or delete a permanent ledger to "undo" an accepted payment.
begin;
update public.payment_pro_settings set enabled=false where enabled;
notify pgrst,'reload schema';
commit;
