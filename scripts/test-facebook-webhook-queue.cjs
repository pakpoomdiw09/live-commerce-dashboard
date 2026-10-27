const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const crypto = require('node:crypto')
const { PGlite } = require('@electric-sql/pglite')

function load(file, dependencies = {}, globals = {}) {
  dependencies = {
    '@/lib/features/inbox/inbox-automation-window': {
      InboxAutomationWindowError: class InboxAutomationWindowError extends Error {},
    },
    ...dependencies,
  }
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      Buffer,
      TextDecoder,
      Request,
      Response,
      Date,
      setInterval,
      clearInterval,
      console: { error() {}, warn() {}, log() {} },
      process: { env: {} },
      ...globals,
      require(name) {
        if (name === '@/lib/single-flight') return load('lib/single-flight.ts')
        if (name === '@/lib/features/inbox/standard-message-window')
          return load('lib/features/inbox/standard-message-window.ts')
        if (Object.hasOwn(dependencies, name)) return dependencies[name]
        if (name.startsWith('node:')) return require(name)
        throw Error('Unexpected dependency: ' + name)
      },
    },
  )
  return exports
}
const envelope = load('lib/integrations/facebook/webhook-envelope.ts')
const worker = load('lib/integrations/facebook/webhook-worker.ts', { 'server-only': {} })
const messageWindow = load('lib/integrations/facebook/message-window.ts')
const pageId = '123',
  senderId = '456',
  tenantId = crypto.randomUUID()
const payload = (mid = 'mid-one', sender = senderId) => ({
  object: 'page',
  entry: [
    {
      id: pageId,
      messaging: [
        {
          sender: { id: sender },
          recipient: { id: pageId },
          timestamp: 1700000000000,
          message: { mid, text: 'hello' },
        },
      ],
    },
  ],
})
const encode = (value) => Buffer.from(JSON.stringify(value))
const milliseconds = (value) => new Date(value).getTime()

test('image candidates ignore malformed attachments and sticker images', () => {
  const image = load('lib/features/slips/image.ts', {
    'server-only': {},
    '@/lib/features/slips/process': { SLIP_IMAGE_TYPES: [], SLIP_MAX_BYTES: 0 },
  })
  assert.equal(image.slipCandidates({}).length, 0)
  assert.equal(
    image.slipCandidates([
      null,
      { type: 'image', payload: { sticker_id: '1', url: 'https://example.test/sticker' } },
      { type: 'image', payload: { url: 123 } },
    ]).length,
    0,
  )
  assert.equal(
    image.slipCandidates([{ type: 'image', payload: { url: 'https://example.test/photo' } }])[0],
    'https://example.test/photo',
  )
})

async function database() {
  const pg = new PGlite()
  await pg.exec(`create role anon;create role authenticated;create role service_role;
    create table tenants(id uuid primary key,page_id text,is_active boolean default true);
    create table customers(id uuid primary key default gen_random_uuid(),platform text,platform_user_id text,tenant_id uuid,display_name text,bot_enabled boolean default true,last_message_at timestamptz,last_interaction_at timestamptz,inbound_seq bigint not null default 0,conversation_status text default 'open',conversation_version integer default 0,unique(platform,platform_user_id));
    create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid,external_id text unique,sender text,body text,attachments jsonb,created_at timestamptz default now(),inbound_seq bigint);
    create table comments(id uuid primary key default gen_random_uuid(),customer_id uuid,tenant_id uuid,external_id text unique,post_id text,author_name text,body text);`)
  const migration = fs.readFileSync('supabase/facebook-webhook-queue.sql', 'utf8')
  await pg.exec(migration)
  await pg.exec(migration)
  await pg.exec(fs.readFileSync('supabase/facebook-webhook-nonblocking.sql', 'utf8'))
  await pg.exec(fs.readFileSync('supabase/facebook-webhook-nonblocking.sql', 'utf8'))
  await pg.exec(fs.readFileSync('supabase/facebook-message-window.sql', 'utf8'))
  await pg.exec(fs.readFileSync('supabase/facebook-message-window.sql', 'utf8'))
  await pg.exec(fs.readFileSync('supabase/facebook-inbox-recovery.sql', 'utf8'))
  await pg.exec(fs.readFileSync('supabase/facebook-inbox-recovery.sql', 'utf8'))
  await pg.exec(
    'create trigger inbox_message_counter before insert on messages for each row execute function inbox_incoming_message()',
  )
  await pg.query('insert into tenants(id,page_id) values($1,$2)', [tenantId, pageId])
  const rpc = async (name, args = {}) => {
    const keys = Object.keys(args),
      values = keys.map((key) =>
        ['p_events', 'p_result'].includes(key) ? JSON.stringify(args[key]) : args[key],
      )
    try {
      const parameters = keys.map((key, index) => `${key}=>$${index + 1}`).join(',')
      const result = await pg.query(`select * from public.${name}(${parameters})`, values)
      const scalar = !['claim_facebook_webhook'].includes(name)
      return {
        data: scalar
          ? result.rows[0]?.[name]
          : result.rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() })),
        error: null,
      }
    } catch (error) {
      return { data: null, error }
    }
  }
  const enqueue = async (value) => {
    const parsed = envelope.parseWebhook(encode(value))
    const result = await rpc('enqueue_facebook_webhook', {
      p_raw: parsed.raw,
      p_hash: parsed.hash,
      p_events: parsed.events,
    })
    assert.equal(result.error, null)
    return result.data
  }
  const one = async (sql) => (await pg.query(sql)).rows[0]
  return { pg, db: { rpc }, enqueue, one }
}

test('message persistence assigns a Facebook fallback name before optional profile lookup', async () => {
  const f = await database()
  try {
    await f.enqueue(payload('fallback-name'))
    const result = await worker.runFacebookWebhookWorker(f.db, async (execution) => {
      await execution.persistRecord(tenantId)
    })
    assert.equal(result.completed, 1)
    assert.equal((await f.one('select count(*)::int n from messages')).n, 1)
    const clock = await f.one('select last_message_at,window_expires_at from customers')
    assert.equal(
      milliseconds(clock.window_expires_at) - milliseconds(clock.last_message_at),
      86400000,
    )
    assert.equal(
      (await f.one('select display_name from customers')).display_name,
      `ลูกค้า Facebook (${senderId.slice(-4)})`,
    )
  } finally {
    await f.pg.close()
  }
})

