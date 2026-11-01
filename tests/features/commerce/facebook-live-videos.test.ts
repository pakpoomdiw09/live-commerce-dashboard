import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')
const tenantId = '11111111-1111-4111-8111-111111111111'
const secret = 'private-page-token-must-never-leak'
const live = {
  id: '900',
  status: 'LIVE',
  title: 'ไลฟ์เสื้อผ้าวันนี้',
  creation_time: '2026-11-01T03:00:00+0000',
  broadcast_start_time: '2026-11-01T04:00:00+0000',
  video: { id: '456', picture: 'https://cdn.example/live.webp' },
  secure_stream_url: secret,
}

function fixture() {
  const state = {
    signedIn: true,
    authorized: true,
    found: true,
    limited: false,
    token: secret as string | null,
    dbError: false,
    tokenReads: 0,
    reads: 0,
    rateCalls: 0,
    queries: [] as [string, unknown][],
    calls: [] as { url: URL; init: RequestInit }[],
    responses: [{ data: [live] }] as any[],
    statuses: [] as number[],
    tokenInfo: {
      data: {
        is_valid: true,
        type: 'PAGE',
        profile_id: '100',
        scopes: ['pages_read_engagement'],
        expires_at: 0,
      },
    } as any,
    tokenStatus: 200,
    tokenCalls: [] as { url: URL; init: RequestInit }[],
    logs: [] as unknown[],
  }
  const client = load(
    'lib/integrations/facebook/live-videos.ts',
    {
      'server-only': {},
      './client': { graph: (path: string) => `https://graph.facebook.com/v24.0/${path}` },
    },
    {
      URL,
      URLSearchParams,
      AbortSignal,
      setTimeout,
      process: { env: { FB_APP_ID: 'app-1', FB_APP_SECRET: 'app-secret-test' } },
      console: { log: (...values: unknown[]) => state.logs.push(values) },
      fetch: async (url: string, init: RequestInit) => {
        if (new URL(url).pathname.endsWith('/debug_token')) {
          state.tokenCalls.push({ url: new URL(url), init })
          return Response.json(state.tokenInfo, { status: state.tokenStatus })
        }
        state.calls.push({ url: new URL(url), init })
        const response = state.responses.shift() ?? { data: [] }
        if (response instanceof Error || init.signal?.aborted) throw new Error(secret)
        return Response.json(response, { status: state.statuses.shift() ?? 200 })
      },
    },
  )
  const route = load(
    'app/api/facebook/live-videos/route.ts',
    {
      'next/server': { NextResponse },
      '@/lib/auth': {
        getActor: async () => (state.signedIn ? { kind: 'user', id: 'owner' } : null),
        canAccessTenant: async (_actor: unknown, id: string, role: string) => {
          assert.equal(id, tenantId)
          assert.equal(role, 'owner')
          return state.authorized
        },
      },
      '@/lib/feature-flags': { isFeatureEnabled: () => true },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          from(table: string) {
            assert.equal(table, 'tenants')
            let columns = ''
            const query = {
              select(value: string) {
                columns = value
                return query
              },
              eq(key: string, value: unknown) {
                state.queries.push([key, value])
                return query
              },
              async maybeSingle() {
                state.reads++
                if (columns.includes('page_access_token')) {
                  state.tokenReads++
                  assert.equal(
                    state.authorized,
                    true,
                    'No secret read before permission is established',
                  )
                  return { data: { page_id: '100', page_access_token: state.token }, error: null }
                }
                return {
                  data: state.found ? { id: tenantId } : null,
                  error: state.dbError ? { message: secret } : null,
                }
              },
            }
            return query
          },
          async rpc(name: string, input: { p_bucket: string; p_max: number }) {
            state.rateCalls++
            assert.equal(name, 'commerce_rate_limit')
            assert.equal(input.p_bucket, `facebook-live:${tenantId}:owner`)
            assert.equal(input.p_max, 12)
            return { data: !state.limited, error: null }
          },
        }),
      },
      '@/lib/integrations/facebook/client': {
        pageTokenFor: (row: { page_access_token: string | null }) => row.page_access_token,
      },
      '@/lib/integrations/facebook/live-videos': client,
    },
    { AbortSignal, console: { info: (...values: unknown[]) => state.logs.push(values) } },
  )
  const send = (query = '?page_id=100') =>
    route.GET(
      new NextRequest(`https://shop.example/api/facebook/live-videos${query}`),
    ) as Promise<NextResponse>
  return { state, send, client }
}

