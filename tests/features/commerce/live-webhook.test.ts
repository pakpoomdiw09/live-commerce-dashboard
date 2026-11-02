import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NextResponse } from 'next/server'
import * as envelope from '../../../lib/integrations/facebook/webhook-envelope'
import * as routing from '../../../lib/features/comments/live-comment-routing'
import * as rules from '../../../lib/features/comments/comment-rules'
import * as cf from '../../../lib/features/commerce/cf-code'
import { handleLiveCfComment } from '../../../lib/features/commerce/live-cf-comment'
import { createLiveCfMetaAdapter } from '../../../lib/integrations/facebook/live-cf-adapter'
import { redactFacebookDiagnostic } from '../../../lib/integrations/facebook/diagnostics'

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')
const token = 'TEST_PAGE_TOKEN_SECRET'
const commentId = '456_789'
const payload = (value: Record<string, unknown>, field = 'feed') =>
  Buffer.from(
    JSON.stringify({
      object: 'page',
      entry: [{ id: '100', changes: [{ field, value }] }],
    }),
  )
const silent = { log() {}, info() {}, warn() {}, error() {} }

function clientFixture(fetch: typeof globalThis.fetch) {
  const errors: string[] = []
  const api = load(
    'lib/integrations/facebook/client.ts',
    {
      '@/lib/safe-logging': {
        createLogRequestId: () => 'test',
        logSafeEvent() {},
        maskErrorCode() {},
      },
    },
    {
      fetch,
      process: { env: {} },
      AbortSignal,
      console: { ...silent, error: (line: string) => errors.push(line) },
    },
  )
  return { api, errors }
}

test('feed/live_comments canonicalize comment IDs, nested authors and video IDs before deduplication', () => {
  const variants = [
    {
      comment_id: commentId,
      item: 'comment',
      verb: 'add',
      from: { id: '900' },
      message: 'CF fc159',
      video_id: '456',
    },
    {
      item: 'live_comment',
      comment: { id: commentId, from: { id: 900 }, message: 'CF fc159' },
      video: { id: '456' },
    },
    { id: commentId, sender_id: '900', text: 'CF fc159', live_video_id: '456' },
  ]
  const parsed = variants.map(
    (v, i) => envelope.parseWebhook(payload(v, i === 2 ? 'live_comments' : 'feed')).events[0],
  )
  for (const event of parsed) {
    assert.equal(event.payload.value.comment_id, commentId)
    assert.equal(event.payload.value.from.id, '900')
    assert.equal(event.payload.value.post_id, '456')
    assert.equal(event.payload.value.message, 'CF fc159')
    assert.equal(event.payload.value.item, 'comment')
    assert.equal(event.payload.value.verb, 'add')
    assert.equal(event.eventKey, parsed[0].eventKey)
  }
  for (const verb of ['edited', 'remove'])
    assert.equal(
      envelope.parseWebhook(payload({ ...variants[0], verb })).events[0].payload.value.verb,
      verb,
    )
  const post = envelope.parseWebhook(payload({ item: 'post', id: '777', message: 'CF fc159' }))
    .events[0]
  assert.equal(post.payload.value.item, 'post')
})

test('every entry routes by its normalized Page ID; unsafe numeric IDs cannot silently lose precision', () => {
  const body = {
    object: 'page',
    entry: [
      { id: 100, changes: [{ field: 'feed', value: { item: 'comment', comment_id: '100_1' } }] },
      { id: '200', changes: [{ field: 'feed', value: { item: 'comment', comment_id: '200_2' } }] },
    ],
  }
  assert.deepEqual(
    envelope.parseWebhook(Buffer.from(JSON.stringify(body))).events.map((e) => e.pageId),
    ['100', '200'],
  )
  assert.throws(
    () =>
      envelope.parseWebhook(
        Buffer.from(
          JSON.stringify({
            ...body,
            entry: [{ ...body.entry[0], id: Number.MAX_SAFE_INTEGER + 1 }],
          }),
        ),
      ),
    /Invalid Page entry/,
  )
})