test('signature validates exact bytes; malformed, changed and oversized payloads are rejected', async () => {
  const bytes = encode(payload()),
    signature = 'sha256=' + crypto.createHmac('sha256', 'secret').update(bytes).digest('hex')
  assert.equal(envelope.verifyWebhookSignature(bytes, signature, 'secret'), true)
  assert.equal(
    envelope.verifyWebhookSignature(Buffer.concat([bytes, Buffer.from(' ')]), signature, 'secret'),
    false,
  )
  for (const invalid of [null, 'sha256=bad', 'sha256=' + '0'.repeat(64)])
    assert.equal(envelope.verifyWebhookSignature(bytes, invalid, 'secret'), false)
  assert.equal(envelope.verifyWebhookSignature(bytes, signature, ''), false)
  assert.throws(
    () => envelope.parseWebhook(Buffer.from('{}')),
    (error) => error.status === 400,
  )
  await assert.rejects(
    envelope.readWebhookBody(
      new Request('https://example.test', {
        method: 'POST',
        body: 'x'.repeat(envelope.WEBHOOK_MAX_BYTES + 1),
      }),
    ),
    (error) => error.status === 413,
  )
})

test('event IDs survive repackaging, property order changes and duplicate deliveries', async () => {
  const f = await database()
  try {
    assert.equal((await f.enqueue(payload())).accepted, 1)
    assert.equal((await f.enqueue(payload())).accepted, 0)
    const repackaged = payload()
    repackaged.entry[0].time = Date.now()
    assert.equal((await f.enqueue(repackaged)).accepted, 0)
    assert.equal((await f.one('select count(*)::int n from facebook_webhook_events')).n, 1)
    assert.equal(
      (await f.one('select sum(delivery_count)::int n from facebook_webhook_payloads')).n,
      3,
    )
    const invalid = await f.db.rpc('enqueue_facebook_webhook', {
      p_raw: JSON.stringify(payload('rollback')),
      p_hash: 'a'.repeat(64),
      p_events: [{ pageId: 'bad' }],
    })
    assert.ok(invalid.error)
    assert.equal(
      (
        await f.one(
          "select count(*)::int n from facebook_webhook_payloads where payload_sha256=repeat('a',64)",
        )
      ).n,
      0,
    )
  } finally {
    await f.pg.close()
  }
})

test('persisted message completes despite optional failure and the next customer message proceeds', async () => {
  const f = await database()
  try {
    await f.enqueue(payload())
    let executions = 0,
      recordId
    const handler = async (execution) => {
      const record = await execution.persistRecord(tenantId)
      assert.equal(record.duplicate, false)
      if (recordId) assert.equal(record.id, recordId)
      recordId = record.id
      if (++executions === 1) throw { code: 'DB_UNAVAILABLE' }
      await execution.once('reply', async () => 'provider-receipt')
    }
    const completed = await worker.runFacebookWebhookWorker(f.db, handler)
    assert.equal(completed.completed, 1)
    assert.equal(completed.sideEffectFailed, 1)
    const retry = await f.one(
      'select status,available_at,attempts,created_at from facebook_webhook_events',
    )
    assert.equal(retry.status, 'completed')
    await f.pg.exec("update facebook_webhook_events set available_at=now()-interval '1 second'")
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).claimed, 0)
    assert.equal((await f.one('select count(*)::int n from messages')).n, 1)
    const customer = await f.one('select last_message_at,last_interaction_at from customers')
    assert.equal(milliseconds(customer.last_message_at), 1700000000000)
    assert.equal(milliseconds(customer.last_interaction_at), 1700000000000)
    assert.equal((await f.one('select attempts from facebook_webhook_events')).attempts, 1)
    await f.enqueue(payload('next-message'))
    assert.equal(
      (
        await worker.runFacebookWebhookWorker(f.db, async (ex) => {
          await ex.persistRecord(tenantId)
        })
      ).completed,
      1,
    )
    assert.equal((await f.one('select count(*)::int n from messages')).n, 2)
  } finally {
    await f.pg.close()
  }
})

test('side effects are checkpointed; timeouts and expired dispatches require review and never resend', async () => {
  const f = await database()
  try {
    await f.enqueue(payload())
    let sends = 0
    const handler = async (execution) => {
      await execution.once('send', async () => {
        sends++
        throw Error('network timeout')
      })
    }
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).review, 1)
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).claimed, 0)
    assert.equal(sends, 1)
    await f.enqueue(payload('another', '789'))
    const claim = (await f.db.rpc('claim_facebook_webhook')).data[0]
    await f.db.rpc('begin_facebook_webhook_step', {
      p_event: claim.id,
      p_claim: claim.claim_token,
      p_name: 'send',
    })
    await f.pg.query(
      "update facebook_webhook_events set lease_until=now()-interval '1 second' where id=$1",
      [claim.id],
    )
    await worker.runFacebookWebhookWorker(f.db, handler)
    assert.equal(
      (await f.one("select status from facebook_webhook_events where ordering_key='789'")).status,
      'requires_review',
    )
    assert.equal(sends, 1)
  } finally {
    await f.pg.close()
  }
})