test('live picker authorizes the owning shop, keeps tokens server-side and returns only LIVE video post IDs', async () => {
  const { state, send } = fixture()
  state.responses = [
    {
      data: [
        live,
        { ...live, id: '901', status: 'VOD' },
        {
          id: '902',
          status: 'LIVE_NOW',
          description: 'ไลฟ์ไม่มีหัวข้อ',
          creation_time: '2026-11-01T02:00:00+0000',
          video: { id: '457', picture: 'javascript:alert(1)' },
        },
      ],
    },
  ]
  const result = await send()
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  const payload = await result.json()
  assert.deepEqual(payload, {
    pageId: '100',
    fallback: false,
    videos: [
      {
        id: '456',
        title: live.title,
        thumbnail: live.video.picture,
        createdAt: '2026-11-01T04:00:00.000Z',
        isLive: true,
      },
      {
        id: '457',
        title: 'ไลฟ์ไม่มีหัวข้อ',
        thumbnail: null,
        createdAt: '2026-11-01T02:00:00.000Z',
        isLive: true,
      },
    ],
  })
  assert.equal(JSON.stringify(payload).includes(secret), false)
  assert.ok(state.queries.some(([key, value]) => key === 'id' && value === tenantId))
  assert.ok(state.queries.some(([key, value]) => key === 'page_id' && value === '100'))
  const request = state.calls[0]
  assert.equal(request.url.pathname, '/v24.0/100/live_videos')
  assert.equal(request.url.searchParams.get('broadcast_status'), '["LIVE"]')
  assert.equal(request.url.searchParams.get('limit'), '10')
  assert.ok(request.url.searchParams.get('fields')!.includes('video{id,picture}'))
  assert.equal(request.url.searchParams.has('access_token'), false)
  assert.equal((request.init.headers as Record<string, string>).Authorization, `Bearer ${secret}`)
  assert.equal(request.init.cache, 'no-store')
  assert.equal(state.tokenCalls.length, 1)
  assert.equal(
    (state.tokenCalls[0].init.headers as Record<string, string>).Authorization,
    'Bearer app-1|app-secret-test',
  )
})

test('anonymous, foreign-shop, missing-page and rate-limited requests never read a secret or call Graph', async () => {
  for (const mode of ['anonymous', 'foreign', 'missing', 'limited', 'invalid'] as const) {
    const { state, send } = fixture()
    state.signedIn = mode !== 'anonymous'
    state.authorized = mode !== 'foreign'
    state.found = mode !== 'missing'
    state.limited = mode === 'limited'
    const result = await send(
      mode === 'invalid' ? '?page_id=100/other?access_token=bad' : undefined,
    )
    assert.equal(
      result.status,
      { anonymous: 401, foreign: 403, missing: 403, limited: 429, invalid: 400 }[mode],
    )
    assert.equal(state.tokenReads, 0, mode)
    assert.equal(state.calls.length, 0, mode)
    assert.equal(state.tokenCalls.length, 0, mode)
    assert.equal(result.headers.get('cache-control'), 'private, no-store')
  }
})

test('missing credentials, expired permission, provider limits and database errors return safe actionable errors', async () => {
  const missing = fixture()
  missing.state.token = null
  assert.equal((await missing.send()).status, 409)
  assert.equal(missing.state.calls.length, 0)
  for (const [code, status] of [
    [190, 409],
    [200, 403],
    [4, 429],
    [999, 502],
  ]) {
    const { state, send } = fixture()
    state.responses = [{ error: { code, message: secret } }]
    const result = await send()
    assert.equal(result.status, status)
    assert.equal((await result.text()).includes(secret), false)
    if (status === 429) assert.equal(result.headers.get('retry-after'), '30')
  }
  const broken = fixture()
  broken.state.dbError = true
  const response = await broken.send()
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes(secret), false)
})