test('Live CF private/public replies address the original comment, with structured sanitized Meta errors', async () => {
  const requests: { url: string; body: any }[] = []
  const f = clientFixture(async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ id: 'reply-id' })
  })
  await f.api.sendPrivateReply(token, commentId, 'bill link', '100')
  await f.api.replyToComment(token, commentId, 'confirmed')
  assert.match(requests[0].url, /\/456_789\/private_replies$/)
  assert.deepEqual(requests[0].body, { message: 'bill link' })
  assert.match(requests[1].url, /\/456_789\/comments$/)
  assert.deepEqual(requests[1].body, { message: 'confirmed' })
  const refused = clientFixture(async () =>
    Response.json(
      {
        error: {
          type: 'OAuthException',
          code: 200,
          error_subcode: 2018,
          fbtrace_id: 'trace',
          message: `missing permission ${token} ${commentId} confirmed`,
        },
      },
      { status: 400 },
    ),
  )
  await assert.rejects(
    refused.api.replyToComment(token, commentId, 'confirmed'),
    (e: any) => e.code === 200 && e.subcode === 2018,
  )
  assert.ok(refused.errors[0].includes('OAuthException'))
  assert.ok(refused.errors[0].includes('trace'))
  for (const secret of [token, commentId, 'confirmed'])
    assert.ok(!refused.errors[0].includes(secret))
})

test('only a definitive unsupported private edge may fall back to Page messages with recipient.comment_id', async () => {
  const sent: any[] = []
  const f = clientFixture(async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return sent.length === 1
      ? Response.json(
          {
            error: {
              code: 100,
              message: 'Tried accessing nonexisting field (private_replies) on node type (Comment)',
            },
          },
          { status: 400 },
        )
      : Response.json({ message_id: 'mid' })
  })
  await f.api.sendPrivateReply(token, commentId, 'bill', '100')
  assert.equal(sent.length, 2)
  assert.match(sent[1].url, /\/100\/messages$/)
  assert.deepEqual(sent[1].body, {
    recipient: { comment_id: commentId },
    message: { text: 'bill' },
  })
  for (const [status, code] of [
    [400, 190],
    [403, 200],
    [429, 4],
    [500, 100],
    [400, 100],
  ]) {
    let calls = 0
    const failed = clientFixture(async () => {
      calls++
      return Response.json({ error: { code, message: 'permission or provider error' } }, { status })
    })
    await assert.rejects(failed.api.sendPrivateReply(token, commentId, 'bill', '100'))
    assert.equal(calls, 1)
  }
  let calls = 0
  const timeout = clientFixture(async () => {
    calls++
    throw new Error('timeout')
  })
  await assert.rejects(timeout.api.sendPrivateReply(token, commentId, 'bill', '100'))
  assert.equal(calls, 1)
})

test('live lookup accepts direct Video IDs and resolves Page post attachments without treating recordings as live', async () => {
  const direct = clientFixture(async (url) => {
    assert.match(String(url), /\/456\?fields=live_status$/)
    return Response.json({ live_status: 'LIVE' })
  })
  assert.equal((await direct.api.resolveLiveCommentVideo(token, '456')).live, true)
  const attached = clientFixture(async (url) =>
    String(url).includes('/100_777?')
      ? Response.json({ attachments: { data: [{ media_type: 'video', target: { id: '456' } }] } })
      : Response.json({ live_status: 'LIVE' }),
  )
  const resolved = await attached.api.resolveLiveCommentVideo(token, '100_777')
  assert.equal(resolved.live, true)
  assert.deepEqual(Array.from(resolved.ids), ['456'])
  const recorded = clientFixture(async () => Response.json({ live_status: 'VOD' }))
  assert.equal((await recorded.api.resolveLiveCommentVideo(token, '456')).live, false)
})

