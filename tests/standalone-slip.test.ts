import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import type { SlipResult } from '../lib/features/slips/slipok'
import { standaloneSlipReply, validateStandaloneSlip } from '../lib/features/slips/standalone-slip'

const now = Date.now()
const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenant = '22222222-2222-4222-8222-222222222222'
const account = { bank_code: 'KBANK', account_number: '1234567890', is_active: true }
function proof(patch: Partial<SlipResult> = {}): SlipResult {
  return {
    verdict: 'valid',
    amount: 159.25,
    transRef: 'bank-ref-1',
    receiverBank: '004',
    receiverAccount: '123xxx7890',
    raw: {
      success: true,
      data: {
        success: true,
        transTimestamp: new Date(now - 60_000).toISOString(),
        sendingBank: '006',
        sender: { displayName: 'ผู้โอนทดสอบ' },
        receiver: { displayName: 'ร้านทดสอบ' },
      },
    },
    ...patch,
  }
}

test('standalone validation and Messenger summary contain verified amount, sender, Bangkok time and reference', () => {
  const result = validateStandaloneSlip(proof(), [account], { now })
  assert.equal(result.success, true)
  if (!result.success) return
  assert.equal(result.data.amount, 159.25)
  assert.equal(result.data.sender, 'ผู้โอนทดสอบ')
  assert.equal(result.data.senderBank, '006')
  const reply = standaloneSlipReply(result)
  for (const text of ['159.25', 'ผู้โอนทดสอบ', 'bank-ref-1', 'เวลาที่โอน'])
    assert.ok(reply.includes(text))
  assert.ok(
    reply.includes(
      new Date(result.data.transTimestamp).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }),
    ),
  )
})

test('standalone age guard accepts exactly 24 hours and rejects older, missing or future timestamps', () => {
  for (const [offset, accepted] of [
    [-86_400_000, true],
    [-86_400_001, false],
    [60_000, true],
    [60_001, false],
  ] as const) {
    const result = validateStandaloneSlip(
      proof({ raw: { data: { transTimestamp: new Date(now + offset).toISOString() } } }),
      [account],
      { now },
    )
    assert.equal(result.success, accepted, `offset=${offset}`)
  }
  for (const raw of [{}, { data: { transTimestamp: 'invalid' } }])
    assert.equal(validateStandaloneSlip(proof({ raw }), [account], { now }).success, false)
  assert.equal(validateStandaloneSlip(proof(), [account], { maxAgeHours: 25, now }).success, false)
  const expired = validateStandaloneSlip(
    proof({ raw: { data: { transTimestamp: new Date(now - 86_400_001).toISOString() } } }),
    [account],
    { now },
  )
  assert.ok(standaloneSlipReply(expired).includes('24 ชั่วโมง'))
})

test('receiver matching supports masked accounts and branch 1014 but never accepts the wrong bank/account', () => {
  assert.equal(
    validateStandaloneSlip(proof({ receiverBank: '014' }), [account], { now }).success,
    false,
  )
  assert.equal(
    validateStandaloneSlip(proof({ receiverAccount: '999xxx7890' }), [account], { now }).success,
    false,
  )
  const branch = proof({ verdict: 'wrong_receiver', branchReceiverMismatch: true })
  assert.equal(validateStandaloneSlip(branch, [account], { now }).success, true)
  assert.equal(validateStandaloneSlip(branch, [], { now }).success, false)
  assert.equal(
    validateStandaloneSlip(proof(), [], { expectedReceivingAccount: '123-456-7890', now }).success,
    true,
  )
  assert.equal(
    validateStandaloneSlip(proof(), [], { now }).success,
    true,
    'receiver is optional when none is configured',
  )
  assert.equal(
    validateStandaloneSlip(proof({ receiverAccount: 'xxxxxxx890' }), [], {
      expectedReceivingAccount: '1234567890',
      now,
    }).success,
    true,
  )
})

