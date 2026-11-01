import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as crypto from 'node:crypto'
import { test } from 'node:test'
import { NextRequest, NextResponse } from 'next/server'
import * as core from '../../../lib/features/commerce/commerce-core'

const require = createRequire(import.meta.url)
const load = require('../../../scripts/helpers/load-typescript.cjs')
const tenantId = '11111111-1111-4111-8111-111111111111'

test('product options require owner scope before accessing categories and return private uncached data', async () => {
  let denied = false,
    reads = 0
  const category = { id: '77777777-7777-4777-8777-777777777777', name: 'พระเครื่อง' }
  const route = load('app/api/commerce/product-options/route.ts', {
    'next/server': { NextResponse },
    '@/lib/features/commerce/commerce-server': {
      async commerceScope(id: string, write: boolean, req: NextRequest) {
        assert.equal(id, tenantId)
        assert.equal(write, true)
        assert.ok(req)
        if (denied) throw new core.CommerceError('ไม่มีสิทธิ์จัดการร้านนี้', 403)
        return { tenantId }
      },
      async commerceProductCategories(scope: { tenantId: string }) {
        assert.equal(scope.tenantId, tenantId)
        reads++
        return [category]
      },
      commerceResponse(error: core.CommerceError) {
        return NextResponse.json({ error: error.message }, { status: error.status })
      },
    },
  })
  const req = new NextRequest(
    `https://shop.example/api/commerce/product-options?tenantId=${tenantId}`,
  )
  const allowed = await route.GET(req)
  assert.equal(allowed.status, 200)
  assert.deepEqual(await allowed.json(), { categories: [category] })
  assert.equal(allowed.headers.get('cache-control'), 'private, no-store')
  denied = true
  assert.equal((await route.GET(req)).status, 403)
  assert.equal(reads, 1)
})

test('category picker pages through tenant-scoped rows and fails rather than returning partial options', async () => {
  let queries = 0,
    fail = false
  const first = Array.from({ length: 200 }, (_, i) => ({
    id: String(i).padStart(3, '0'),
    name: `หมวด ${i}`,
  }))
  const server = load('lib/features/commerce/commerce-server.ts', {
    'server-only': {},
    'node:crypto': crypto,
    'next/server': { NextResponse },
    '@/lib/auth': {},
    '@/lib/supabase/server': {},
    '@/lib/features/commerce/commerce-core': core,
  })
  const db = {
    from(table: string) {
      assert.equal(table, 'commerce_categories')
      let cursor: string | undefined
      const query = {
        select(fields: string) {
          assert.equal(fields, 'id,name')
          return query
        },
        eq(key: string, value: string) {
          assert.equal(key, 'tenant_id')
          assert.equal(value, tenantId)
          return query
        },
        order(key: string) {
          assert.equal(key, 'id')
          return query
        },
        limit(max: number) {
          assert.equal(max, 200)
          return query
        },
        gt(key: string, value: string) {
          assert.equal(key, 'id')
          cursor = value
          return query
        },
        then(resolve: (result: unknown) => unknown) {
          queries++
          return Promise.resolve({
            data: cursor ? [{ id: '200', name: 'พระเครื่อง' }] : first,
            error: fail && cursor ? new Error('category read failed') : null,
          }).then(resolve)
        },
      }
      return query
    },
  }
  const categories = await server.commerceProductCategories({ db, tenantId })
  assert.equal(categories.length, 201)
  assert.equal(queries, 2)
  assert.ok(categories.some((row: { name: string }) => row.name === 'พระเครื่อง'))
  fail = true
  await assert.rejects(server.commerceProductCategories({ db, tenantId }), /category read failed/)
})
