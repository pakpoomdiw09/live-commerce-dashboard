const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

async function main() {
  const db = new PGlite()
  try {
    await db.exec(`
      create table tenants(id uuid primary key, page_id text unique);
      create table comments(id uuid primary key, tenant_id uuid, post_id text, created_at timestamptz default now());
      create table comment_rules(id uuid primary key, tenant_id uuid, page_ids text[]);
      create function pg_sleep(double precision) returns void
      language plpgsql as $$ begin return; end $$;
    `)

    const schema = fs.readFileSync('supabase/schema_patch.sql', 'utf8')
    const backfill = fs.readFileSync('supabase/backfill_patch.sql', 'utf8')
    const platform = fs.readFileSync('supabase/platform.sql', 'utf8')
    assert.doesNotMatch(
      platform,
      /alter table comments|alter table comment_rules|update comments|update comment_rules/i,
    )
    await db.exec(schema)
    await db.exec(schema)

    const tenantA = '11111111-1111-4111-8111-111111111111'
    const tenantB = '22222222-2222-4222-8222-222222222222'
    await db.query('insert into tenants(id,page_id) values($1,$2),($3,$4)', [
      tenantA,
      '100',
      tenantB,
      '200',
    ])
    for (let i = 1; i <= 1001; i++) {
      const suffix = String(i).padStart(12, '0')
      await db.query('insert into comments(id,post_id) values($1,$2)', [
        `00000000-0000-4000-8000-${suffix}`,
        `100_${i}`,
      ])
      await db.query('insert into comment_rules(id,page_ids) values($1,$2)', [
        `10000000-0000-4000-8000-${suffix}`,
        ['100'],
      ])
    }
    await db.query('insert into comments(id,tenant_id,post_id) values($1,$2,$3)', [
      '00000000-0000-4000-8000-999999999999',
      tenantB,
      '100_existing',
    ])
    await db.query('insert into comments(id,post_id) values($1,$2)', [
      '00000000-0000-4000-8000-999999999998',
      'unmatched',
    ])

    await db.exec(backfill)
    for (const table of ['comments', 'comment_rules']) {
      const mapped = await db.query(
        `select count(*)::int as total, count(tenant_id)::int as assigned from ${table}`,
      )
      assert.deepEqual(mapped.rows[0], {
        total: table === 'comments' ? 1003 : 1001,
        assigned: table === 'comments' ? 1002 : 1001,
      })
    }
    assert.equal(
      (await db.query('select tenant_id from comments where post_id=$1', ['100_existing'])).rows[0]
        .tenant_id,
      tenantB,
    )
    assert.equal(
      (await db.query('select tenant_id from comments where post_id=$1', ['unmatched'])).rows[0]
        .tenant_id,
      null,
    )
    await db.exec(backfill)
    console.log(
      'PASS: DDL/backfill split, >500-row batches, mapping, preserve-existing, unmatched, and reruns',
    )
  } finally {
    await db.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
