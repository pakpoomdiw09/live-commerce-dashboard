const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { fixture } = require('./helpers/auction-hardening-db.cjs')
const { build } = require('./build-full-database-setup.cjs')

const root = process.cwd()
const migrationPath = path.join(root, 'supabase', 'rpc-execution-hardening.sql')
const migration = fs.readFileSync(migrationPath, 'utf8')
const groupC = new Set([
  'can_access_tenant(uuid)',
  'can_manage_bank_accounts(uuid)',
  'can_manage_image_rules(uuid)',
  'has_tenant_feature(uuid,text)',
  'is_platform_admin()',
])
const approvedTriggerSignatures = new Set([
  'cancel_paid_follow_ups()',
  'commerce_product_quota()',
  'on_order_status()',
  'schedule_follow_ups()',
])
const restrictedSignatures = Array.from(
  migration.matchAll(/revoke all on function (public\.[^\r\n;]+?) from public, anon, authenticated;/gi),
  (match) => match[1].replace(/^public\./, ''),
)
const grantSignatures = Array.from(
  migration.matchAll(/grant execute on function (public\.[^\r\n;]+?) to service_role;/gi),
  (match) => match[1].replace(/^public\./, ''),
)

async function catalog(db) {
  return (await db.query(`
    SELECT
      p.oid::regprocedure AS function_signature,
      p.prosecdef AS is_security_definer,
      has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
      has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname, function_signature
  `)).rows
}

test('forward migration contains explicit privilege statements and is last in the registry', () => {
  assert.equal(build().sources.at(-1), 'rpc-execution-hardening.sql')
  assert.equal(restrictedSignatures.length, 138)
  assert.deepEqual([...grantSignatures].sort(), [...restrictedSignatures].sort())
  assert.equal(new Set(restrictedSignatures).size, restrictedSignatures.length)
  assert.doesNotMatch(migration, /\bdrop\s+function\b/i)
  assert.doesNotMatch(migration, /\bcreate\s+(?:or\s+replace\s+)?function\b/i)
})

test('anon and authenticated receive SQLSTATE 42501 on every restricted overload', async () => {
  const f = await fixture()
  try {
    assert.equal(restrictedSignatures.length, 138)
    const functions = (await f.db.query(`
      SELECT p.proname,
        p.oid::regprocedure::text AS function_signature,
        ARRAY(
          SELECT format_type(arg_oid, NULL)
          FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS args(arg_oid, ord)
          ORDER BY ord
        ) AS argument_types
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
      ORDER BY p.proname, function_signature
    `, [restrictedSignatures])).rows
    assert.equal(functions.length, restrictedSignatures.length, 'every explicit signature resolves in the migrated schema')

    const expected = (await f.db.query(`
      SELECT p.oid::regprocedure::text AS function_signature,
        p.prosecdef AS is_security_definer,
        p.prorettype = 'trigger'::regtype AS is_trigger,
        p.proargnames AS argument_names
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    `)).rows
      .filter((fn) => {
        const name = fn.function_signature.slice(0, fn.function_signature.indexOf('('))
        const identityArgs = fn.argument_names?.some((arg) => arg === 'p_actor' || arg === 'p_tenant')
        const groupCFunction = [...groupC].some((signature) => signature.startsWith(`${name}(`))
        return (fn.is_security_definer || identityArgs) && !groupCFunction &&
          (!fn.is_trigger || approvedTriggerSignatures.has(fn.function_signature))
      })
      .map((fn) => fn.function_signature)
      .sort()
    assert.deepEqual([...restrictedSignatures].sort(), expected, 'the migration covers every SECURITY DEFINER or caller-identity RPC overload')

    await f.db.exec(`create function public.test_rpc_default_acl_probe() returns integer
      language sql as $$ select 1 $$`)
    const defaultProbe = await f.one(`
      SELECT has_function_privilege('anon', 'public.test_rpc_default_acl_probe()', 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', 'public.test_rpc_default_acl_probe()', 'EXECUTE') AS auth_exec
    `)
    assert.equal(defaultProbe.anon_exec, false, 'new postgres-owned public functions do not grant EXECUTE to anon')
    assert.equal(defaultProbe.auth_exec, false, 'new postgres-owned public functions do not grant EXECUTE to authenticated')

    for (const role of ['anon', 'authenticated']) {
      let denied = 0
      for (const fn of functions) {
        await f.db.query(`set role ${role}`)
        try {
          const args = fn.argument_types.map((type) => `null::${type}`).join(', ')
          const call = `select public.${fn.proname}(${args})`
          await assert.rejects(f.db.query(call), (error) => error.code === '42501')
          denied++
        } finally {
          await f.db.query('reset role')
        }
      }
      console.log(`# ${role}: ${denied}/${functions.length} restricted overload calls rejected with SQLSTATE 42501; RESET ROLE ran after each call`)
    }

    const effective = await f.db.query(`
      SELECT p.oid::regprocedure::text AS function_signature,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
    `, [restrictedSignatures])
    assert.equal(effective.rows.length, restrictedSignatures.length)
    for (const row of effective.rows) {
      assert.equal(row.anon_exec, false, row.function_signature)
      assert.equal(row.auth_exec, false, row.function_signature)
      assert.equal(row.service_role_exec, true, row.function_signature)
    }
    console.log(`# service_role: EXECUTE remains granted on all ${effective.rows.length} restricted overloads; postgres function defaults exclude PUBLIC/anon/authenticated`)
  } finally {
    await f.db.close()
  }
})

