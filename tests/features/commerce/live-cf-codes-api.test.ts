import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'
import * as codes from '../../../lib/features/commerce/live-cf-codes'
import * as cf from '../../../lib/features/commerce/cf-code'
import { extractFacebookLiveId } from '../../../lib/features/commerce/live-cf-setup'
import { liveRuleCode } from '../../../lib/features/comments/comment-rules'

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')
const tenantId = '11111111-1111-4111-8111-111111111111'
const productId = '33333333-3333-4333-8333-333333333333'
const ruleId = '44444444-4444-4444-8444-444444444444'

function fixture() {
  const state = {
    authorized: true,
    reads: 0,
    writes: [] as Record<string, any>[],
    updateScope: [] as unknown[][],
    logs: [] as unknown[][],
  }
  const route = load(
    'app/api/live-cf/setup/route.ts',
    {
      'next/server': { NextResponse },
      '@/lib/auth': {
        getActor: async () => ({ kind: 'user', id: 'owner' }),
        canAccessTenant: async (_actor: unknown, tenant: string, role: string) => {
          assert.equal(tenant, tenantId)
          assert.equal(role, 'owner')
          return state.authorized
        },
      },
      '@/lib/supabase/server': {
        supabaseAdmin: () => ({
          from(table: string) {
            const query = {
              select: () => query,
              eq(key: string, value: unknown) {
                state.updateScope.push([table, key, value])
                return query
              },
              maybeSingle: async () => {
                state.reads++
                return {
                  data: table === 'tenants' ? { page_id: '100' } : { id: productId },
                  error: null,
                }
              },
              insert(row: Record<string, any>) {
                state.writes.push(row)
                return query
              },
              update(row: Record<string, any>) {
                state.writes.push(row)
                return query
              },
              single: async () => ({ data: { id: ruleId }, error: null }),
            }
            return query
          },
        }),
      },
      '@/lib/feature-flags': { isFeatureEnabled: () => true },
      '@/lib/features/commerce/cf-code': cf,
      '@/lib/features/commerce/live-cf-codes': codes,
      '@/lib/features/commerce/live-cf-payment-link': { liveCfPaymentLinksReady: () => true },
      '@/lib/features/commerce/live-cf-setup': { extractFacebookLiveId },
      '@/lib/utils': { UUID: /^[0-9a-f-]{36}$/i },
    },
    { console: { error() {}, info: (...args: unknown[]) => state.logs.push(args) } },
  )
  const send = (extra: Record<string, unknown>) =>
    route.POST(
      new NextRequest('https://shop.example/api/live-cf/setup', {
        method: 'POST',
        headers: { origin: 'https://shop.example', 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          productId,
          pageId: '100',
          livePostId: '',
          stockLimit: 5,
          privateReply: false,
          publicReply: true,
          isActive: true,
          ...extra,
        }),
      }),
    ) as Promise<NextResponse>
  return { state, send }
}

test('Live CF setup saves every tag to keywords for create/update and accepts legacy single-code requests', async () => {
  const { state, send } = fixture()
  assert.equal((await send({ codes: ['A1', '159', 'จอง'] })).status, 200)
  assert.deepEqual([...state.writes[0].keywords], ['a1', '159', 'จอง'])
  assert.equal((await send({ id: ruleId, codes: ['B1', '259'], matchMode: 'strict' })).status, 200)
  assert.deepEqual([...state.writes[1].keywords], ['b1', '259'])
  assert.equal(state.writes[1].match_type, 'exact')
  assert.ok(
    state.updateScope.some(
      ([table, key, value]) =>
        table === 'comment_rules' && key === 'tenant_id' && value === tenantId,
    ),
  )
  assert.equal((await send({ code: 'Legacy' })).status, 200)
  assert.deepEqual([...state.writes[2].keywords], ['legacy'])
  assert.equal(
    (
      await send({
        codes: ['A1'],
        variantId: productId,
        customerSelectVariant: true,
        privateReply: true,
        bankAccountId: productId,
      })
    ).status,
    200,
  )
  assert.equal(state.writes[3].live_customer_select_variant, true)
  assert.equal(state.writes[3].live_variant_id, null)
})

test('switching Exact to Contains persists the selected mode and reloaded rules use the preview matcher', async () => {
  const { state, send } = fixture()
  assert.equal((await send({ codes: ['CF159'], matchMode: 'strict' })).status, 200)
  assert.equal(state.writes[0].match_type, 'exact')
  const exactRule = state.writes[0] as { keywords: string[]; match_type: 'exact' }
  assert.equal(liveRuleCode(exactRule, 'cf159?'), null)
  assert.equal((await send({ id: ruleId, codes: ['CF159'], matchMode: 'flexible' })).status, 200)
  assert.equal(state.writes[1].match_type, 'keyword')
  const containsRule = state.writes[1] as { keywords: string[]; match_type: 'keyword' }
  assert.equal(liveRuleCode(containsRule, 'เอา cf 159?!'), 'cf159')
  assert.equal((await send({ id: ruleId, codes: ['CF159'], matchMode: 'strict' })).status, 200)
  assert.equal(liveRuleCode(state.writes[2] as typeof exactRule, 'เอา cf 159?!'), null)
})

test('the picked video ID is saved in the existing live post scope for comment routing', async () => {
  const { state, send } = fixture()
  assert.equal(
    (await send({ codes: ['159'], livePostId: '789', matchMode: 'flexible' })).status,
    200,
  )
  assert.equal(state.writes[0].live_post_id, '789')
  assert.deepEqual([...state.writes[0].page_ids], ['100'])
  const saved = state.logs.find((entry) => entry[0] === '[live-cf/setup] saved')?.[1] as Record<
    string,
    unknown
  >
  assert.equal(saved.livePostId, '789')
  assert.equal(saved.reception, 'webhook')
  assert.equal(saved.pollingStarted, false)
})

test('Live CF setup rejects empty, duplicate and excessive tags before database writes and preserves owner checks', async () => {
  const { state, send } = fixture()
  for (const value of [
    [],
    null,
    'A1',
    [1],
    [''],
    ['A1', 'a1'],
    ['a'.repeat(41)],
    ['A1', 'B1', 'C1', 'D1', 'E1', 'F1'],
  ]) {
    const response = await send({ codes: value, code: 'legacy-must-not-override' })
    assert.equal(response.status, 400, JSON.stringify(value))
    assert.equal(state.writes.length, 0)
    assert.equal(state.reads, 0)
  }
  state.authorized = false
  assert.equal((await send({ codes: ['A1'] })).status, 403)
  assert.equal(state.writes.length, 0)
})