test('review and dead jobs do not block newer messages for the same sender', async () => {
  const f = await database()
  try {
    await f.enqueue(payload('unconfirmed'))
    assert.equal(
      (
        await worker.runFacebookWebhookWorker(f.db, async (ex) => {
          await ex.once('send', async () => {
            throw Error('uncertain')
          })
        })
      ).review,
      1,
    )
    await f.enqueue(payload('after-review'))
    assert.equal(
      (
        await worker.runFacebookWebhookWorker(f.db, async (ex) => {
          await ex.persistRecord(tenantId)
        })
      ).completed,
      1,
    )
    await f.pg.exec(
      "update facebook_webhook_events set status='dead' where status='requires_review'",
    )
    await f.enqueue(payload('after-dead'))
    assert.equal(
      (
        await worker.runFacebookWebhookWorker(f.db, async (ex) => {
          await ex.persistRecord(tenantId)
        })
      ).completed,
      1,
    )
    assert.equal((await f.one('select count(*)::int n from messages')).n, 2)
    assert.equal(
      (
        await f.one(
          "select count(*)::int n from facebook_webhook_steps where name='send' and status='started'",
        )
      ).n,
      1,
    )
  } finally {
    await f.pg.close()
  }
})

test('persisted messages complete after ambiguous sends or expired leases without replaying them', async () => {
  const f = await database()
  try {
    let sends = 0
    await f.enqueue(payload('persisted-uncertain'))
    const result = await worker.runFacebookWebhookWorker(f.db, async (ex) => {
      await ex.persistRecord(tenantId)
      await ex.once('send', async () => {
        sends++
        throw Error('timeout')
      })
    })
    assert.equal(result.completed, 1)
    assert.equal(result.sideEffectFailed, 1)
    assert.equal(
      (await f.one('select last_error from facebook_webhook_events')).last_error,
      'WEBHOOK_SIDE_EFFECT_UNCONFIRMED',
    )
    await f.enqueue(payload('crashed-after-record'))
    const event = (await f.db.rpc('claim_facebook_webhook')).data[0]
    await f.db.rpc('persist_facebook_webhook_record', {
      p_event: event.id,
      p_claim: event.claim_token,
      p_tenant: tenantId,
    })
    await f.db.rpc('begin_facebook_webhook_step', {
      p_event: event.id,
      p_claim: event.claim_token,
      p_name: 'send',
    })
    await f.pg.query(
      "update facebook_webhook_events set lease_until=now()-interval '1 second' where id=$1",
      [event.id],
    )
    await f.enqueue(payload('after-crash'))
    assert.equal(
      (
        await worker.runFacebookWebhookWorker(f.db, async (ex) => {
          await ex.persistRecord(tenantId)
        })
      ).completed,
      1,
    )
    assert.equal(
      (await f.pg.query('select status from facebook_webhook_events where id=$1', [event.id]))
        .rows[0].status,
      'completed',
    )
    assert.equal(
      (
        await f.one(
          "select count(*)::int n from facebook_webhook_steps where name='send' and status='started'",
        )
      ).n,
      2,
    )
    assert.equal(sends, 1)
  } finally {
    await f.pg.close()
  }
})

test('claim fencing, per-customer ordering, stale worker rejection and bounded exponential retries', async () => {
  const f = await database()
  try {
    await f.enqueue(payload('first'))
    await f.enqueue(payload('second'))
    await f.enqueue(payload('other', '999'))
    const a = (await f.db.rpc('claim_facebook_webhook')).data[0]
    const b = (await f.db.rpc('claim_facebook_webhook')).data[0]
    assert.equal(a.ordering_key, senderId)
    assert.equal(b.ordering_key, '999')
    assert.equal((await f.db.rpc('claim_facebook_webhook')).data.length, 0)
    assert.equal(
      (
        await f.db.rpc('finish_facebook_webhook', {
          p_event: a.id,
          p_claim: crypto.randomUUID(),
          p_outcome: 'completed',
        })
      ).data,
      null,
    )
    await f.pg.query(
      "update facebook_webhook_events set lease_until=now()-interval '1 second' where id=$1",
      [a.id],
    )
    await f.db.rpc('claim_facebook_webhook')
    assert.equal(
      (await f.db.rpc('heartbeat_facebook_webhook', { p_event: a.id, p_claim: a.claim_token }))
        .data,
      false,
    )
    await f.pg.query(
      "update facebook_webhook_events set attempts=7,available_at=now()-interval '1 second' where id=$1",
      [a.id],
    )
    const result = await worker.runFacebookWebhookWorker(f.db, async () => {
      throw { code: 'DB_DOWN' }
    })
    assert.equal(result.dead, 1)
    assert.equal(
      (await f.one(`select status from facebook_webhook_events where id='${a.id}'`)).status,
      'dead',
    )
  } finally {
    await f.pg.close()
  }
})

test('queue tables and RPCs cannot be accessed by browser roles', async () => {
  const f = await database()
  try {
    await f.pg.exec('set role authenticated')
    await assert.rejects(
      f.pg.query('select * from facebook_webhook_payloads'),
      (error) => error.code === '42501',
    )
    await assert.rejects(
      f.pg.query('select * from claim_facebook_webhook()'),
      (error) => error.code === '42501',
    )
  } finally {
    await f.pg.close()
  }
})

test('completed external steps are not rerun after a later retry; backoff grows exponentially', async () => {
  const f = await database()
  try {
    await f.enqueue(payload())
    let calls = 0,
      fail = true
    const handler = async (execution) => {
      await execution.once('send', async () => {
        calls++
        return { receipt: 'sent' }
      })
      if (fail) throw { code: 'DATABASE_UNAVAILABLE' }
    }
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).retried, 1)
    await f.pg.exec(
      "update facebook_webhook_events set available_at=now()-interval '1 second',attempts=3",
    )
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).retried, 1)
    const timing = await f.one(
      'select extract(epoch from available_at-clock_timestamp()) remaining from facebook_webhook_events',
    )
    assert.ok(Number(timing.remaining) > 38 && Number(timing.remaining) <= 42)
    fail = false
    await f.pg.exec("update facebook_webhook_events set available_at=now()-interval '1 second'")
    assert.equal((await worker.runFacebookWebhookWorker(f.db, handler)).completed, 1)
    assert.equal(calls, 1)
  } finally {
    await f.pg.close()
  }
})

