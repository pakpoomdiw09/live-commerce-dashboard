const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const tenant = '11111111-1111-4111-8111-111111111111'
const accountId = '22222222-2222-4222-8222-222222222222'
const actor = '33333333-3333-4333-8333-333333333333'
const payload = require('promptpay-qr')('0812345678', {})
const draft = {
  bank_code: 'KBANK',
  account_name: 'ร้านทดสอบ',
  account_number: '1234567890',
  is_active: true,
}
const globals = {
  Buffer,
  File,
  Request,
  Response,
  FormData,
  Headers,
  URL,
  TextEncoder,
  TextDecoder,
  AbortController,
  AbortSignal,
  setTimeout,
  clearTimeout,
  console,
}
const banks = load('lib/features/banking/banks.ts')
const drafts = load('lib/features/banking/bank-account-draft.ts')
const core = load('lib/features/payments/payment-codes-core.ts', {}, globals)
const security = load(
  'lib/upload-security.ts',
  {
    'server-only': {},
    sharp: require('sharp'),
    '@/lib/image-signature': load('lib/image-signature.ts'),
  },
  globals,
)
class InboxError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
function fixture({
  denied = false,
  existing = false,
  rpcError = null,
  uploadError = false,
  badQr = false,
} = {}) {
  const calls = [],
    requests = new Map()
  const record = existing ? { id: accountId, ...draft } : null
  const previous = existing
    ? {
        image_path: `${tenant}/${accountId}/old.png`,
        version: 1,
        bank_code_snapshot: draft.bank_code,
        account_number_snapshot: draft.account_number,
      }
    : null
  const db = {
    from(table) {
      const filters = {}
      const q = {
        select: () => q,
        eq(key, value) {
          filters[key] = value
          return q
        },
        async maybeSingle() {
          assert.equal(filters.tenant_id, tenant)
          if (table === 'bank_account_save_requests')
            return { data: requests.get(filters.request_id) ?? null, error: null }
          if (table === 'bank_accounts')
            return { data: filters.id === accountId ? record : null, error: null }
          if (table === 'bank_receiving_qr') {
            assert.equal(filters.account_id, accountId)
            return { data: previous, error: null }
          }
          throw Error(table)
        },
      }
      return q
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, 'bank-receiving-qr')
        return {
          async upload(path, bytes) {
            calls.push({ upload: path, bytes })
            return { error: uploadError ? { message: 'storage failed' } : null }
          },
          async remove(paths) {
            calls.push({ remove: paths })
            return { error: null }
          },
        }
      },
    },
    async rpc(name, args) {
      assert.equal(name, 'save_bank_account_with_qr')
      calls.push({ rpc: name, args })
      if (rpcError) return { data: null, error: rpcError }
      const result = {
        id: args.p_account,
        image_path: args.p_path ?? previous?.image_path ?? null,
        version: args.p_version + (args.p_path ? 1 : 0),
      }
      requests.set(args.p_request, { actor_id: actor, fingerprint: args.p_fingerprint, result })
      return { data: result, error: null }
    },
  }
  const api = load(
    'app/api/bank-accounts/save/route.ts',
    {
      'node:crypto': require('node:crypto'),
      'next/server': {
        NextResponse: {
          json: (body, options = {}) => ({ body, status: options.status ?? 200, ...options }),
        },
      },
      '@/lib/features/payments/payment-codes-server': {
        receivingCodeTenant: async () => {
          if (denied) throw new InboxError('Forbidden', 403)
          return { db, tenantId: tenant, actor: { id: actor } }
        },
        decodeReceivingQr: async () => (badQr ? 'https://evil.test' : payload),
      },
      '@/lib/features/banking/bank-accounts': load('lib/features/banking/bank-accounts.ts', {
        '@/lib/features/banking/banks': banks,
      }),
      '@/lib/features/banking/bank-account-draft': drafts,
      '@/lib/features/banking/bank-qr-upload': load(
        'lib/features/banking/bank-qr-upload.ts',
        { '@/lib/features/payments/payment-codes-core': core },
        globals,
      ),
      '@/lib/features/inbox/inbox-server': {
        InboxError,
        inboxError: (e) => ({ status: e.status ?? 503, body: { error: e.message } }),
      },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
      '@/lib/upload-security': security,
    },
    globals,
  )
  const requestId = randomUUID()
  function request(file = null, fields = {}, origin = 'https://shop.test') {
    const form = new FormData()
    for (const [key, value] of Object.entries({
      id: existing ? accountId : '',
      ...draft,
      is_active: 'true',
      original: JSON.stringify(existing ? draft : null),
      version: existing ? '1' : '0',
      requestId,
      ...fields,
    }))
      form.set(key, String(value))
    if (file) form.set('file', file)
    const req = new Request(`https://shop.test/api/bank-accounts/save?tenantId=${tenant}`, {
      method: 'POST',
      body: form,
      headers: { origin },
    })
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) })
    return req
  }
  return { api, request, calls, record }
}
async function png() {
  return new File(
    [
      await require('sharp')({
        create: { width: 10, height: 10, channels: 3, background: '#ffffff' },
      })
        .png()
        .toBuffer(),
    ],
    'qr.png',
    { type: 'image/png' },
  )
}