test('pagination rebuilds trusted Graph URLs and never follows provider paging URLs or exposes unsafe thumbnails', async () => {
  const { state, send } = fixture()
  state.responses = [
    {
      data: [live],
      paging: {
        next: `https://evil.example/?access_token=${secret}`,
        cursors: { after: 'cursor-1' },
      },
    },
    {
      data: [
        {
          ...live,
          video: { id: '789', picture: `https://cdn.example/image?access_token=${secret}` },
        },
      ],
    },
  ]
  const result = await send()
  assert.equal(result.status, 200)
  const payload = await result.json()
  assert.equal(payload.videos.length, 2)
  assert.equal(payload.videos.find((video: { id: string }) => video.id === '789').thumbnail, null)
  assert.equal(state.calls.length, 2)
  assert.ok(state.calls.every((call) => call.url.hostname === 'graph.facebook.com'))
  assert.equal(state.calls[1].url.searchParams.get('after'), 'cursor-1')
  assert.equal(JSON.stringify(payload).includes(secret), false)
})

test('empty LIVE lists are distinct from malformed data, pagination loops and provider outages', async () => {
  const empty = fixture()
  empty.state.responses = [{ data: [] }]
  assert.deepEqual(await (await empty.send()).json(), {
    pageId: '100',
    videos: [],
    fallback: false,
  })
  const report = (empty.state.logs as any[]).find(
    (entry) => entry[0] === '[facebook/live-videos] result',
  )[1]
  assert.equal(report.liveCount, 0)
  assert.equal(report.videoCount, 0)
  const malformed = fixture()
  malformed.state.responses = [{ data: null }]
  assert.equal((await malformed.send()).status, 502)
  const loop = fixture()
  loop.state.responses = Array(2).fill({
    data: [live],
    paging: { next: 'ignored', cursors: { after: 'same' } },
  })
  assert.equal((await loop.send()).status, 502)
  const retry = fixture()
  retry.state.responses = [new Error(secret), { data: [live] }]
  assert.equal((await retry.send()).status, 200)
  assert.equal(retry.state.calls.length, 2)
  const outage = fixture()
  outage.state.responses = [new Error(secret), new Error(secret)]
  const response = await outage.send()
  assert.equal(response.status, 503)
  assert.equal((await response.text()).includes(secret), false)
})

test('unfiltered broadcasts recover empty or unsupported filters and infer live viewers only without an explicit status', async () => {
  const emptyFilter = fixture()
  emptyFilter.state.responses = [
    { data: [] },
    {
      data: [
        { ...live, status: undefined, live_views: '12' },
        { ...live, status: 'VOD', live_views: 500, video: { id: '777' } },
        { ...live, status: undefined, live_views: 0, video: { id: '778' } },
      ],
    },
  ]
  const result = await (await emptyFilter.send()).json()
  assert.equal(result.fallback, false)
  assert.deepEqual(
    result.videos.map((video: any) => video.id),
    ['456'],
  )
  assert.equal(emptyFilter.state.calls.length, 2)
  assert.equal(emptyFilter.state.calls[1].url.searchParams.has('broadcast_status'), false)
  const unsupported = fixture()
  unsupported.state.responses = [
    { error: { code: 100, type: 'OAuthException', message: 'Unsupported broadcast_status' } },
    { data: [live] },
  ]
  assert.equal((await unsupported.send()).status, 200)
  assert.equal(
    unsupported.state.calls[1].url.searchParams.get('fields'),
    'id,title,description,creation_time,status,video{id,picture}',
  )
  const unsupportedField = fixture()
  unsupportedField.state.responses = [
    { data: [] },
    { error: { code: 100, message: 'Unsupported live_views' } },
    { data: [live] },
  ]
  assert.equal((await unsupportedField.send()).status, 200)
  assert.equal(unsupportedField.state.calls[2].url.searchParams.has('broadcast_status'), false)
  assert.equal(
    unsupportedField.state.calls[2].url.searchParams.get('fields')?.includes('live_views'),
    false,
  )
})