test('comment checkpoints survive worker restart and legacy messages do not execute again', async () => {
  const f = await database()
  try {
    const comment = {
      object: 'page',
      entry: [
        {
          id: pageId,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'comment-one',
                post_id: 'post',
                message: 'hello',
                from: { id: senderId, name: 'Customer' },
              },
            },
          ],
        },
      ],
    }
    await f.enqueue(comment)
    const results = []
    let first = true
    const handler = async (execution) => {
      results.push(await execution.persistRecord(tenantId))
      if (first) {
        first = false
        throw { code: 'DB_UNAVAILABLE' }
      }
    }
    await worker.runFacebookWebhookWorker(f.db, handler)
    await f.pg.exec("update facebook_webhook_events set available_at=now()-interval '1 second'")
    await worker.runFacebookWebhookWorker(f.db, handler)
    assert.equal(results[0].id, results[1].id)
    assert.equal((await f.one('select count(*)::int n from comments')).n, 1)
    assert.equal((await f.one('select display_name from customers')).display_name, 'Customer')
    await f.pg.exec(
      "insert into messages(customer_id,external_id,sender) select id,'legacy-mid','customer' from customers",
    )
    await f.enqueue(payload('legacy-mid'))
    let dispatched = false
    await worker.runFacebookWebhookWorker(f.db, async (execution) => {
      const result = await execution.persistRecord(tenantId)
      if (!result.duplicate) dispatched = true
    })
    assert.equal(dispatched, false)
  } finally {
    await f.pg.close()
  }
})

test('worker authentication fails closed and does not access the database for an invalid secret', async () => {
  let dbCalls = 0
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const route = load(
    'app/api/cron/facebook-webhooks/route.ts',
    {
      'next/server': { NextResponse },
      '@/lib/supabase/server': {
        supabaseAdmin: () => {
          dbCalls++
          return {}
        },
      },
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => ({ completed: 1 }),
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    },
    { process: { env: { CRON_SECRET: 'private-worker-secret' } } },
  )
  assert.equal((await route.POST(new Request('https://example.test'))).status, 401)
  assert.equal(
    (
      await route.GET(
        new Request('https://example.test', { headers: { authorization: 'Bearer wrong' } }),
      )
    ).status,
    401,
  )
  assert.equal(dbCalls, 0)
  assert.equal(
    (
      await route.POST(
        new Request('https://example.test', {
          headers: { authorization: 'Bearer private-worker-secret' },
        }),
      )
    ).status,
    200,
  )
  assert.equal(dbCalls, 1)
})

test('HTTP acknowledges only after durable commit; failed persistence returns 503; worker is deferred', async () => {
  const bytes = encode(payload()),
    secret = 'secret',
    signature = 'sha256=' + crypto.createHmac('sha256', secret).update(bytes).digest('hex')
  let committed = false,
    processing = 0,
    fail = false,
    deferred
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const shared = load(
    'lib/integrations/facebook/webhook-http.ts',
    {
      'server-only': {},
      'next/server': {
        NextResponse,
        after: (callback) => {
          assert.equal(committed, true)
          deferred = callback
        },
      },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async () => {
            if (fail) return { error: { code: 'DB_DOWN' } }
            committed = true
            return { data: { id: 'receipt', accepted: 1 } }
          },
        }),
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => {
          processing++
        },
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    },
    { process: { env: { FB_APP_SECRET: secret } } },
  )
  const route = load('app/api/webhook/facebook/route.ts', {
    '@/lib/integrations/facebook/webhook-http': shared,
  })
  const request = () =>
    new Request('https://example.test/api/webhook/facebook', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signature },
      body: bytes,
    })
  assert.equal((await route.POST(request())).status, 200)
  assert.equal(processing, 0)
  await deferred()
  assert.equal(processing, 1)
  fail = true
  committed = false
  assert.equal((await route.POST(request())).status, 503)
  assert.equal(
    (await route.POST(new Request('https://example.test', { method: 'POST', body: bytes }))).status,
    401,
  )
})

test('new receipt wakes an active drain again; invalid queue receipts are never acknowledged', async () => {
  const bytes = encode(payload()),
    secret = 'secret',
    signature = 'sha256=' + crypto.createHmac('sha256', secret).update(bytes).digest('hex')
  const deferred = []
  let runs = 0,
    release,
    accepted = 1
  const held = new Promise((resolve) => {
    release = resolve
  })
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const shared = load(
    'lib/integrations/facebook/webhook-http.ts',
    {
      'server-only': {},
      'next/server': { NextResponse, after: (fn) => deferred.push(fn) },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({ rpc: async () => ({ data: { id: 'receipt', accepted } }) }),
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => {
          runs++
          if (runs === 1) await held
          return { claimed: 0, completed: 0 }
        },
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    },
    { process: { env: { FB_APP_SECRET: secret } } },
  )
  const request = () =>
    new Request('https://example.test', {
      method: 'POST',
      headers: { 'x-hub-signature-256': signature },
      body: bytes,
    })
  assert.equal((await shared.postFacebookWebhook(request())).status, 200)
  const first = deferred.shift()()
  assert.equal((await shared.postFacebookWebhook(request())).status, 200)
  const second = deferred.shift()()
  assert.equal(runs, 1)
  release()
  await Promise.all([first, second])
  assert.equal(runs, 2)
  accepted = undefined
  assert.equal((await shared.postFacebookWebhook(request())).status, 503)
  assert.equal(deferred.length, 0)
})