function handlerFixture(
  options: {
    post?: string | null
    duplicate?: boolean
    author?: boolean
    resolved?: string[]
    mode?: string
    keywords?: string[]
    auctionHandled?: boolean
  } = {},
) {
  const traces: { label: string; data: any }[] = []
  const orders: any[] = [],
    sends: any[] = [],
    scopes: any[] = []
  const checkpoints = new Map<string, unknown>()
  const rule = {
    id: 'rule',
    tenant_id: 'tenant',
    name: 'Live',
    mode: 'live_cf',
    is_active: true,
    match_type: options.mode ?? 'keyword',
    keywords: options.keywords ?? ['fc159'],
    live_post_id: options.post === undefined ? '456' : options.post,
    inbox_enabled: true,
    reply_enabled: true,
    page_ids: ['100'],
  }
  const db = {
    from(table: string) {
      const query: any = {
        select: () => query,
        update: () => query,
        eq: (key: string, value: unknown) => {
          scopes.push([table, key, value])
          return query
        },
        contains: () => query,
        order: () => query,
        maybeSingle: async () => ({
          data:
            table === 'tenants' ? { id: 'tenant', page_id: '100', page_access_token: token } : null,
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: table === 'comment_rules' ? [rule] : null, error: null }).then(
            resolve,
          ),
      }
      return query
    },
  }
  const client = clientFixture(async (url, init) => {
    sends.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({ id: 'sent' })
  }).api
  const handler = load(
    'lib/integrations/facebook/webhook-handler.ts',
    {
      '@/lib/supabase/server': { supabaseAdmin: () => db },
      '@/lib/integrations/facebook/client': {
        ...client,
        resolveLiveCommentVideo: async () => ({
          live: !!options.resolved?.length,
          ids: options.resolved ?? [],
        }),
      },
      '@/lib/features/comments/comment-rules': rules,
      '@/lib/features/comments/live-comment-routing': routing,
      '@/lib/features/agents/chatbot-server': {},
      '@/lib/features/commerce/orders': {
        placeCfOrder: async (_db: unknown, input: any) => {
          orders.push(input)
          return {
            status: 'created',
            orderId: 'order',
            name: 'เสื้อยืด',
            code: input.code,
            amount: 159,
            variantLabel: null,
          }
        },
        pendingOrders: async () => ({ ids: ['order'], total: 159 }),
      },
      '@/lib/features/commerce/messenger-product-server': {},
      '@/lib/features/commerce/live-cf-comment': { handleLiveCfComment },
      '@/lib/features/commerce/customer-tabs-server': { tabForOrder: async () => null },
      '@/lib/features/commerce/auction-server': {
        handleAuctionComment: async (input: any) => {
          traces.push({ label: 'auction-route', data: input.value })
          return options.auctionHandled ?? false
        },
      },
      '@/lib/features/commerce/live-cf-payment-link': {
        createLiveCfPaymentLink: () => 'https://shop.example/pay/live/signed',
      },
      '@/lib/integrations/facebook/live-cf-adapter': { createLiveCfMetaAdapter },
      '@/lib/feature-flags': { isFeatureEnabled: () => true },
      '@/lib/features/banking/banks': {},
      '@/lib/features/slips/process': {},
      '@/lib/features/slips/notify': {},
      '@/lib/features/slips/image': {},
      '@/lib/message-quota': {
        sendWithMessageCredit: (_db: unknown, tenant: string, send: () => unknown) => {
          assert.equal(tenant, 'tenant')
          return send()
        },
      },
      '@/lib/features/follow-ups/followup-ai': {},
      '@/lib/features/vision/vision': {},
      '@/lib/features/broadcast/broadcast-policy': {},
      '@/lib/integrations/facebook/message-window': {},
      '@/lib/features/inbox/inbox-automation-window': {},
    },
    {
      process: { env: { FB_PAGE_ID: '200' } },
      console: { ...silent, info: (label: string, data: any) => traces.push({ label, data }) },
    },
  )
  return {
    orders,
    traces,
    sends,
    scopes,
    receive: async (text: string, extra: Record<string, unknown> = {}, field = 'feed') => {
      const event = envelope.parseWebhook(
        payload(
          {
            comment_id: commentId,
            item: 'comment',
            verb: 'add',
            from: { id: '900' },
            post_id: '100_777',
            video_id: '456',
            message: text,
            ...extra,
          },
          field,
        ),
      ).events[0]
      await handler.handleFacebookWebhookEvent({
        event: { id: 'event', page_id: event.pageId, kind: event.kind, payload: event.payload },
        persistRecord: async (tenant: string) => {
          assert.equal(tenant, 'tenant')
          return {
            duplicate: options.duplicate ?? false,
            id: 'comment-row',
            customer: options.author === false ? null : { id: 'customer' },
          }
        },
        once: async (key: string, work: () => Promise<unknown>) => {
          if (!checkpoints.has(key)) checkpoints.set(key, await work())
          return checkpoints.get(key)
        },
      })
    },
  }
}

test('signed comment pipeline matches literal SKUs case-insensitively, passes the matched video to SQL and deduplicates both replies', async () => {
  for (const text of ['CF fc159', 'รับ fc159', 'FC159', 'เอา fc 159?']) {
    const f = handlerFixture()
    await f.receive(text)
    await f.receive(text)
    assert.equal(f.orders.length, 1)
    assert.equal(f.orders[0].code, 'fc159')
    assert.equal(f.orders[0].postId, '456')
    assert.equal(f.orders[0].tenantId, 'tenant')
    assert.ok(
      f.traces.some(
        (t) =>
          t.label === '[facebook-webhook/page] resolved' &&
          t.data.matchesConfiguredPage === false &&
          t.data.blockedByConfiguredPage === false,
      ),
    )
    assert.equal(f.sends.length, 2)
    assert.ok(
      f.sends.some(
        (s) =>
          /\/456_789\/private_replies$/.test(s.url) && s.body.message.includes('/pay/live/signed'),
      ),
    )
    assert.ok(f.sends.some((s) => /\/456_789\/comments$/.test(s.url)))
    assert.ok(
      f.scopes.some((s) => s[0] === 'comments' && s[1] === 'tenant_id' && s[2] === 'tenant'),
    )
  }
  const attached = handlerFixture({ resolved: ['456'] })
  await attached.receive('CF fc159', { video_id: undefined })
  assert.equal(attached.orders[0].postId, '456')
})

