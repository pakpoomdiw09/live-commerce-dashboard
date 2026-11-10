const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto')

const ORDER_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'
const SLIP_ID = '44444444-4444-4444-8444-444444444444'
const REPLACEMENT_SLIP_ID = '55555555-5555-4555-8555-555555555555'
const ACTOR_ID = '66666666-6666-4666-8666-666666666666'

const db = new PGlite({ extensions: { pgcrypto } })

async function setupDatabase() {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create extension if not exists pgcrypto;

    create table public.orders (
      id uuid primary key,
      tenant_id uuid not null,
      customer_id uuid not null,
      amount numeric(12,2) not null,
      status text not null,
      source text not null,
      slip_id uuid,
      paid_at timestamptz
    );
    create table public.slips (
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      customer_id uuid not null,
      image_path text,
      expected_amount numeric(12,2),
      status text not null constraint slips_status_check
        check (status in ('pending','valid','amount_mismatch','duplicate','fake','wrong_receiver','error')),
      note text,
      approved_at timestamptz,
      approved_by uuid
    );
    create table public.auction_payment_proofs (
      order_id uuid primary key,
      tenant_id uuid not null,
      slip_id uuid not null unique,
      created_at timestamptz not null default clock_timestamp()
    );
  `)

  const latestSubmit = fs.readFileSync(
    path.resolve('supabase/migrations/20261110120000_auction_payment_proof_resubmission_limit.sql'),
    'utf8',
  )
  const reviewMigration = fs.readFileSync(
    path.resolve('supabase/migrations/20261110133000_auction_payment_proof_review.sql'),
    'utf8',
  )
  await db.exec(latestSubmit)
  await db.exec(reviewMigration)
}

async function resetFixture({ slipStatus = 'error', orderStatus = 'pending_payment', attempts = 1 } = {}) {
  await db.exec('truncate public.auction_payment_proofs, public.slips, public.orders')
  await db.query(
    `insert into public.orders (id,tenant_id,customer_id,amount,status,source)
     values ($1,$2,$3,25,$4,'live_auction')`,
    [ORDER_ID, TENANT_ID, CUSTOMER_ID, orderStatus],
  )
  await db.query(
    `insert into public.slips (id,tenant_id,customer_id,image_path,expected_amount,status)
     values ($1,$2,$3,'auction/test/current.jpg',25,$4)`,
    [SLIP_ID, TENANT_ID, CUSTOMER_ID, slipStatus],
  )
  await db.query(
    `insert into public.auction_payment_proofs (order_id,tenant_id,slip_id,submission_attempts)
     values ($1,$2,$3,$4)`,
    [ORDER_ID, TENANT_ID, SLIP_ID, attempts],
  )
}

function loadTypeScript(file, mocks) {
  const filename = path.resolve(file)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  })
  const module = { exports: {} }
  const localRequire = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier]
    return require(specifier)
  }
  const context = {
    Response,
    exports: module.exports,
    module,
    process,
    require: localRequire,
  }
  vm.runInNewContext(
    `(function (exports, require, module, __filename, __dirname) { ${outputText}\n})`,
    context,
    { filename },
  )(module.exports, localRequire, module, filename, path.dirname(filename))
  return module.exports
}

function supabaseAdapter({ role = 'owner', tenantId = TENANT_ID, actor = true, beforeRpc } = {}) {
  const state = { rpcCalls: 0 }
  const client = {
    from(table) {
      const filters = []
      const query = {
        select() {
          return query
        },
        eq(column, value) {
          filters.push([column, value])
          return query
        },
        async maybeSingle() {
          filters.forEach(([column]) => {
            if (!/^[a-z_]+$/.test(column)) throw new Error('Unexpected filter')
          })
          const where = filters.map(([column], index) => `"${column}" = $${index + 1}`).join(' and ')
          try {
            const result = await db.query(
              `select * from public."${table}" where ${where} limit 1`,
              filters.map(([, value]) => value),
            )
            return { data: result.rows[0] ?? null, error: null }
          } catch (error) {
            return { data: null, error: { code: error.code, message: error.message } }
          }
        },
      }
      return query
    },
    async rpc(name, args) {
      assert.equal(name, 'review_auction_payment_proof')
      state.rpcCalls += 1
      if (beforeRpc) await beforeRpc()
      try {
        const result = await db.query(
          `select public.review_auction_payment_proof($1,$2,$3,$4,$5) as result`,
          [args.p_order, args.p_tenant, args.p_slip, args.p_decision, args.p_actor],
        )
        return { data: result.rows[0].result, error: null }
      } catch (error) {
        return { data: null, error: { code: error.code, message: error.message } }
      }
    },
  }

  const route = loadTypeScript(
    'app/api/live-auction/orders/[id]/payment-proof/review/route.ts',
    {
      'next/server': {
        NextResponse: {
          json(body, options = {}) {
            return new Response(JSON.stringify(body), options)
          },
        },
      },
      '@/lib/auth': {
        getActor: async () => (actor ? { kind: 'user', id: ACTOR_ID, isPlatformAdmin: false } : null),
        canAccessTenant: async (_actor, targetTenant, required) => {
          const ranks = { staff: 1, owner: 2, admin: 3 }
          return targetTenant === tenantId && ranks[role] >= ranks[required]
        },
      },
      '@/lib/supabase/server': { supabaseAdmin: () => client },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/i },
    },
  )
  return { POST: route.POST, state }
}

async function post(decision, slipId = SLIP_ID, options = {}) {
  const { requestBody, ...routeOptions } = options
  const route = supabaseAdapter(routeOptions)
  const request = { json: async () => requestBody ?? ({ decision, slipId }) }
  const response = await route.POST(request, { params: Promise.resolve({ id: ORDER_ID }) })
  return { response, body: await response.json(), state: route.state }
}

test.before(setupDatabase)
test.after(async () => db.close())

test('same-tenant owner approval marks the slip and order paid atomically', async () => {
  await resetFixture({ slipStatus: 'valid' })
  const { response, body, state } = await post('approve')
  assert.equal(response.status, 200)
  assert.equal(body.review.decision, 'approve')
  assert.equal(body.review.status, 'paid')
  assert.equal(body.review.alreadyApplied, false)
  assert.equal(state.rpcCalls, 1)

  const { rows } = await db.query(
    `select order_row.status as order_status, order_row.slip_id, slip.status as slip_status,
            slip.approved_at, slip.approved_by
     from public.orders order_row join public.slips slip on slip.id = order_row.slip_id
     where order_row.id = $1`,
    [ORDER_ID],
  )
  assert.equal(rows[0].order_status, 'paid')
  assert.equal(rows[0].slip_id, SLIP_ID)
  assert.equal(rows[0].slip_status, 'valid')
  assert.ok(rows[0].approved_at)
  assert.equal(rows[0].approved_by, ACTOR_ID)
})

test('same-tenant owner rejection leaves order pending and allows resubmission below the attempt limit', async () => {
  await resetFixture({ slipStatus: 'error', attempts: 2 })
  const { response, body } = await post('reject')
  assert.equal(response.status, 200)
  assert.equal(body.review.decision, 'reject')
  assert.equal(body.review.status, 'rejected')
  assert.equal(body.review.submissionAttempts, 2)

  const { rows: rejected } = await db.query(
    `select order_row.status as order_status, proof.submission_attempts, slip.status as slip_status
     from public.orders order_row
     join public.auction_payment_proofs proof on proof.order_id = order_row.id
     join public.slips slip on slip.id = proof.slip_id
     where order_row.id = $1`,
    [ORDER_ID],
  )
  assert.equal(rejected[0].order_status, 'pending_payment')
  assert.equal(rejected[0].submission_attempts, 2)
  assert.equal(rejected[0].slip_status, 'rejected')

  const newImage = `auction/${TENANT_ID}/77777777-7777-4777-8777-777777777777`
  const submitted = await db.query('select public.submit_auction_payment_proof($1,$2) as slip_id', [
    ORDER_ID,
    newImage,
  ])
  assert.notEqual(submitted.rows[0].slip_id, SLIP_ID)
  const { rows: resubmitted } = await db.query(
    `select proof.slip_id, proof.submission_attempts, old_slip.status as prior_status
     from public.auction_payment_proofs proof
     join public.slips old_slip on old_slip.id = $2
     where proof.order_id = $1`,
    [ORDER_ID, SLIP_ID],
  )
  assert.equal(resubmitted[0].slip_id, submitted.rows[0].slip_id)
  assert.equal(resubmitted[0].submission_attempts, 3)
  assert.equal(resubmitted[0].prior_status, 'rejected')
})

test('unauthenticated and cross-tenant callers cannot review proof', async (t) => {
  await t.test('unauthenticated request is rejected', async () => {
    await resetFixture()
    const { response, state } = await post('approve', SLIP_ID, { actor: false })
    assert.equal(response.status, 401)
    assert.equal(state.rpcCalls, 0)
  })
  await t.test('cross-tenant caller gets a non-disclosing 404', async () => {
    await resetFixture()
    const { response, body, state } = await post('approve', SLIP_ID, { tenantId: OTHER_TENANT_ID })
    assert.equal(response.status, 404)
    assert.match(body.error, /not found/)
    assert.equal(state.rpcCalls, 0)
  })
  await t.test('staff without the owner review role is forbidden', async () => {
    await resetFixture()
    const { response, state } = await post('approve', SLIP_ID, { role: 'staff' })
    assert.equal(response.status, 403)
    assert.equal(state.rpcCalls, 0)
  })
  await t.test('tenant ID in the body is rejected instead of used for scope', async () => {
    await resetFixture()
    const { response, state } = await post('approve', SLIP_ID, {
      requestBody: { decision: 'approve', slipId: SLIP_ID, tenantId: OTHER_TENANT_ID },
    })
    assert.equal(response.status, 400)
    assert.equal(state.rpcCalls, 0)
  })
})

test('review endpoint rejects non-string and non-literal decisions before the RPC', async (t) => {
  for (const decision of [['approve'], { value: 'approve' }, new String('approve')]) {
    await t.test(`rejects ${typeof decision}`, async () => {
      await resetFixture()
      const { response, state } = await post('approve', SLIP_ID, {
        requestBody: { decision, slipId: SLIP_ID },
      })
      assert.equal(response.status, 400)
      assert.equal(state.rpcCalls, 0)
    })
  }
})

test('a slip replacement after preflight makes the submitted slip ID stale', async () => {
  await resetFixture({ slipStatus: 'valid' })
  const { response, body, state } = await post('approve', SLIP_ID, {
    beforeRpc: async () => {
      await db.query(
        `insert into public.slips (id,tenant_id,customer_id,image_path,expected_amount,status)
         values ($1,$2,$3,'auction/test/replacement.jpg',25,'error')`,
        [REPLACEMENT_SLIP_ID, TENANT_ID, CUSTOMER_ID],
      )
      await db.query('update public.auction_payment_proofs set slip_id = $1 where order_id = $2', [
        REPLACEMENT_SLIP_ID,
        ORDER_ID,
      ])
    },
  })
  assert.equal(response.status, 409)
  assert.match(body.error, /stale/)
  assert.equal(state.rpcCalls, 1)
  const { rows } = await db.query('select status, approved_at from public.slips where id = $1', [SLIP_ID])
  assert.equal(rows[0].status, 'valid')
  assert.equal(rows[0].approved_at, null)
})

test('conflicting approve then reject cannot overwrite the completed approval', async () => {
  await resetFixture({ slipStatus: 'valid' })
  const first = await post('approve')
  assert.equal(first.response.status, 200)
  const second = await post('reject')
  assert.equal(second.response.status, 409)
  const { rows } = await db.query(
    `select order_row.status as order_status, order_row.slip_id, slip.status as slip_status,
            slip.approved_at
     from public.orders order_row join public.slips slip on slip.id = $2
     where order_row.id = $1`,
    [ORDER_ID, SLIP_ID],
  )
  assert.equal(rows[0].order_status, 'paid')
  assert.equal(rows[0].slip_id, SLIP_ID)
  assert.equal(rows[0].slip_status, 'valid')
  assert.ok(rows[0].approved_at)
})

test('conflicting reject then approve cannot pay a rejected proof', async () => {
  await resetFixture({ slipStatus: 'valid' })
  const first = await post('reject')
  assert.equal(first.response.status, 200)
  const second = await post('approve')
  assert.equal(second.response.status, 409)
  const { rows } = await db.query(
    `select order_row.status as order_status, slip.status as slip_status, slip.approved_at
     from public.orders order_row join public.slips slip on slip.id = $2
     where order_row.id = $1`,
    [ORDER_ID, SLIP_ID],
  )
  assert.equal(rows[0].order_status, 'pending_payment')
  assert.equal(rows[0].slip_status, 'rejected')
  assert.equal(rows[0].approved_at, null)
})

test('legacy approval RPC delegates atomically and preserves its timestamp result', async () => {
  await resetFixture({ slipStatus: 'valid' })
  const { rows } = await db.query(
    'select public.approve_auction_payment_proof($1,$2,$3) as approved_at',
    [SLIP_ID, TENANT_ID, ACTOR_ID],
  )
  assert.ok(rows[0].approved_at)
  const paid = await db.query(
    `select order_row.status as order_status, order_row.slip_id,
            slip.status as slip_status, slip.approved_at, slip.approved_by
     from public.orders order_row join public.slips slip on slip.id = $2
     where order_row.id = $1`,
    [ORDER_ID, SLIP_ID],
  )
  assert.equal(paid.rows[0].order_status, 'paid')
  assert.equal(paid.rows[0].slip_id, SLIP_ID)
  assert.equal(paid.rows[0].slip_status, 'valid')
  assert.ok(paid.rows[0].approved_at)
  assert.equal(paid.rows[0].approved_by, ACTOR_ID)
})

test('legacy approval RPC cannot approve rejected or replaced slips', async (t) => {
  await t.test('rejected current slip conflicts', async () => {
    await resetFixture({ slipStatus: 'rejected' })
    await assert.rejects(
      db.query('select public.approve_auction_payment_proof($1,$2,$3)', [SLIP_ID, TENANT_ID, ACTOR_ID]),
      (error) => error.code === '55000',
    )
    const { rows } = await db.query('select status, paid_at from public.orders where id=$1', [ORDER_ID])
    assert.equal(rows[0].status, 'pending_payment')
    assert.equal(rows[0].paid_at, null)
  })

  await t.test('old slip ID no longer present in the proof row returns not found', async () => {
    await resetFixture({ slipStatus: 'rejected' })
    await db.query(
      `insert into public.slips (id,tenant_id,customer_id,image_path,expected_amount,status)
       values ($1,$2,$3,'auction/test/replacement.jpg',25,'error')`,
      [REPLACEMENT_SLIP_ID, TENANT_ID, CUSTOMER_ID],
    )
    await db.query('update public.auction_payment_proofs set slip_id=$1 where order_id=$2', [
      REPLACEMENT_SLIP_ID,
      ORDER_ID,
    ])
    await assert.rejects(
      db.query('select public.approve_auction_payment_proof($1,$2,$3)', [SLIP_ID, TENANT_ID, ACTOR_ID]),
      (error) => error.code === 'P0002',
    )
    const { rows } = await db.query('select status, paid_at from public.orders where id=$1', [ORDER_ID])
    assert.equal(rows[0].status, 'pending_payment')
    assert.equal(rows[0].paid_at, null)
  })
})

test('review RPC execution is denied to client roles and granted to service_role', async () => {
  const { rows } = await db.query(`
    select
      has_function_privilege('public', 'public.review_auction_payment_proof(uuid,uuid,uuid,text,uuid)', 'EXECUTE') as public_exec,
      has_function_privilege('anon', 'public.review_auction_payment_proof(uuid,uuid,uuid,text,uuid)', 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', 'public.review_auction_payment_proof(uuid,uuid,uuid,text,uuid)', 'EXECUTE') as authenticated_exec,
      has_function_privilege('service_role', 'public.review_auction_payment_proof(uuid,uuid,uuid,text,uuid)', 'EXECUTE') as service_exec
  `)
  assert.equal(rows[0].public_exec, false)
  assert.equal(rows[0].anon_exec, false)
  assert.equal(rows[0].authenticated_exec, false)
  assert.equal(rows[0].service_exec, true)
})

test('legacy approval RPC remains executable only by service_role', async () => {
  const { rows } = await db.query(`
    select
      has_function_privilege('public', 'public.approve_auction_payment_proof(uuid,uuid,uuid)', 'EXECUTE') as public_exec,
      has_function_privilege('anon', 'public.approve_auction_payment_proof(uuid,uuid,uuid)', 'EXECUTE') as anon_exec,
      has_function_privilege('authenticated', 'public.approve_auction_payment_proof(uuid,uuid,uuid)', 'EXECUTE') as authenticated_exec,
      has_function_privilege('service_role', 'public.approve_auction_payment_proof(uuid,uuid,uuid)', 'EXECUTE') as service_exec
  `)
  assert.equal(rows[0].public_exec, false)
  assert.equal(rows[0].anon_exec, false)
  assert.equal(rows[0].authenticated_exec, false)
  assert.equal(rows[0].service_exec, true)
})