test('one create/edit POST passes normalized account and QR to a single atomic RPC; retries do not upload or save twice', async () => {
  for (const existing of [false, true]) {
    const f = fixture({ existing }),
      file = await png()
    const res = await f.api.POST(
      f.request(file, {
        account_name: ' ชื่อใหม่ ',
        account_number: '987-6-54321-0',
        is_active: 'false',
      }),
    )
    assert.equal(res.status, 200)
    const saved = f.calls.find((c) => c.rpc).args
    assert.equal(saved.p_create, !existing)
    assert.equal(saved.p_actor, actor)
    assert.equal(saved.p_data.account_name, 'ชื่อใหม่')
    assert.equal(saved.p_data.account_number, '9876543210')
    assert.equal(saved.p_data.is_active, false)
    assert.equal(saved.p_payload, payload)
    assert.ok(saved.p_path.startsWith(`${tenant}/${saved.p_account}/`))
    assert.equal(
      (
        await f.api.POST(
          f.request(file, {
            account_name: ' ชื่อใหม่ ',
            account_number: '987-6-54321-0',
            is_active: 'false',
          }),
        )
      ).status,
      200,
    )
    assert.equal(f.calls.filter((c) => c.upload).length, 1)
    assert.equal(f.calls.filter((c) => c.rpc).length, 1)
    assert.equal((await f.api.POST(f.request(file, { account_name: 'different' }))).status, 409)
  }
})

test('edits without a replacement preserve QR; changed receiver requires a new QR and stale snapshots fail before storage', async () => {
  const f = fixture({ existing: true })
  assert.equal((await f.api.POST(f.request(null, { account_name: 'ชื่อใหม่' }))).status, 200)
  assert.equal(f.calls.find((c) => c.rpc).args.p_path, null)
  assert.equal(
    f.calls.some((c) => c.upload),
    false,
  )
  const changed = fixture({ existing: true })
  assert.equal(
    (await changed.api.POST(changed.request(null, { account_number: '9876543210' }))).status,
    400,
  )
  changed.record.account_name = 'Changed elsewhere'
  assert.equal((await changed.api.POST(changed.request(await png()))).status, 409)
  assert.equal(changed.calls.length, 0)
  const optional = fixture()
  assert.equal((await optional.api.POST(optional.request())).status, 200)
  assert.equal(optional.calls.find((c) => c.rpc).args.p_payload, null)
})

test('invalid fields, unauthorized/cross-site calls, corrupt files and non-payment QR never save account data', async () => {
  const denied = fixture({ denied: true })
  assert.equal((await denied.api.POST(denied.request())).status, 403)
  assert.equal(denied.calls.length, 0)
  const f = fixture()
  assert.equal((await f.api.POST(f.request(null, {}, 'https://evil.test'))).status, 403)
  for (const fields of [
    { bank_code: 'PROMPTPAY' },
    { account_number: 'bad' },
    { is_active: 'yes' },
    { p_actor: 'forged' },
    { original: 'not-json' },
  ])
    assert.equal((await f.api.POST(f.request(null, fields))).status, 400)
  assert.equal(
    (await f.api.POST(f.request(new File(['<svg/>'], 'bad.png', { type: 'image/png' })))).status,
    415,
  )
  const bad = fixture({ badQr: true })
  assert.equal((await bad.api.POST(bad.request(await png()))).status, 400)
  assert.equal(f.calls.length, 0)
  assert.equal(bad.calls.length, 0)
})

