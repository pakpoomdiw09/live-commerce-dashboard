const assert = require('node:assert/strict'),
  { test } = require('node:test'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
function load(file, deps = {}, env = {}) {
  const context = {
    exports: {},
    console,
    Date,
    URL,
    Map,
    Set,
    process: { env },
    require: (name) => {
      if (name === '@/lib/features/inbox/standard-message-window')
        return load('lib/features/inbox/standard-message-window.ts')
      if (name in deps) return deps[name]
      throw Error('Unexpected dependency ' + name)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return context.exports
}
const policy = load('lib/features/broadcast/broadcast-policy.ts'),
  now = Date.parse('2026-10-17T05:00:00Z')
const evidence = (at = now - 1000) => ({
  interacted_at: new Date(at).toISOString(),
  kind: 'inbound_message',
  event_id: 'mid-real',
  page_id: 'page',
})
const ready = {
  evidence: evidence(),
  pageId: 'page',
  optedOut: false,
  botEnabled: true,
  pageVerified: true,
  policyVerified: true,
  credits: 10,
}
test('window boundaries, invalid/future/missing evidence and page mismatches fail closed', () => {
  for (const [at, expected] of [
    [now - 86400000 + 1, 'eligible'],
    [now - 86400000, 'outside_window'],
    [now - 86400001, 'outside_window'],
    [now + 1, 'invalid_interaction'],
  ])
    assert.equal(policy.standardWindowReason(evidence(at), 'page', now), expected)
  assert.equal(policy.standardWindowReason(null, 'page', now), 'missing_interaction')
  assert.equal(
    policy.standardWindowReason({ ...evidence(), interacted_at: 'bad' }, 'page', now),
    'invalid_interaction',
  )
  assert.equal(policy.standardWindowReason(evidence(), 'foreign', now), 'invalid_interaction')
  assert.equal(
    policy.standardWindowReason({ ...evidence(), kind: 'read' }, 'page', now),
    'invalid_interaction',
  )
})
test('echoes, receipts, comments, postbacks and untrusted future timestamps cannot open a window', () => {
  const event = {
    sender: { id: 'customer' },
    recipient: { id: 'page' },
    timestamp: now - 5000,
    message: { mid: 'mid-real', text: 'hello' },
  }
  assert.equal(
    policy.inboundBroadcastEvidence(event, 'page', now).interacted_at,
    new Date(now - 5000).toISOString(),
  )
  for (const value of [
    { ...event, message: { ...event.message, is_echo: true } },
    { ...event, message: undefined, read: { watermark: now } },
    { ...event, message: undefined, postback: {} },
    { ...event, timestamp: now + 1 },
    { ...event, timestamp: undefined },
    { ...event, recipient: { id: 'other' } },
  ])
    assert.equal(policy.inboundBroadcastEvidence(value, 'page', now), null)
  assert.equal(
    policy.inboundBroadcastEvidence({ ...event, timestamp: now - 100000 }, 'page', now + 5000)
      .interacted_at,
    new Date(now - 100000).toISOString(),
  )
})
test('opt-out, uncertain consent, page permissions, credits, tags and outside channels are enforced', () => {
  assert.equal(policy.recipientReason(ready, now), 'eligible')
  for (const [patch, expected] of [
    [{ optedOut: true }, 'opted_out'],
    [{ optedOut: undefined }, 'consent_unknown'],
    [{ pageVerified: false }, 'page_unverified'],
    [{ policyVerified: false }, 'policy_unverified'],
    [{ credits: 0 }, 'credits_exhausted'],
    [{ channel: 'outside_24h' }, 'unsupported_channel'],
    [{ tag: 'HUMAN_AGENT' }, 'human_agent_forbidden'],
    [{ tag: 'POST_PURCHASE_UPDATE' }, 'unsupported_channel'],
  ])
    assert.equal(policy.recipientReason({ ...ready, ...patch }, now), expected)
})
test('inbox handoff or closed chats do not opt recipients out of owner-confirmed broadcasts', () => {
  for (const flags of [
    { botEnabled: false },
    { closed: true },
    { botEnabled: false, closed: true },
    { botEnabled: undefined },
  ]) {
    assert.equal(policy.recipientReason({ ...ready, ...flags }, now), 'eligible')
    assert.equal(policy.recipientReason({ ...ready, ...flags, optedOut: true }, now), 'opted_out')
    assert.equal(
      policy.recipientReason({ ...ready, ...flags, evidence: evidence(now - 86400000) }, now),
      'outside_window',
    )
  }
})
test('readiness identifies the specific blocking configuration without granting permission', () => {
  assert.equal(policy.broadcastReadiness(now).reason, 'sending_disabled')
  const env = {
    BROADCAST_STANDARD_SEND_ENABLED: 'true',
    BROADCAST_POLICY_VERSION: policy.BROADCAST_POLICY_VERSION,
    BROADCAST_POLICY_GRAPH_VERSION: 'v24.0',
  }
  assert.equal(
    load('lib/features/broadcast/broadcast-policy.ts', {}, env).broadcastReadiness(now).reason,
    'ready',
  )
  assert.equal(
    load(
      'lib/features/broadcast/broadcast-policy.ts',
      {},
      { ...env, BROADCAST_POLICY_REVIEWED_AT: new Date(now - 31 * 86400000).toISOString() },
    ).broadcastReadiness(now).reason,
    'ready',
  )
})

test('live sending defaults off; UI rollback and an unchecked review cannot authorize it', () => {
  assert.equal(policy.broadcastPolicyVerified(now), false)
  const env = {
    BROADCAST_UI_ENABLED: 'false',
    BROADCAST_STANDARD_SEND_ENABLED: 'true',
    BROADCAST_POLICY_REVIEWED_AT: new Date(now - 1000).toISOString(),
    BROADCAST_POLICY_VERSION: policy.BROADCAST_POLICY_VERSION,
    BROADCAST_POLICY_GRAPH_VERSION: 'v24.0',
  }
  const enabled = load('lib/features/broadcast/broadcast-policy.ts', {}, env)
  assert.equal(enabled.broadcastUiEnabled(), false)
  assert.equal(enabled.broadcastPolicyVerified(now), true)
  assert.equal(
    load(
      'lib/features/broadcast/broadcast-policy.ts',
      {},
      { ...env, FB_GRAPH_VERSION: 'v99.0' },
    ).broadcastPolicyVerified(now),
    true,
  )
  assert.equal(
    load(
      'lib/features/broadcast/broadcast-policy.ts',
      {},
      { ...env, BROADCAST_POLICY_REVIEWED_AT: new Date(now - 31 * 86400000).toISOString() },
    ).broadcastPolicyVerified(now),
    true,
  )
})
class InboxError extends Error {
  constructor(message, status = 400, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
const service = load('lib/features/broadcast/broadcast-service.ts', {
  'server-only': {},
  'node:crypto': require('node:crypto'),
  '@/lib/auth': {},
  '@/lib/supabase/server': {},
  '@/lib/features/billing/billing': {},
  '@/lib/integrations/facebook/client': {},
  '@/lib/features/agents/chatbot': {},
  '@/lib/features/broadcast/broadcast': {},
  '@/lib/features/broadcast/broadcast-policy': policy,
  '@/lib/features/inbox/inbox-server': { InboxError },
  '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
})
const draft = {
  name: 'News',
  message: 'Hello',
  audience_segment: 'all',
  audience_tags: ['paid', 'paid'],
}
test('draft validation allows zero-recipient drafts; rejects unsupported media/tags/scheduling and bounds content', () => {
  assert.equal(service.parseBroadcastDraft(draft).audience_tags.length, 1)
  for (const patch of [
    { message: '' },
    { message: 'x'.repeat(2001) },
    { name: 'x'.repeat(101) },
    { message_tag: 'HUMAN_AGENT' },
    { audience_window: 'outside_24h' },
    { attachments: [] },
    { buttons: [] },
    { scheduled_at: 'tomorrow' },
    { audience_segment: 'forged' },
  ])
    assert.throws(() => service.parseBroadcastDraft({ ...draft, ...patch }))
  assert.equal(
    service.parseBroadcastDraft({ ...draft, eligible: true, timestamp: now }).message,
    draft.message,
  )
})
test('page or content changes invalidate a previously checked fingerprint', () => {
  const fingerprint = service.broadcastSignature('shop', 'page', draft)
  for (const [tenant, page, value] of [
    ['other', 'page', draft],
    ['shop', 'other', draft],
    ['shop', 'page', { ...draft, message: 'Changed' }],
  ])
    assert.notEqual(service.broadcastSignature(tenant, page, value), fingerprint)
})
test('session and foreign tenant are rejected before service data access', async () => {
  let reads = 0
  const guarded = load('lib/features/broadcast/broadcast-service.ts', {
    'server-only': {},
    'node:crypto': require('node:crypto'),
    '@/lib/auth': { canAccessTenant: async () => false },
    '@/lib/supabase/server': {
      supabaseAdmin: () => {
        reads++
        throw Error('No reads')
      },
    },
    '@/lib/features/billing/billing': {},
    '@/lib/integrations/facebook/client': {},
    '@/lib/features/agents/chatbot': {},
    '@/lib/features/broadcast/broadcast': {},
    '@/lib/features/broadcast/broadcast-policy': policy,
    '@/lib/features/inbox/inbox-server': { InboxError },
    '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/ },
  })
  await assert.rejects(
    guarded.broadcastScope(null, '11111111-1111-4111-8111-111111111111'),
    (error) => error.status === 401,
  )
  await assert.rejects(
    guarded.broadcastScope({ kind: 'user' }, '11111111-1111-4111-8111-111111111111'),
    (error) => error.status === 403,
  )
  assert.equal(reads, 0)
})

function sender({
  error = null,
  expires = false,
  live = true,
  page = 'verified',
  selected = null,
} = {}) {
  let sends = 0,
    reservations = 0,
    busy = false,
    balance = 10
  const deliveries = new Map()
  const db = {
    from(table) {
      const q = {
        select() {
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        range: async () => ({
          data: [...deliveries].map(([customer_id, value]) => ({ customer_id, ...value })),
          error: null,
        }),
        maybeSingle: async () => ({
          data:
            table === 'tenants'
              ? { page_id: 'page', is_active: true }
              : table === 'broadcasts'
                ? { ...draft, audience_window: 'within_24h', message_tag: null }
                : { agent_opted_out: false, bot_enabled: true },
          error: null,
        }),
        insert: async () => ({ error: null }),
        update() {
          if (table === 'broadcast_runs') busy = false
          return this
        },
        then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
      }
      return q
    },
    rpc: async (name, args) => {
      if (name === 'claim_broadcast_run') {
        if (busy) return { data: null }
        busy = true
        return { data: 'lease' }
      }
      if (name === 'claim_broadcast_recipient') {
        if (deliveries.has(args.p_customer)) return { data: 'duplicate' }
        reservations++
        balance--
        deliveries.set(args.p_customer, { status: 'claimed' })
        return { data: 'claimed' }
      }
      if (name === 'begin_broadcast_transport') {
        if (expires) {
          deliveries.set(args.p_customer, { status: 'skipped' })
          balance++
          return { data: false }
        }
        return { data: true }
      }
      if (name === 'settle_broadcast_recipient') {
        if (deliveries.get(args.p_customer)?.status === 'claimed') {
          deliveries.set(args.p_customer, { status: args.p_result })
          if (['failed', 'skipped'].includes(args.p_result)) balance++
        }
        return { error: null }
      }
      throw Error('Unexpected RPC ' + name)
    },
  }
  class SendApiError extends Error {
    constructor() {
      super('refused')
      this.status = 400
    }
  }
  const api = load('lib/features/broadcast/broadcast-send.ts', {
    'server-only': {},
    '@/lib/auth': { canAccessTenant: async () => true },
    '@/lib/automation-safety': { assertAutomationRunning: async () => {} },
    '@/lib/features/billing/billing': { getBilling: async () => ({ monthly: balance, topup: 0 }) },
    '@/lib/integrations/facebook/client': {
      SendApiError,
      sendMessageWithReceipt: async () => {
        sends++
        if (error === 'unknown') throw Error('timeout')
        if (error === 'rejected') throw new SendApiError()
        return 'mid-receipt'
      },
    },
    '@/lib/features/broadcast/broadcast-policy': { ...policy, broadcastPolicyVerified: () => live },
    '@/lib/features/broadcast/broadcast-service': {
      broadcastPageStatus: async () => page,
      broadcastSignature: () => 'fingerprint',
      selectedBroadcastCustomers: async () => [{ id: 'customer', platform_user_id: 'psid' }],
      broadcastEvidence: async () => new Map([['customer', evidence(Date.now() - 1000)]]),
    },
    '@/lib/features/inbox/inbox-server': { InboxError },
    '@/lib/features/broadcast/broadcast': { fetchAll: async (fn) => (await fn(0, 999)).data },
  })
  const scope = {
    db,
    actor: { kind: 'user', id: 'owner' },
    tenantId: 'shop',
    page: { page_id: 'page' },
    token: 'mock-token',
  }
  return {
    run: (input = { confirmed: true, fingerprint: 'fingerprint' }) =>
      api.sendBroadcast(
        scope,
        {
          ...draft,
          selected_customer_ids: selected,
          id: 'campaign',
          status: 'draft',
          audience_window: 'within_24h',
          message_tag: null,
        },
        input,
      ),
    sends: () => sends,
    reservations: () => reservations,
    balance: () => balance,
  }
}
test('repeated send/resume never sends or charges the same recipient twice', async () => {
  const f = sender()
  await f.run()
  await f.run()
  assert.equal(f.sends(), 1)
  assert.equal(f.reservations(), 1)
  assert.equal(f.balance(), 9)
})

test('recipient selection excludes every unchecked customer before credit reservation', async () => {
  for (const selected of [[], ['other-customer']]) {
    const f = sender({ selected })
    await f.run()
    assert.equal(f.sends(), 0)
    assert.equal(f.reservations(), 0)
  }
  const chosen = sender({ selected: ['customer'] })
  await chosen.run()
  assert.equal(chosen.sends(), 1)
})

test('AI and Broadcast share the exact 24h boundary clock rule', () => {
  const shared = load('lib/features/inbox/standard-message-window.ts')
  for (const at of [now, now - 1, now - 86400000 + 1, now - 86400000, now - 86400001, now + 1]) {
    assert.equal(
      shared.withinStandardMessageWindow(new Date(at).toISOString(), now),
      policy.standardWindowReason(evidence(at), 'page', now) === 'eligible',
    )
  }
  assert.equal(shared.withinStandardMessageWindow('invalid', now), false)
})

test('concurrent confirmations share the durable run lock', async () => {
  const f = sender()
  const results = await Promise.allSettled([f.run(), f.run()])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(f.sends(), 1)
  assert.equal(f.reservations(), 1)
})
test('network uncertainty is durable; explicit refusal refunds once; neither automatically retries', async () => {
  for (const type of ['unknown', 'rejected']) {
    const f = sender({ error: type })
    const result = await f.run()
    await f.run()
    assert.equal(f.sends(), 1)
    assert.equal(f.balance(), type === 'unknown' ? 9 : 10)
    assert.equal(type === 'unknown' ? result.unknown : result.failed, 1)
  }
})
test('expiry during queue processing skips before transport and returns its reserved credit', async () => {
  const f = sender({ expires: true })
  await f.run()
  assert.equal(f.sends(), 0)
  assert.equal(f.balance(), 10)
})
test('disabled policy, invalid page and a changed preview never reach provider or credit reservation', async () => {
  for (const options of [{ live: false }, { page: 'invalid' }]) {
    const f = sender(options)
    await assert.rejects(f.run())
    assert.equal(f.sends(), 0)
    assert.equal(f.reservations(), 0)
  }
  const f = sender()
  await assert.rejects(f.run({ confirmed: true, fingerprint: 'old' }))
  assert.equal(f.sends(), 0)
})