test('no LIVE results offer at most three recent Page videos with explicit non-live flags', async () => {
  const { state, send } = fixture()
  state.responses = [
    { data: [] },
    { data: [{ ...live, status: 'LIVE_STOPPED', live_views: 100 }] },
    {
      data: [1, 3, 2, 4].map((index) => ({
        id: String(index),
        title: 'วิดีโอ ' + index,
        picture: 'https://cdn.example/recent.webp',
        created_time: '2026-11-0' + index + 'T04:00:00+0000',
        live_status: 'VOD',
      })),
    },
  ]
  const result = await send()
  assert.equal(result.status, 200)
  const payload = await result.json()
  assert.equal(payload.fallback, true)
  const report = (state.logs as any[]).find(
    (entry) => entry[0] === '[facebook/live-videos] result',
  )[1]
  assert.equal(report.liveCount, 0)
  assert.equal(report.videoCount, 3)
  assert.equal(report.fallback, true)
  assert.deepEqual(
    payload.videos.map((video: any) => video.id),
    ['4', '3', '2'],
  )
  assert.ok(payload.videos.every((video: any) => video.isLive === false))
  assert.equal(state.calls[2].url.pathname, '/v24.0/100/videos')
  assert.equal(state.calls[2].url.searchParams.get('limit'), '3')
})

test('stored User tokens, foreign Page tokens, expired access and missing permissions cannot read videos', async () => {
  for (const [info, status, reason] of [
    [{ type: 'USER' }, 409, 'User Access Token'],
    [{ profile_id: '200' }, 409, 'เพจอื่น'],
    [{ is_valid: false }, 409, 'ถูกเพิกถอน'],
    [{ is_valid: false, type: undefined }, 409, 'ถูกเพิกถอน'],
    [{ profile_id: undefined }, 503, 'ตรวจสอบเพจ'],
    [{ expires_at: 1 }, 409, 'หมดอายุ'],
    [{ data_access_expires_at: 1 }, 409, 'หมดอายุ'],
    [{ scopes: ['pages_messaging'] }, 403, 'pages_read_engagement'],
    [{ type: undefined }, 503, 'ตรวจสอบชนิดโทเคน'],
  ] as const) {
    const { state, send } = fixture()
    state.tokenInfo.data = { ...state.tokenInfo.data, ...info }
    const response = await send()
    assert.equal(response.status, status)
    assert.ok((await response.text()).includes(reason))
    assert.equal(state.calls.length, 0)
    assert.equal(state.tokenCalls.length, 1)
  }
})

test('OAuth errors stay actionable while raw response logs and frontend errors redact every credential', async () => {
  const { state, send } = fixture()
  state.responses = [
    {
      error: {
        code: 200,
        type: 'OAuthException',
        message:
          'Requires pages_read_engagement; token=' + secret + ' client_secret=app-secret-test',
      },
      paging: { next: 'https://graph.facebook.com/?access_token=' + secret },
      access_token: secret,
      secure_stream_url: secret,
    },
  ]
  const response = await send()
  assert.equal(response.status, 403)
  const text = await response.text()
  assert.ok(text.includes('OAuthException'))
  assert.ok(text.includes('pages_read_engagement'))
  assert.ok(text.includes('#200'))
  const logs = JSON.stringify(state.logs)
  assert.ok(logs.includes('Graph response'))
  assert.ok(logs.includes('OAuthException'))
  assert.ok(logs.includes('[REDACTED]'))
  for (const value of [secret, 'app-secret-test', 'app-1|app-secret-test']) {
    assert.equal(text.includes(value), false)
    assert.equal(logs.includes(value), false)
  }
  assert.equal(
    state.calls.length,
    1,
    'Permissions must fail rather than masquerade as an empty list or fallback',
  )
  const empty = fixture()
  empty.state.responses = [{ data: [] }, { data: [] }, { data: [] }]
  await empty.send()
  assert.ok(JSON.stringify(empty.state.logs).includes('"data":[]'))
})