test('provider duplicate, outage, fake proof and malformed financial evidence never pass', () => {
  for (const patch of [
    { verdict: 'duplicate' as const },
    { verdict: 'fake' as const },
    { providerFault: true },
    { transRef: '' },
    { amount: NaN },
    { amount: 0 },
    { amount: -1 },
    { amount: 0.001 },
  ])
    assert.equal(validateStandaloneSlip(proof(patch), [account], { now }).success, false)
  const duplicate = validateStandaloneSlip(proof({ verdict: 'duplicate' }), [account], { now })
  assert.equal(duplicate.message, 'สลิปนี้เคยส่งตรวจแล้ว')
})

const require = createRequire(import.meta.url)
const load = require('../scripts/helpers/load-typescript.cjs')
function verifierFixture(
  options: {
    result?: SlipResult
    priorImage?: boolean
    ledgerError?: string
    insertError?: string
    credit?: boolean
    throwProvider?: boolean
    disabledAccounts?: boolean
    noAccounts?: boolean
  } = {},
) {
  const calls = {
    provider: 0,
    consume: 0,
    refund: 0,
    download: 0,
    writes: [] as Record<string, unknown>[],
    tables: [] as string[],
  }
  const db = {
    from(table: string) {
      calls.tables.push(table)
      let insert = false
      const q = {
        select() {
          return this
        },
        eq() {
          return this
        },
        limit() {
          return this
        },
        insert(value: Record<string, unknown>) {
          insert = true
          calls.writes.push(value)
          return this
        },
        maybeSingle: async () =>
          table === 'tenants'
            ? { data: { id: tenantId, account_number: null, bank_code: null }, error: null }
            : {
                data: options.priorImage ? { id: 'accepted-proof' } : null,
                error: options.ledgerError ? { code: options.ledgerError } : null,
              },
        single: async () => ({
          data: { id: 'saved-slip' },
          error: insert && options.insertError ? { code: options.insertError } : null,
        }),
        then(resolve: (result: object) => unknown, reject: (error: unknown) => unknown) {
          return Promise.resolve({
            data:
              table === 'bank_accounts'
                ? options.noAccounts
                  ? []
                  : [{ ...account, is_active: !options.disabledAccounts }]
                : null,
            error: insert && options.insertError ? { code: options.insertError } : null,
          }).then(resolve, reject)
        },
      }
      return q
    },
    rpc: async (name: string) => {
      if (name === 'consume_slip_credit') {
        calls.consume++
        return { data: options.credit !== false, error: null }
      }
      assert.equal(name, 'refund_slip_credit')
      calls.refund++
      return { data: null, error: null }
    },
  }
  const file = new File([new Uint8Array([137, 80, 78, 71])], 'proof.png', { type: 'image/png' })
  const api = load(
    'lib/features/slips/standalone-verifier.ts',
    {
      'server-only': {},
      'node:crypto': { createHash },
      '@/lib/feature-access': { requireFeature: async () => {} },
      '@/lib/features/slips/slipok': {
        slipVerificationProvider: () => 'slipok',
        usesCentralZwizQuota: () => false,
        verifyWithSlipOK: async (input: { log: boolean; expectedAmount?: unknown }) => {
          calls.provider++
          assert.equal(input.log, true)
          assert.equal(input.expectedAmount, undefined)
          if (options.throwProvider) throw new Error('Network timeout')
          return options.result ?? proof()
        },
      },
      '@/lib/features/vision/vision-image': {
        downloadVisionImage: async () => {
          calls.download++
          return file
        },
        validateVisionFile: async () => {},
      },
      '@/lib/features/slips/standalone-slip': {
        standaloneDuplicate: () => ({
          success: false,
          reason: 'duplicate',
          message: 'สลิปนี้เคยส่งตรวจแล้ว',
        }),
        standaloneFailure: (reason: string, message: string) => ({
          success: false,
          reason,
          message,
        }),
        validateStandaloneSlip,
      },
    },
    { Buffer, console: { error() {}, info() {} } },
  )
  return {
    calls,
    run: () =>
      api.processStandaloneSlip(db, {
        tenantId,
        slipImageUrl: 'https://scontent.fbcdn.net/proof.png',
      }),
  }
}