test('receiver omits raw payload and logs precise drop reasons including queue database errors', async () => {
  const logs = [],
    secret = 'secret'
  let fail = false,
    accepted = 1,
    writes = 0
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const shared = load(
    'lib/integrations/facebook/webhook-http.ts',
    {
      'server-only': {},
      'next/server': { NextResponse, after() {} },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async () => {
            writes++
            return fail
              ? {
                  error: {
                    code: '57014',
                    message: 'statement timeout',
                    details: 'queue insert',
                    hint: 'retry',
                  },
                }
              : { data: { id: 'receipt', accepted } }
          },
        }),
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': {
        runFacebookWebhookWorker: async () => ({ claimed: 0 }),
      },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    },
    {
      process: { env: { FB_APP_SECRET: secret } },
      console: { log: (...args) => logs.push(args), error() {}, warn() {} },
    },
  )
  const send = async (value, signatureValid = true) => {
    const body = JSON.stringify(value),
      signature = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
    return shared.postFacebookWebhook(
      new Request('https://example.test', {
        method: 'POST',
        body,
        headers: signatureValid ? { 'x-hub-signature-256': signature } : {},
      }),
    )
  }
  assert.equal((await send(payload(), false)).status, 401)
  assert.equal(writes, 0)
  assert.equal(
    logs.some((args) => args[0] === '[WEBHOOK RECEIVER] Payload:'),
    false,
  )
  assert.ok(logs.some((args) => args[1]?.reason === 'SIGNATURE_INVALID'))
  fail = true
  assert.equal((await send(payload())).status, 503)
  const failure = logs.find((args) => args[1]?.reason === 'QUEUE_INSERT_FAILED')[1]
  assert.equal(failure.error.code, '57014')
  assert.equal(failure.error.message, 'statement timeout')
  assert.equal(failure.error.hint, 'retry')
  fail = false
  accepted = 0
  assert.equal((await send({ object: 'page', entry: [{ id: '123' }] })).status, 200)
  assert.ok(logs.some((args) => args[1]?.reason === 'NO_EVENTS_IN_MESSAGING_OR_CHANGES'))
  assert.equal((await send(payload())).status, 200)
  assert.ok(logs.some((args) => args[1]?.reason === 'ALL_EVENTS_ALREADY_QUEUED'))
  assert.equal(JSON.stringify(logs).includes('"text":"hello"'), false)
})

test('TypeScript and SQL agree on strict incoming-message eligibility and payload timestamp integrity', async () => {
  const f = await database()
  const received = 1700000001000
  try {
    const base = payload().entry[0].messaging[0]
    const cases = [
      { label: 'text', value: base, valid: true },
      { label: 'millisecond precision', value: { ...base, timestamp: 1700000000999 }, valid: true },
      {
        label: 'media',
        value: {
          ...base,
          message: {
            mid: 'media',
            attachments: [{ type: 'image', payload: { url: 'https://example.test/image' } }],
          },
        },
        valid: true,
      },
      {
        label: 'quick reply',
        value: { ...base, message: { ...base.message, quick_reply: { payload: 'choice' } } },
        valid: true,
      },
      ...[
        undefined,
        null,
        '1700000000000',
        0,
        -1,
        1700000000000.5,
        received + 1,
        9007199254740992,
        1e100,
      ].map((timestamp) => ({
        label: 'invalid timestamp ' + timestamp,
        value: { ...base, timestamp },
        valid: false,
      })),
      ...['is_echo', 'is_deleted', 'is_unsupported'].flatMap((flag) =>
        [true, 'false', null].map((value) => ({
          label: flag + ':' + value,
          value: { ...base, message: { ...base.message, [flag]: value } },
          valid: false,
        })),
      ),
      ...[
        'delivery',
        'read',
        'postback',
        'optin',
        'referral',
        'account_linking',
        'reaction',
        'message_reaction',
        'message_edit',
        'pass_thread_control',
        'take_thread_control',
        'request_thread_control',
      ].map((key) => ({ label: key, value: { ...base, [key]: {} }, valid: false })),
      { label: 'wrong page', value: { ...base, recipient: { id: 'other' } }, valid: false },
      { label: 'page sender', value: { ...base, sender: { id: pageId } }, valid: false },
      { label: 'numeric sender', value: { ...base, sender: { id: 456 } }, valid: false },
      { label: 'missing mid', value: { ...base, message: { text: 'hello' } }, valid: false },
      ...['', ' \n\t ', '\u00a0\u2003\ufeff'].map((text) => ({
        label: 'blank content',
        value: { ...base, message: { mid: 'blank', text } },
        valid: false,
      })),
      {
        label: 'empty media',
        value: { ...base, message: { mid: 'empty', attachments: [] } },
        valid: false,
      },
      {
        label: 'unsupported media',
        value: {
          ...base,
          message: { mid: 'unsupported', attachments: [{ type: 'system', payload: {} }] },
        },
        valid: false,
      },
      {
        label: 'missing media payload',
        value: { ...base, message: { mid: 'bad-media', attachments: [{ type: 'image' }] } },
        valid: false,
      },
    ]
    for (const item of cases) {
      const result = messageWindow.facebookInboundMessage(item.value, pageId, received)
      assert.equal(result !== null, item.valid, 'TS: ' + item.label)
      const sql = (
        await f.pg.query('select facebook_inbound_message_at($1::jsonb,$2,$3::timestamptz) at', [
          JSON.stringify(item.value),
          pageId,
          new Date(received).toISOString(),
        ])
      ).rows[0].at
      assert.equal(sql !== null, item.valid, 'SQL: ' + item.label)
      if (item.valid) assert.equal(milliseconds(sql), result.timestamp)
    }
    assert.equal(messageWindow.facebookInboundMessage(base, pageId, 'not-a-date'), null)
  } finally {
    await f.pg.close()
  }
})