test('auction host commands route before the Page-own-comment filter and consume the CF path', async () => {
  const host = handlerFixture({ auctionHandled: true })
  await host.receive('ปิด', { from: { id: '100' } })
  assert.ok(
    host.traces.some((trace) => trace.label === 'auction-route' && trace.data.message === 'ปิด'),
  )
  assert.equal(host.orders.length, 0)
  assert.equal(host.sends.length, 0)
  const customer = handlerFixture({ auctionHandled: true })
  await customer.receive('fc159')
  assert.equal(customer.orders.length, 0, 'auction-scoped comments cannot also place a CF order')
})

test('diagnostics distinguish a configured keyword mismatch from a session mismatch', async () => {
  for (const text of ['777', 'กระเป๋า']) {
    const f = handlerFixture({ keywords: ['as159'] })
    await f.receive(text)
    assert.equal(f.orders.length, 0)
    assert.ok(f.traces.some((t) => t.data.reason === 'NO_MATCHING_LIVE_KEYWORD'))
    assert.ok(
      f.traces.some(
        (t) => t.label === '[live-cf/match] evaluated' && t.data.liveRules[0].matchedCode === null,
      ),
    )
  }
  const scoped = handlerFixture({ post: '888' })
  await scoped.receive('fc159')
  assert.ok(scoped.traces.some((t) => t.data.reason === 'NO_MATCHING_LIVE_SESSION'))
})

test('wrong sessions, edits/removals, missing authors, Page replies, duplicate comments and Exact mismatches never create orders', async () => {
  const scenarios: {
    options?: Parameters<typeof handlerFixture>[0]
    extra?: Record<string, unknown>
    text?: string
  }[] = [
    { options: { post: '888' } },
    { options: { duplicate: true } },
    { options: { author: false }, extra: { from: undefined } },
    { extra: { from: { id: '100' } } },
    { extra: { verb: 'edited' } },
    { extra: { verb: 'remove' } },
    { options: { mode: 'exact' }, text: 'รับ fc159' },
    { text: 'สวัสดีค่ะ' },
    { options: { post: null }, extra: { video_id: undefined } },
  ]
  for (const scenario of scenarios) {
    const f = handlerFixture(scenario.options)
    await f.receive(scenario.text ?? 'fc159', scenario.extra)
    assert.equal(f.orders.length, 0)
    assert.equal(f.sends.length, 0)
  }
})

test('invalid signatures neither log customer payloads nor enqueue; verified raw logs redact secrets', async () => {
  const logs: string[] = []
  let queued = 0
  const secret = 'TEST_APP_SECRET'
  const http = load(
    'lib/integrations/facebook/webhook-http.ts',
    {
      'server-only': {},
      'next/server': { NextResponse, after() {} },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          rpc: async () => {
            queued++
            return { data: { id: 'receipt', accepted: 1 }, error: null }
          },
        }),
      },
      '@/lib/integrations/facebook/webhook-envelope': envelope,
      '@/lib/integrations/facebook/webhook-worker': {},
      '@/lib/integrations/facebook/webhook-handler': {},
      '@/lib/integrations/facebook/diagnostics': { redactFacebookDiagnostic },
    },
    {
      URL,
      process: { env: { FB_APP_SECRET: secret } },
      console: { ...silent, log: (...args: unknown[]) => logs.push(JSON.stringify(args)) },
    },
  )
  const body = payload({
    comment_id: commentId,
    item: 'comment',
    message: 'CUSTOMER_PAYLOAD',
    access_token: token,
  })
  const request = (signature: string) =>
    new Request('https://shop.example/api/webhook/facebook', {
      method: 'POST',
      body,
      headers: { 'x-hub-signature-256': signature },
    })
  assert.equal((await http.postFacebookWebhook(request('sha256=' + '0'.repeat(64)))).status, 401)
  assert.equal(queued, 0)
  assert.ok(logs.some((line) => line.includes('[facebook-webhook/request] received')))
  assert.ok(!logs.join().includes('CUSTOMER_PAYLOAD'))
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
  assert.equal((await http.postFacebookWebhook(request(signature))).status, 200)
  assert.equal(queued, 1)
  assert.ok(logs.join().includes('CUSTOMER_PAYLOAD'))
  assert.ok(!logs.join().includes(token))
  const rawLog = logs
    .flatMap((line) => JSON.parse(line))
    .find((line) => typeof line === 'string' && line.startsWith('[facebook-webhook/raw] '))
  assert.ok(rawLog.includes('\n  "object"'), 'verified JSON is pretty-printed')
})