test('standalone processor stores only a standalone ledger row and never touches orders, stock or customer payment state', async () => {
  const f = verifierFixture()
  assert.equal((await f.run()).success, true)
  assert.equal(f.calls.consume, 1)
  assert.equal(f.calls.provider, 1)
  assert.equal(f.calls.refund, 0)
  assert.equal(f.calls.writes.length, 1)
  assert.equal(f.calls.writes[0].tenant_id, tenantId)
  assert.equal(f.calls.writes[0].trans_ref, 'bank-ref-1')
  assert.equal(f.calls.writes[0].sender_name, 'ผู้โอนทดสอบ')
  assert.ok(!f.calls.tables.some((table) => ['orders', 'products', 'customers'].includes(table)))
})

test('accepted photo replay and missing migration stop before provider calls or credit charges', async () => {
  for (const settings of [
    { priorImage: true },
    { ledgerError: 'PGRST205' },
    { credit: false },
    { disabledAccounts: true },
  ]) {
    const f = verifierFixture(settings)
    assert.equal((await f.run()).success, false)
    assert.equal(f.calls.provider, 0)
    assert.equal(f.calls.writes.length, 0)
  }
})

test('23505 is reported clearly and ledger write errors cannot produce a success receipt', async () => {
  const duplicate = await verifierFixture({ insertError: '23505' }).run()
  assert.equal(duplicate.success, false)
  assert.equal(duplicate.message, 'สลิปนี้เคยส่งตรวจแล้ว')
  const failed = await verifierFixture({ insertError: 'DB_DOWN' }).run()
  assert.equal(failed.success, false)
  assert.ok(failed.message.includes('ไม่ต้องโอนซ้ำ'))
})

test('provider faults refund one credit; rejected or expired customer proofs are not saved', async () => {
  for (const settings of [{ result: proof({ providerFault: true }) }, { throwProvider: true }]) {
    const f = verifierFixture(settings)
    assert.equal((await f.run()).success, false)
    assert.equal(f.calls.refund, 1)
    if (settings.throwProvider) assert.equal(f.calls.writes.length, 0)
    else {
      assert.equal(f.calls.writes.length, 1)
      assert.equal(f.calls.writes[0].status, 'error')
    }
  }
  for (const result of [
    proof({ verdict: 'fake' }),
    proof({ raw: { data: { transTimestamp: new Date(now - 2 * 86_400_000).toISOString() } } }),
  ]) {
    const f = verifierFixture({ result })
    assert.equal((await f.run()).success, false)
    assert.equal(f.calls.refund, 0)
    assert.equal(f.calls.writes.length, 0)
  }
})