test('duplicate, stale and out-of-order events cannot advance or rewind the customer service window', async () => {
  const f = await database()
  try {
    const submit = async (mid, timestamp) => {
      const value = payload(mid)
      value.entry[0].messaging[0].timestamp = timestamp
      await f.enqueue(value)
      await worker.runFacebookWebhookWorker(f.db, async (execution) => {
        await execution.persistRecord(tenantId)
      })
    }
    const newer = Date.now() - 2000,
      older = newer - 86400000 * 2
    await submit('newer', newer)
    const first = await f.one(
      'select last_message_at,last_interaction_at,window_expires_at,inbound_seq from customers',
    )
    assert.equal(milliseconds(first.last_message_at), newer)
    assert.equal(milliseconds(first.last_interaction_at), newer)
    assert.equal(milliseconds(first.window_expires_at), newer + 86400000)
    await submit('older', older)
    assert.equal(
      milliseconds((await f.one('select window_expires_at from customers')).window_expires_at),
      newer + 86400000,
    )
    assert.equal(
      milliseconds((await f.one('select last_message_at from customers')).last_message_at),
      newer,
    )
    await submit('newer', Date.now() - 1)
    const duplicate = await f.one(
      'select last_message_at,last_interaction_at,inbound_seq from customers',
    )
    assert.equal(milliseconds(duplicate.last_message_at), newer)
    assert.equal(milliseconds(duplicate.last_interaction_at), newer)
    assert.equal(Number(duplicate.inbound_seq), Number(first.inbound_seq) + 1)
    assert.equal((await f.one('select count(*)::int n from messages')).n, 2)
    await submit('newest', newer + 500)
    assert.equal(
      milliseconds((await f.one('select last_message_at from customers')).last_message_at),
      newer + 500,
    )
    assert.equal(
      milliseconds((await f.one('select last_interaction_at from customers')).last_interaction_at),
      newer + 500,
    )
    const staleCustomer = payload('stale-customer', '111')
    staleCustomer.entry[0].messaging[0].timestamp = older
    await f.enqueue(staleCustomer)
    await worker.runFacebookWebhookWorker(f.db, async (execution) => {
      await execution.persistRecord(tenantId)
    })
    assert.equal(
      milliseconds(
        (await f.one("select last_message_at from customers where platform_user_id='111'"))
          .last_message_at,
      ),
      older,
    )
    assert.ok(Date.now() - older > 24 * 60 * 60 * 1000)
  } finally {
    await f.pg.close()
  }
})

test('invalid timestamps, receipts, echoes and system events cannot create a window even when RPC is called directly', async () => {
  const f = await database()
  try {
    const base = payload().entry[0].messaging[0]
    const events = [
      { ...base, timestamp: undefined },
      { ...base, timestamp: Date.now() + 86400000 },
      { ...base, message: { ...base.message, is_echo: true } },
      { ...base, delivery: { mids: ['outgoing'] } },
      { ...base, read: { watermark: Date.now() } },
      { ...base, sender: { id: pageId } },
      { ...base, recipient: { id: '999' } },
    ]
    for (const [index, event] of events.entries()) {
      const value = { ...event, message: { ...event.message, mid: 'invalid-' + index } }
      await f.enqueue({ object: 'page', entry: [{ id: pageId, messaging: [value] }] })
    }
    await worker.runFacebookWebhookWorker(f.db, async (execution) => {
      assert.equal((await execution.persistRecord(tenantId)).ignored, true)
    })
    assert.equal((await f.one('select count(*)::int n from customers')).n, 0)
    assert.equal((await f.one('select count(*)::int n from messages')).n, 0)
    assert.equal(
      (await f.one('select count(*)::int n from facebook_webhook_payloads')).n,
      events.length,
    )
    assert.equal(
      (await f.one("select count(*)::int n from facebook_webhook_events where status='completed'"))
        .n,
      events.length,
    )
  } finally {
    await f.pg.close()
  }
})

test('the inbox trigger cannot extend Facebook windows from local created_at; other channels retain their counter behavior', async () => {
  const f = await database()
  try {
    await f.pg.query(
      "insert into customers(platform,platform_user_id) values('facebook','fb-direct'),('line','line-direct')",
    )
    const past = '2023-11-14T22:13:20.000Z'
    await f.pg.query("update customers set last_message_at=$1 where platform='facebook'", [past])
    await f.pg.exec(
      "insert into messages(customer_id,external_id,sender,body) select id,'direct:'||platform,'customer','locally created message' from customers",
    )
    assert.equal(
      Date.parse(
        (await f.one("select last_message_at from customers where platform='facebook'"))
          .last_message_at,
      ),
      Date.parse(past),
    )
    assert.ok(
      Date.parse(
        (await f.one("select last_message_at from customers where platform='line'"))
          .last_message_at,
      ) > Date.parse(past),
    )
    await f.pg.exec(
      "insert into messages(customer_id,external_id,sender,body) select id,'outbound:'||platform,'agent','admin reply' from customers",
    )
    assert.equal(
      Date.parse(
        (await f.one("select last_message_at from customers where platform='facebook'"))
          .last_message_at,
      ),
      Date.parse(past),
    )
  } finally {
    await f.pg.close()
  }
})

test('the real handler refuses ineligible messages before calling profile, AI, orders or image services', async () => {
  let persisted = 0,
    external = 0
  const forbidden = () => {
    external++
    throw Error('Unexpected external service')
  }
  const db = {
    from(table) {
      const query = {
        select() {
          return query
        },
        eq() {
          return query
        },
        maybeSingle: async () => ({
          data: table === 'tenants' ? { id: tenantId, page_id: pageId } : null,
          error: null,
        }),
      }
      return query
    },
  }
  const api = load('lib/integrations/facebook/webhook-handler.ts', {
    '@/lib/supabase/server': { supabaseAdmin: () => db },
    '@/lib/integrations/facebook/client': {
      getCustomerProfile: forbidden,
      getPageTokenStatus: forbidden,
      pageTokenFor: forbidden,
      privateReply: forbidden,
      replyToComment: forbidden,
    },
    '@/lib/features/comments/comment-rules': {},
    '@/lib/features/agents/chatbot-server': { answerChat: forbidden },
    '@/lib/features/commerce/orders': { placeCfOrder: forbidden },
    '@/lib/features/slips/process': { processSlip: forbidden },
    '@/lib/features/slips/notify': { deliverOnce: forbidden, notifySlipResult: forbidden },
    '@/lib/features/slips/image': { downloadSlipImage: forbidden, slipCandidates: forbidden },
    '@/lib/message-quota': { sendWithMessageCredit: forbidden },
    '@/lib/features/follow-ups/followup-ai': { observeFollowUpMessage: forbidden },
    '@/lib/features/vision/vision': { queueMessengerVision: forbidden },
    '@/lib/features/broadcast/broadcast-policy': { inboundBroadcastEvidence: forbidden },
    '@/lib/integrations/facebook/message-window': messageWindow,
  })
  const base = payload().entry[0].messaging[0],
    createdAt = new Date(1700000001000).toISOString()
  const invalid = [
    { ...base, timestamp: undefined },
    { ...base, timestamp: 1700000001001 },
    { ...base, message: { ...base.message, is_echo: true } },
    { ...base, sender: { id: pageId } },
    { ...base, recipient: { id: '999' } },
    { ...base, message: { mid: 'blank', text: '  ' } },
  ]
  for (const value of invalid)
    await api.handleFacebookWebhookEvent({
      event: {
        id: crypto.randomUUID(),
        page_id: pageId,
        kind: 'message',
        payload: value,
        created_at: createdAt,
      },
      persistRecord: async () => {
        persisted++
        return { ignored: true, duplicate: false, id: null, customer: null }
      },
    })
  assert.equal(persisted, invalid.length)
  assert.equal(external, 0)
})