test('storage failure never writes the database; definite DB refusal cleans upload while ambiguous failure preserves it', async () => {
  const upload = fixture({ uploadError: true })
  assert.equal((await upload.api.POST(upload.request(await png()))).status, 503)
  assert.equal(
    upload.calls.some((c) => c.rpc),
    false,
  )
  for (const code of ['40001', 'NETWORK_TIMEOUT']) {
    const f = fixture({ rpcError: { code } })
    assert.equal((await f.api.POST(f.request(await png()))).status, code === '40001' ? 409 : 503)
    assert.equal(
      f.calls.some((c) => c.remove),
      code === '40001',
    )
  }
})

test('SQL saves account+QR together, rolls back failures, preserves old QR and deduplicates retries', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      readFileSync('scripts/test-bank-accounts-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(
      'create table auth.users(id uuid primary key);create function has_tenant_feature(uuid,text) returns boolean language sql as $$select true$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;',
    )
    for (const file of [
      'bank-accounts.sql',
      'slip-bank-controls.sql',
      'bank-registry.sql',
      'bank-qr-upload.sql',
      'bank-qr-per-account.sql',
      'bank-account-combined-save.sql',
    ])
      await db.exec(readFileSync('supabase/' + file, 'utf8'))
    await db.exec(readFileSync('supabase/bank-account-combined-save.sql', 'utf8'))
    await db.query('insert into auth.users values($1)', [actor])
    await db.query('insert into tenants(id) values($1)', [tenant])
    await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, actor])
    const firstRequest = randomUUID(),
      hash = 'a'.repeat(64)
    const save = ({
      id = accountId,
      create = true,
      data = draft,
      original = null,
      path = `${tenant}/${id}/qr.png`,
      qr = payload,
      version = 0,
      request = firstRequest,
      fingerprint = hash,
      who = actor,
    } = {}) =>
      db.query('select save_bank_account_with_qr($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as result', [
        tenant,
        who,
        id,
        create,
        data,
        original,
        path,
        qr,
        version,
        request,
        fingerprint,
      ])
    const count = async (table) =>
      (await db.query('select count(*)::int n from ' + table)).rows[0].n
    await save()
    const originalPath = (await db.query('select image_path from bank_receiving_qr')).rows[0]
      .image_path
    const replay = await save({ id: randomUUID(), path: `${tenant}/${accountId}/retry.png` })
    assert.equal(replay.rows[0].result.id, accountId)
    assert.equal(await count('bank_accounts'), 1)
    assert.equal(await count('bank_account_audit'), 2)
    await assert.rejects(save({ fingerprint: 'b'.repeat(64) }), (e) => e.code === '40001')
    await save({
      create: false,
      data: { ...draft, account_name: 'ชื่อใหม่' },
      original: draft,
      path: null,
      qr: null,
      version: 1,
      request: randomUUID(),
    })
    assert.equal(
      (await db.query('select image_path from bank_receiving_qr')).rows[0].image_path,
      originalPath,
    )
    await assert.rejects(
      save({
        id: randomUUID(),
        data: { ...draft, account_number: '5555555555' },
        request: randomUUID(),
        version: 99,
      }),
      (e) => e.code === '40001',
    )
    assert.equal(await count('bank_accounts'), 1)
    const updated = { ...draft, account_name: 'ชื่อใหม่' }
    await assert.rejects(
      save({
        create: false,
        data: { ...updated, account_number: '9876543210' },
        original: updated,
        path: null,
        qr: null,
        version: 1,
        request: randomUUID(),
      }),
      (e) => e.code === '22023',
    )
    assert.equal(
      (await db.query('select account_number from bank_accounts')).rows[0].account_number,
      draft.account_number,
    )
    await save({
      create: false,
      data: { ...updated, account_number: '9876543210', is_active: false },
      original: updated,
      version: 1,
      request: randomUUID(),
    })
    const account = (await db.query('select * from bank_accounts')).rows[0]
    assert.equal(account.is_active, false)
    assert.equal(account.account_number, '9876543210')
    assert.equal(
      (await db.query('select account_number_snapshot from bank_receiving_qr')).rows[0]
        .account_number_snapshot,
      '9876543210',
    )
    await db.exec('set role authenticated')
    await assert.rejects(save(), (e) => e.code === '42501')
    await assert.rejects(
      db.exec('select * from bank_account_save_requests'),
      (e) => e.code === '42501',
    )
  } finally {
    await db.close()
  }
})
