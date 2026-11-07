-- Apply after live-cf-customer-variants.sql and live-session-dashboard.sql.
-- Persist the observed post before BEFORE INSERT billing triggers execute.
-- Patch the installed function without changing historical migration checksums.
begin;
do $$
declare definition text;
begin
 definition:=pg_get_functiondef('public.place_cf_order(uuid,uuid,uuid,text,text,text,text)'::regprocedure);
 -- customer-tabs.sql already appends the observed post to this INSERT.
 if position('live_variant_selection_required,live_post_id)' in definition)>0
  and position(',p_post) returning id' in definition)>0 then return;end if;
 definition:=replace(definition,'live_rule_id,live_bank_account_id,','live_rule_id,live_post_id,live_bank_account_id,');
 definition:=replace(definition,'lower(trim(p_code)),r.id,r.live_bank_account_id,','lower(trim(p_code)),r.id,p_post,r.live_bank_account_id,');
 if position('live_rule_id,live_post_id,live_bank_account_id,' in definition)=0
  or position('lower(trim(p_code)),r.id,p_post,r.live_bank_account_id,' in definition)=0 then
  raise exception 'Unrecognized Live CF order insertion; no changes applied';
 end if;
 execute definition;
end $$;
notify pgrst,'reload schema';
commit;