test('both registered URLs share verification, signature checks and persistence failure responses without redirects', async () => {
  const env = {
    FB_APP_SECRET: 'secret',
    FB_VERIFY_TOKEN: 'primary',
    FACEBOOK_VERIFY_TOKEN: 'fallback',
  }
  let writes = 0
  class NextResponse extends Response {
    static json(value, init) {
      return new NextResponse(JSON.stringify(value), init)
    }
  }
  const shared = load(
    'lib/integrations/facebook/webhook-http.ts',
    {
      'server-only': {},
      'next/server': { NextResponse, after() {} },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async () => {
            writes++
            return { error: { code: 'DB_DOWN' } }
          },
        }),
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': { runFacebookWebhookWorker: async () => {} },
      '@/lib/integrations/facebook/webhook-handler': { handleFacebookWebhookEvent: async () => {} },
    },
    { process: { env } },
  )
  const routes = ['app/api/webhook/facebook/route.ts', 'app/api/webhooks/facebook/route.ts'].map(
    (path) => load(path, { '@/lib/integrations/facebook/webhook-http': shared }),
  )
  assert.equal(routes[0].GET, routes[1].GET)
  assert.equal(routes[0].POST, routes[1].POST)
  for (const [index, route] of routes.entries()) {
    assert.equal(route.runtime, 'nodejs')
    assert.equal(route.maxDuration, 300)
    const url = 'https://example.test/api/' + (index ? 'webhooks' : 'webhook') + '/facebook'
    const verify = (token) => {
      const request = new Request(
        url + '?hub.mode=subscribe&hub.verify_token=' + token + '&hub.challenge=challenge-123',
      )
      request.nextUrl = new URL(request.url)
      return route.GET(request)
    }
    assert.equal(await verify('primary').text(), 'challenge-123')
    assert.equal(verify('primary').headers.get('location'), null)
    assert.equal(verify('wrong').status, 403)
    env.FB_VERIFY_TOKEN = ''
    assert.equal(await verify('fallback').text(), 'challenge-123')
    env.FB_VERIFY_TOKEN = 'primary'
    assert.equal(
      (await route.POST(new Request(url, { method: 'POST', body: encode(payload()) }))).status,
      401,
    )
    const body = encode(payload()),
      signature =
        'sha256=' + crypto.createHmac('sha256', env.FB_APP_SECRET).update(body).digest('hex')
    assert.equal(
      (
        await route.POST(
          new Request(url, { method: 'POST', headers: { 'x-hub-signature-256': signature }, body }),
        )
      ).status,
      503,
    )
  }
  assert.equal(writes, 2)
})

