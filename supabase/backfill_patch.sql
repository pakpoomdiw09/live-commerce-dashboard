-- Run only after schema_patch.sql completes successfully.
-- Each batch locks at most 500 matching rows, in primary-key order, and skips rows
-- currently locked by application queries. RowExclusive table locks remain compatible
-- with dashboard SELECTs; this patch contains no ALTER TABLE or table-wide lock.
set lock_timeout = '5s';

-- Backfill comment tenant IDs from Meta post IDs: "<page id>_<post id>".
do $$
declare
  updated_rows integer;
  retries integer := 0;
begin
  loop
    with batch as (
      select c.id,
        (
          select t.id
          from tenants t
          where t.page_id is not null
            and c.post_id like t.page_id || '\_%'
          order by t.id
          limit 1
        ) as tenant_id
      from comments c
      where c.tenant_id is null
        and exists (
          select 1
          from tenants t
          where t.page_id is not null
            and c.post_id like t.page_id || '\_%'
        )
      order by c.id
      for update of c skip locked
      limit 500
    )
    update comments c
    set tenant_id = batch.tenant_id
    from batch
    where c.id = batch.id;

    get diagnostics updated_rows = row_count;
    if updated_rows = 0 then
      exit when not exists (
        select 1
        from comments c
        where c.tenant_id is null
          and exists (
            select 1
            from tenants t
            where t.page_id is not null
              and c.post_id like t.page_id || '\_%'
          )
      );
      retries := retries + 1;
      if retries >= 600 then
        raise exception 'Timed out waiting for locked comments during tenant backfill';
      end if;
    else
      retries := 0;
    end if;
    perform pg_sleep(0.05);
  end loop;
end $$;

-- Backfill comment-rule tenant IDs from the Page IDs targeted by each rule.
do $$
declare
  updated_rows integer;
  retries integer := 0;
begin
  loop
    with batch as (
      select r.id,
        (
          select t.id
          from tenants t
          where t.page_id = any (r.page_ids)
          order by t.id
          limit 1
        ) as tenant_id
      from comment_rules r
      where r.tenant_id is null
        and exists (
          select 1
          from tenants t
          where t.page_id = any (r.page_ids)
        )
      order by r.id
      for update of r skip locked
      limit 500
    )
    update comment_rules r
    set tenant_id = batch.tenant_id
    from batch
    where r.id = batch.id;

    get diagnostics updated_rows = row_count;
    if updated_rows = 0 then
      exit when not exists (
        select 1
        from comment_rules r
        where r.tenant_id is null
          and exists (
            select 1
            from tenants t
            where t.page_id = any (r.page_ids)
          )
      );
      retries := retries + 1;
      if retries >= 600 then
        raise exception 'Timed out waiting for locked comment_rules during tenant backfill';
      end if;
    else
      retries := 0;
    end if;
    perform pg_sleep(0.05);
  end loop;
end $$;