async function ledgerDatabase(minimalTable = false) {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
    create table tenants(id uuid primary key,is_active boolean default true);
    create table tenant_members(tenant_id uuid,user_id uuid);
    create table customers(id uuid primary key,tenant_id uuid);
    create table messages(id uuid primary key,customer_id uuid);
    create function public.can_access_tenant(p_tenant uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
      select exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid())
    $$;
    grant usage on schema public,auth to authenticated,service_role;
  `)
  const payments = require('../scripts/lib/safe-db-migration.cjs').splitSql(
    await readFile('supabase/payments.sql', 'utf8'),
  ) as string[]
  for (const prefix of [
    'create table if not exists public.payment_transfer_ledger',
    'create or replace function public.claim_payment_transfer',
  ])
    await db.exec(payments.find((sql) => sql.startsWith(prefix))! + ';')
  await db.query('insert into tenants(id) values($1),($2)', [tenantId, otherTenant])
  if (minimalTable) {
    await db.exec(`create table standalone_slips(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,trans_ref text not null,
      amount numeric(12,2) not null,sender_name text,sender_bank text,receiver_name text,
      receiver_account text,trans_timestamp timestamptz not null,raw_payload jsonb,created_at timestamptz default now(),
      unique(tenant_id,trans_ref)
    )`)
    await db.query(
      "insert into standalone_slips(tenant_id,trans_ref,amount,trans_timestamp) values($1,'existing-proof',159,now())",
      [tenantId],
    )
  }
  const sql = await readFile('supabase/standalone-slips.sql', 'utf8')
  await db.exec(sql)
  await db.exec(sql)
  const insert = (scope: string, ref: string, hash?: string) =>
    db.query(
      `
    insert into standalone_slips(tenant_id,trans_ref,amount,trans_timestamp,raw_payload,image_sha256)
    values($1,$2,159.25,now(),'{}',$3) returning id`,
      [scope, ref, hash ?? null],
    )
  return { db, insert }
}

test('standalone migration upgrades the pasted minimal schema and retains existing proofs in the shared ledger', async () => {
  const { db, insert } = await ledgerDatabase(true)
  try {
    const row = await db.query<{ source: string }>(
      "select source from payment_transfer_ledger where trans_ref='existing-proof'",
    )
    assert.equal(row.rows[0].source, 'standalone')
    await assert.rejects(
      db.query("select claim_payment_transfer('existing-proof','sale',gen_random_uuid())"),
      (e: unknown) => (e as { code: string }).code === '23505',
    )
    await insert(tenantId, 'new-proof', 'a'.repeat(64))
  } finally {
    await db.close()
  }
})

test('standalone SQL is rerunnable and concurrent duplicate references have only one accepted ledger entry', async () => {
  const { db, insert } = await ledgerDatabase()
  try {
    const results = await Promise.allSettled([
      insert(tenantId, 'shared-ref'),
      insert(tenantId, 'shared-ref'),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    assert.equal(rejected.reason.code, '23505')
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from standalone_slips'))
        .rows[0].count,
      1,
    )
    assert.equal(
      (await db.query<{ count: number }>('select count(*)::int count from payment_transfer_ledger'))
        .rows[0].count,
      1,
    )
  } finally {
    await db.close()
  }
})

test('standalone transfers cannot be replayed across shops or sale/package flows, even after deleting the source row', async () => {
  const { db, insert } = await ledgerDatabase()
  try {
    await insert(tenantId, 'standalone-first')
    await assert.rejects(
      insert(otherTenant, 'standalone-first'),
      (e: unknown) => (e as { code: string }).code === '23505',
    )
    for (const source of ['sale', 'package', 'billing']) {
      await assert.rejects(
        db.query('select claim_payment_transfer($1,$2,gen_random_uuid())', [
          'standalone-first',
          source,
        ]),
        (e: unknown) => (e as { code: string }).code === '23505',
      )
      await db.query('select claim_payment_transfer($1,$2,gen_random_uuid())', [
        `${source}-first`,
        source,
      ])
      await assert.rejects(
        insert(tenantId, `${source}-first`),
        (e: unknown) => (e as { code: string }).code === '23505',
      )
    }
    await db.query("delete from standalone_slips where trans_ref='standalone-first'")
    await assert.rejects(
      insert(tenantId, 'standalone-first'),
      (e: unknown) => (e as { code: string }).code === '23505',
    )
  } finally {
    await db.close()
  }
})

test('standalone RLS isolates shops, blocks client writes and prevents foreign customer/message links', async () => {
  const { db, insert } = await ledgerDatabase()
  try {
    const user = '33333333-3333-4333-8333-333333333333'
    const foreignCustomer = '44444444-4444-4444-8444-444444444444'
    await db.query('insert into tenant_members values($1,$2)', [tenantId, user])
    await insert(tenantId, 'own-ref')
    await insert(otherTenant, 'other-ref')
    await db.query('insert into customers values($1,$2)', [foreignCustomer, otherTenant])
    await assert.rejects(
      db.query(
        `insert into standalone_slips(tenant_id,trans_ref,amount,trans_timestamp,customer_id)
      values($1,'foreign-link',1,now(),$2)`,
        [tenantId, foreignCustomer],
      ),
      (e: unknown) => (e as { code: string }).code === '42501',
    )
    await db.query("select set_config('test.user',$1,false)", [user])
    await db.exec('set role authenticated')
    assert.deepEqual(
      (await db.query<{ trans_ref: string }>('select trans_ref from standalone_slips')).rows,
      [{ trans_ref: 'own-ref' }],
    )
    await assert.rejects(insert(tenantId, 'client-write'), /permission denied/)
    await assert.rejects(db.query('update standalone_slips set amount=1'), /permission denied/)
    await assert.rejects(db.query('delete from standalone_slips'), /permission denied/)
    await db.exec('reset role')
  } finally {
    await db.close()
  }
})