test('concurrent deliveries across both URLs execute one shared profile, AI, tracking, image and comment pipeline', async () => {
  const f = await database()
  try {
    const counts = {
      profiles: 0,
      ai: 0,
      followup: 0,
      tracking: 0,
      images: 0,
      publicReply: 0,
      privateReply: 0,
    }
    const deferred = [],
      imageKeys = [],
      profileWrites = []
    let autoVerify = false
    const db = {
      rpc: f.db.rpc,
      from(table) {
        let update = null
        const filters = {}
        const result = async () => {
          if (table === 'tenants')
            return {
              data: {
                id: tenantId,
                page_id: pageId,
                name: 'Shop',
                auto_reply_enabled: true,
                auto_verify_enabled: autoVerify,
                page_access_token: 'fake-test-token',
              },
              error: null,
            }
          if (table === 'customers') {
            const customer = await f.one('select * from customers limit 1')
            if (update) profileWrites.push(update)
            return { data: { ...customer, ...update }, error: null }
          }
          if (table === 'broadcast_messaging_events') {
            counts.tracking++
            return { data: null, error: null }
          }
          if (table === 'vision_jobs')
            return {
              data: imageKeys
                .filter((key) => filters.idempotency_key?.includes(key))
                .map((idempotency_key) => ({ idempotency_key })),
              error: null,
            }
          if (table === 'comment_rules')
            return {
              data: [
                {
                  id: 'test-rule',
                  name: 'Reply',
                  reply_enabled: true,
                  reply_text: 'Public reply',
                  inbox_enabled: true,
                  inbox_type: 'text',
                  inbox_text: 'Private reply',
                },
              ],
              error: null,
            }
          if (table === 'comments') return { data: null, error: null }
          throw Error('Unexpected query: ' + table)
        }
        const query = {
          select() {
            return query
          },
          eq(key, value) {
            filters[key] = value
            return query
          },
          update(value) {
            update = value
            return query
          },
          upsert() {
            return query
          },
          contains() {
            return query
          },
          order() {
            return query
          },
          in(key, value) {
            filters[key] = value
            return query
          },
          maybeSingle: result,
          then(resolve, reject) {
            return result().then(resolve, reject)
          },
        }
        return query
      },
    }
    const business = load('lib/integrations/facebook/webhook-handler.ts', {
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        getCustomerProfile: async () => {
          counts.profiles++
          return { display_name: 'Customer', avatar_url: 'https://example.test/avatar.png' }
        },
        pageTokenFor: () => 'fake-test-token',
        replyToComment: async () => {
          counts.publicReply++
        },
        privateReply: async () => {
          counts.privateReply++
        },
      },
      '@/lib/features/comments/comment-rules': { RULE_COLUMNS: '*', ruleMatches: () => true },
      '@/lib/features/agents/chatbot-server': {
        loadBotSettings: async () => ({ reply_mode: 'ai' }),
        answerChat: async (_db, message) => {
          counts.ai++
          if (message.imageUrls?.length) {
            assert.equal(message.imageUrls[0], 'https://example.test/product.png')
            assert.ok(message.text)
          }
        },
      },
      '@/lib/features/commerce/orders': { cfCode: () => null },
      '@/lib/features/slips/process': {},
      '@/lib/features/slips/notify': {},
      '@/lib/features/slips/image': {
        slipCandidates: (attachments) =>
          (attachments ?? [])
            .filter((item) => item.type === 'image')
            .map((item) => item.payload.url),
      },
      '@/lib/message-quota': { sendWithMessageCredit: async (_db, _tenant, send) => send() },
      '@/lib/features/follow-ups/followup-ai': {
        observeFollowUpMessage: async () => {
          counts.followup++
        },
      },
      '@/lib/features/vision/vision': {
        queueMessengerVision: async (_db, _tenant, _customer, messageId, urls) => {
          if (urls.includes('https://example.test/disabled.png')) return 'disabled'
          if (urls.includes('https://example.test/product.png')) return false
          for (const [index] of urls.entries()) {
            counts.images++
            imageKeys.push(`${messageId}:${index}`)
          }
          return urls.length > 0
        },
      },
      '@/lib/features/broadcast/broadcast-policy': load(
        'lib/features/broadcast/broadcast-policy.ts',
      ),
      '@/lib/integrations/facebook/message-window': messageWindow,
    })
    class NextResponse extends Response {
      static json(value, init) {
        return new NextResponse(JSON.stringify(value), init)
      }
    }
    const shared = load(
      'lib/integrations/facebook/webhook-http.ts',
      {
        'server-only': {},
        'next/server': { NextResponse, after: (callback) => deferred.push(callback) },
        '@/lib/supabase/server': { supabaseAdmin: () => db },
        '@/lib/integrations/facebook/webhook-envelope': envelope,
        '@/lib/integrations/facebook/webhook-worker': worker,
        '@/lib/integrations/facebook/webhook-handler': business,
      },
      { process: { env: { FB_APP_SECRET: 'secret' } } },
    )
    const routes = ['app/api/webhook/facebook/route.ts', 'app/api/webhooks/facebook/route.ts'].map(
      (path) => load(path, { '@/lib/integrations/facebook/webhook-http': shared }),
    )
    const deliverBoth = async (value) => {
      const body = encode(value),
        signature = 'sha256=' + crypto.createHmac('sha256', 'secret').update(body).digest('hex')
      const responses = await Promise.all(
        routes.map((route, index) =>
          route.POST(
            new Request(
              'https://example.test/api/' + (index ? 'webhooks' : 'webhook') + '/facebook',
              { method: 'POST', headers: { 'x-hub-signature-256': signature }, body },
            ),
          ),
        ),
      )
      assert.deepEqual(
        responses.map((response) => response.status),
        [200, 200],
      )
      await Promise.all(deferred.splice(0).map((callback) => callback()))
    }
    await deliverBoth(payload('shared-text'))
    const image = payload('shared-image')
    image.entry[0].messaging[0].message = {
      mid: 'shared-image',
      attachments: [{ type: 'image', payload: { url: 'https://example.test/photo.png' } }],
    }
    await deliverBoth(image)
    await deliverBoth({
      object: 'page',
      entry: [
        {
          id: pageId,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: 'shared-comment',
                post_id: 'post',
                from: { id: senderId, name: 'Customer' },
                message: 'hello',
              },
            },
          ],
        },
      ],
    })
    const repackaged = payload('shared-text')
    repackaged.entry[0].time = Date.now()
    await deliverBoth(repackaged)
    assert.deepEqual(counts, {
      profiles: 2,
      ai: 1,
      followup: 1,
      tracking: 2,
      images: 1,
      publicReply: 1,
      privateReply: 1,
    })
    assert.equal(profileWrites.length, 2)
    assert.equal(profileWrites[0].avatar_url, 'https://example.test/avatar.png')
    assert.equal((await f.one('select count(*)::int n from messages')).n, 2)
    assert.equal((await f.one('select count(*)::int n from comments')).n, 1)
    assert.equal(
      (await f.one("select count(*)::int n from facebook_webhook_events where status='completed'"))
        .n,
      3,
    )
    assert.equal(
      (await f.one('select sum(delivery_count)::int n from facebook_webhook_payloads')).n,
      8,
    )
    const productImage = payload('product-image')
    productImage.entry[0].messaging[0].message = {
      mid: 'product-image',
      attachments: [{ type: 'image', payload: { url: 'https://example.test/product.png' } }],
    }
    await deliverBoth(productImage)
    assert.equal(counts.ai, 2)
    assert.equal((await f.one('select count(*)::int n from messages')).n, 3)
    autoVerify = true
    const disabledImage = payload('disabled-image')
    disabledImage.entry[0].messaging[0].message = {
      mid: 'disabled-image',
      attachments: [{ type: 'image', payload: { url: 'https://example.test/disabled.png' } }],
    }
    await deliverBoth(disabledImage)
    assert.equal(
      counts.ai,
      2,
      'an explicitly disabled Vision center cannot fall back to image chat',
    )
    assert.equal(counts.images, 1)
    assert.equal(
      (await f.one("select count(*)::int n from facebook_webhook_events where status='completed'"))
        .n,
      5,
      'disabled images persist without calling the legacy slip verifier',
    )
  } finally {
    await f.pg.close()
  }
})
