const { test } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { PGlite } = require('@electric-sql/pglite')
test('inbound message persistence and window evidence commit together; signed backlog is repaired, bot/local messages cannot reopen windows', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;
   create table tenants(id uuid primary key,page_id text,is_active boolean default true);
   create table customers(id uuid primary key,tenant_id uuid,platform text,platform_user_id text);
   create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid,external_id text,sender text,created_at timestamptz);
   create table facebook_webhook_events(sequence bigint generated always as identity,page_id text,kind text,payload jsonb,created_at timestamptz);
   create table broadcast_messaging_events(tenant_id uuid,customer_id uuid,event_id text,page_id text,kind text,interacted_at timestamptz,primary key(tenant_id,event_id));`)
    const schema = fs.readFileSync('supabase/facebook-webhook-queue.sql', 'utf8')
    await db.exec(
      'create or replace function public.facebook_inbound_message_at' +
        schema
          .split('create or replace function public.facebook_inbound_message_at')[1]
          .split('revoke all on function public.facebook_inbound_message_at')[0],
    )
    const tenant = crypto.randomUUID(),
      customer = crypto.randomUUID(),
      at = Date.now() - 1000
    await db.query("insert into tenants values($1,'123',true)", [tenant])
    await db.query("insert into customers values($1,$2,'facebook','456')", [customer, tenant])
    const event = (mid) => ({
      sender: { id: '456' },
      recipient: { id: '123' },
      timestamp: at,
      message: { mid, text: 'hello' },
    })
    for (const mid of ['backlog', 'new'])
      await db.query(
        "insert into facebook_webhook_events(page_id,kind,payload,created_at) values('123','message',$1,now())",
        [JSON.stringify(event(mid))],
      )
    const insert = (mid, sender = 'customer') =>
      db.query(
        'insert into messages(customer_id,external_id,sender,created_at) values($1,$2,$3,$4)',
        [customer, mid, sender, new Date(at).toISOString()],
      )
    await insert('backlog')
    const sql = fs.readFileSync('supabase/broadcast-inbound-sync.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    assert.equal(
      (await db.query('select count(*)::int n from broadcast_messaging_events')).rows[0].n,
      1,
    )
    await insert('new')
    await insert('local-import')
    await insert('ai-response', 'bot')
    assert.equal(
      (await db.query('select count(*)::int n from broadcast_messaging_events')).rows[0].n,
      2,
    )
    await db.exec('begin')
    await insert('new')
    await db.exec('rollback')
    assert.equal(
      (await db.query('select count(*)::int n from broadcast_messaging_events')).rows[0].n,
      2,
    )
  } finally {
    await db.close()
  }
})
