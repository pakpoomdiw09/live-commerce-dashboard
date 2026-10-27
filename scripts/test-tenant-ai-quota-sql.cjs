const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  { PGlite } = require('@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  try {
    const fixture = fs
      .readFileSync('scripts/test-smart-followups-sql.cjs', 'utf8')
      .split('await db.exec(`')[1]
      .split('`)')[0]
    await db.exec(fixture)
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    await db.exec('alter table bot_settings add column ai_instructions text')
    await db.exec(fs.readFileSync('supabase/agent-control.sql', 'utf8'))
    await db.exec(
      'alter table tenants add column ai_quota_limit integer default 1000;alter table tenants add column ai_quota_used integer default 0',
    )
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const existing = await one(
      'insert into tenants(ai_quota_limit,ai_quota_used) values(700,123) returning id',
    )
    const migration = fs.readFileSync('supabase/tenant-ai-quota.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    assert.equal(
      (await one('select ai_quota_used from tenants where id=$1', [existing.id])).ai_quota_used,
      123,
    )
    assert.equal(
      (await one('select ai_quota_limit from tenants where id=$1', [existing.id])).ai_quota_limit,
      700,
    )
    await db.exec('set role service_role')
    async function shop(limit = 1) {
      const id = (await one('insert into tenants(ai_quota_limit) values($1) returning id', [limit]))
        .id
      await db.query(
        'insert into agent_control_settings(tenant_id,flags,ai_monthly_limit) values($1,\'{"agent_orchestrator_enabled":true}\',0)',
        [id],
      )
      return id
    }
    async function inbound(tenant) {
      const customer = (
        await one('insert into customers(tenant_id) values($1) returning id', [tenant])
      ).id
      const message = (
        await one(
          "insert into messages(customer_id,sender,body) values($1,'customer','Question') returning id",
          [customer],
        )
      ).id
      return { tenant, customer, message }
    }
    const reserve = async (m) =>
      (await one('select reserve_tenant_ai_reply($1,$2,$3) r', [m.tenant, m.customer, m.message])).r
    const authorize = async (id) => (await one('select authorize_tenant_ai_reply($1) r', [id])).r
    const settle = async (id) => (await one('select settle_tenant_ai_reply($1) r', [id])).r
    const used = async (t) => (await one('select ai_quota_used n from tenants where id=$1', [t])).n
    const outgoing = async (m, status = 'pending', prefix = 'reply:') =>
      (
        await one(
          "insert into messages(customer_id,sender,body,external_id,delivery_status) values($1,'bot','Answer',$2,$3) returning id",
          [m.customer, prefix + m.message, status],
        )
      ).id
    const delivery = (id, status) =>
      db.query('update messages set delivery_status=$1 where id=$2', [status, id])

    const tenant = await shop(),
      a = await inbound(tenant),
      b = await inbound(tenant)
    const concurrent = await Promise.all([reserve(a), reserve(b)])
    assert.equal(concurrent.filter((r) => r.status === 'reserved').length, 1)
    assert.equal(concurrent.filter((r) => r.status === 'quota_exceeded').length, 1)
    assert.equal(await used(tenant), 0, 'LLM reservation does not charge a reply')
    const reserved = concurrent.find((r) => r.id),
      accepted = concurrent[0].id ? a : b,
      rejected = concurrent[0].id ? b : a
    const invocation = (
      await one('select start_agent_ai_call($1,$2,$3,null,null) r', [
        tenant,
        reserved.id,
        accepted.customer,
      ])
    ).r
    assert.ok(
      invocation.id,
      'a valid reply reservation uses the tenant budget instead of the old monthly ceiling',
    )
    assert.equal(
      (
        await one('select start_agent_ai_call($1,$2,$3,null,null) r', [
          tenant,
          reserved.id,
          accepted.customer,
        ])
      ).r.reason,
      'DUPLICATE_AI_INVOCATION',
    )
    assert.equal(
      (
        await one('select start_agent_ai_call($1,gen_random_uuid(),$2,null,null) r', [
          tenant,
          accepted.customer,
        ])
      ).r.reason,
      'AI_QUOTA_EXHAUSTED',
      'a random key cannot bypass the generation ceiling',
    )
    assert.equal(
      (
        await one('select handover_tenant_ai_quota($1,$2,$3) r', [
          tenant,
          rejected.customer,
          rejected.message,
        ])
      ).r,
      true,
    )
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [rejected.customer])).bot_enabled,
      false,
    )
    assert.equal(
      (
        await one('select reason from conversation_events where customer_id=$1', [
          rejected.customer,
        ])
      ).reason,
      'quota_exceeded',
    )
    assert.equal(await authorize(reserved.id), 'authorized')
    assert.equal(await authorize(reserved.id), 'blocked', 'authorization cannot be used twice')
    const sent = await outgoing(accepted)
    assert.equal(await used(tenant), 0)
    await delivery(sent, 'sent')
    assert.equal(await used(tenant), 1)
    await delivery(sent, 'sent')
    await delivery(sent, 'delivered')
    await delivery(sent, 'read')
    assert.equal(await settle(reserved.id), 'sent')
    assert.equal(await settle(reserved.id), 'sent')
    assert.equal(await used(tenant), 1, 'duplicate webhook/status/persistence never debits again')
    assert.equal((await reserve(await inbound(tenant))).status, 'quota_exceeded')

    const generationTenant = await shop(),
      generation = await inbound(generationTenant)
    const generationReservation = await reserve(generation)
    assert.equal(
      await settle(generationReservation.id),
      'released',
      'generation failure or model handoff returns the held slot',
    )
    assert.equal(await used(generationTenant), 0)
    assert.equal(
      (await reserve(generation)).status,
      'duplicate',
      'same source cannot generate or resend after failure',
    )
    assert.equal((await reserve(await inbound(generationTenant))).status, 'reserved')

    const refusalTenant = await shop(),
      refusal = await inbound(refusalTenant),
      refusalReservation = await reserve(refusal)
    await authorize(refusalReservation.id)
    const refused = await outgoing(refusal)
    await delivery(refused, 'failed')
    assert.equal(await settle(refusalReservation.id), 'released')
    assert.equal(await used(refusalTenant), 0)
    assert.equal((await reserve(await inbound(refusalTenant))).status, 'reserved')

    const unknownTenant = await shop(),
      unknown = await inbound(unknownTenant),
      unknownReservation = await reserve(unknown)
    await authorize(unknownReservation.id)
    const uncertain = await outgoing(unknown)
    await delivery(uncertain, 'unknown')
    assert.equal(await settle(unknownReservation.id), 'unknown')
    assert.equal(await used(unknownTenant), 0, 'unconfirmed delivery does not count as sent')
    assert.equal(
      (await reserve(await inbound(unknownTenant))).status,
      'quota_exceeded',
      'unknown outcomes retain capacity until reviewed',
    )
    await delivery(uncertain, 'delivered')
    assert.equal(await used(unknownTenant), 1, 'later confirmed delivery debits exactly once')

    const keywordTenant = await shop(),
      keyword = await inbound(keywordTenant)
    await outgoing(keyword, 'sent')
    await outgoing(keyword, 'sent', 'handover:reply:')
    assert.equal(await used(keywordTenant), 0, 'keyword and handover messages are not AI replies')
    assert.equal((await reserve(keyword)).status, 'duplicate')

    const changedTenant = await shop(2),
      changed = await inbound(changedTenant),
      changedReservation = await reserve(changed)
    await db.query('update tenants set ai_quota_limit=0 where id=$1', [changedTenant])
    assert.equal(
      await authorize(changedReservation.id),
      'quota_exceeded',
      'quota is checked again just before dispatch',
    )
    assert.equal(await settle(changedReservation.id), 'released')
    const cross = await inbound(await shop())
    assert.equal((await reserve({ ...cross, tenant: changedTenant })).status, 'blocked')
    assert.equal(
      (
        await one('select handover_tenant_ai_quota($1,$2,$3) r', [
          changedTenant,
          cross.customer,
          cross.message,
        ])
      ).r,
      false,
    )
    assert.equal(
      (await one('select bot_enabled from customers where id=$1', [cross.customer])).bot_enabled,
      true,
    )

    await db.exec('reset role')
    await db.exec(
      'grant update(ai_quota_limit,ai_quota_used) on tenants to authenticated;set role authenticated',
    )
    await assert.rejects(
      db.query('update tenants set ai_quota_used=0 where id=$1', [tenant]),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      db.query('select reserve_tenant_ai_reply($1,$2,$3)', [tenant, a.customer, a.message]),
      (e) => e.code === '42501',
    )
    await assert.rejects(
      db.query('select * from tenant_ai_reply_reservations'),
      (e) => e.code === '42501',
    )
    console.log(
      'PASS: tenant AI quota SQL: concurrency, sent-only debit, duplicate fencing, generation/refusal release, unknown delivery retention, Inbox handover, cross-tenant checks, existing balances and service-only access',
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