test('Group C stays executable through authenticated RLS and service_role with auth.uid() NULL', async () => {
  const f = await fixture()
  try {
    const userId = randomUUID()
    await f.db.query('insert into auth.users(id,email) values($1,$2)', [userId, 'rpc-audit@example.invalid'])
    await f.db.query("insert into tenant_members(tenant_id,user_id,role) values($1,$2,'owner')", [f.tenant, userId])
    await f.db.query("select set_config('test.user',$1,false)", [userId])

    await f.db.query('set role authenticated')
    try {
      const rls = await f.db.query('select id from public.tenants where id=$1', [f.tenant])
      assert.equal(rls.rows.length, 1, 'the authenticated tenant policy still runs through Group C')
      assert.equal((await f.one('select public.can_access_tenant($1) allowed', [f.tenant])).allowed, true)
      await f.one('select public.can_manage_bank_accounts($1) allowed', [f.tenant])
      await f.one('select public.can_manage_image_rules($1) allowed', [f.tenant])
      await f.one("select public.has_tenant_feature($1,'customer_management') allowed", [f.tenant])
      await f.one('select public.is_platform_admin() allowed')
    } finally {
      await f.db.query('reset role')
    }

    await f.db.query("select set_config('test.user','',false)")
    await f.db.query('set role service_role')
    try {
      assert.equal((await f.one('select public.can_access_tenant($1) allowed', [f.tenant])).allowed, false)
      assert.equal((await f.one('select public.can_manage_bank_accounts($1) allowed', [f.tenant])).allowed, false)
      assert.equal((await f.one('select public.can_manage_image_rules($1) allowed', [f.tenant])).allowed, false)
      await f.one("select public.has_tenant_feature($1,'customer_management') allowed", [f.tenant])
      assert.equal((await f.one('select public.is_platform_admin() allowed')).allowed, false)
    } finally {
      await f.db.query('reset role')
    }

    const privileges = (await f.db.query(`
      SELECT p.oid::regprocedure::text AS function_signature,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.oid::regprocedure::text = ANY($1::text[])
    `, [[...groupC]])).rows
    assert.equal(privileges.length, groupC.size)
    for (const row of privileges) {
      assert.equal(row.anon_exec, false, row.function_signature)
      assert.equal(row.auth_exec, true, row.function_signature)
      assert.equal(row.service_role_exec, true, row.function_signature)
    }
    console.log('# Group C: authenticated RLS path passes; all 5 helpers execute for service_role with auth.uid() NULL')
  } finally {
    await f.db.close()
  }
})

test('live auction processing, confirmation, finalization, and expiry work through service_role', async () => {
  const f = await fixture()
  try {
    const auction = await f.open()
    await f.db.query('set role service_role')
    try {
      const bid = await f.receive(auction, '901', '200')
      assert.equal(bid.result.status, 'accepted')
      const close = await f.receive(auction, '999', 'close')
      assert.equal(close.result.status, 'awaiting_confirmation')
      const confirmation = await f.receive(auction, '901', 'confirm')
      assert.equal(confirmation.result.status, 'confirmed')
      assert.equal((await f.one('select count(*)::int n from orders where source_id=$1', [auction.id])).n, 1)

      const due = await f.open()
      await f.db.query("update auctions set ends_at=clock_timestamp()-interval '1 second' where id=$1", [due.id])
      const expiry = await f.one('select public.expire_live_auctions_report(null) report')
      assert.equal(expiry.report.closed, 1)
      assert.equal(expiry.report.failed, 0)
      assert.equal((await f.one('select public.expire_live_auctions(null) closed')).closed, 0)
      console.log('# service_role pipeline: bid -> host close -> winner confirmation/order and expiry report completed')
    } finally {
      await f.db.query('reset role')
    }
  } finally {
    await f.db.close()
  }
})

test('after.json has no unallowlisted SECURITY DEFINER function executable by anon or authenticated', async () => {
  const f = await fixture()
  try {
    const live = await catalog(f.db)
    const afterPath = path.join(root, 'reports', 'auction-audit', 'rpc-privileges', 'after.json')
    const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'))
    assert.deepEqual(after, live, 'after.json is the pg_proc snapshot from the fully migrated local schema')
    const leaked = after.filter(
      (fn) => fn.is_security_definer && (fn.anon_exec || fn.auth_exec) && !groupC.has(fn.function_signature),
    )
    assert.deepEqual(leaked, [])
    console.log(`# SECURITY DEFINER allow-list regression: ${after.length} functions checked; only the 5 Group C signatures retain authenticated EXECUTE`)
  } finally {
    await f.db.close()
  }
})
