import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const load = require('../scripts/helpers/load-typescript.cjs')

test('F01 receiver skips and missing receiver accounts cannot reach settlement as valid', () => {
  const process = readFileSync('lib/features/slips/process.ts', 'utf8')
  const tab = readFileSync('lib/features/slips/customer-tab-slip.ts', 'utf8')
  assert.match(process, /r\.receiverCheckSkipped \|\| accounts\.length === 0[\s\S]*?verdict = 'error'/)
  assert.match(tab, /result\.receiverCheckSkipped \|\| receiverAccounts\.length === 0[\s\S]*?verdict = 'error'/)
})

test('F02 legacy approved slips return before pending orders are queried or paid', () => {
  const route = readFileSync('app/api/slips/[id]/approve/route.ts', 'utf8')
  const guard = route.indexOf('if (slip.approved_at) return')
  assert.ok(guard >= 0)
  assert.ok(guard < route.indexOf('pendingOrders(db'))
  const process = readFileSync('lib/features/slips/process.ts', 'utf8')
  assert.match(process, /\.eq\('status', 'pending_payment'\)/)
})

test('F03 cancellation is guarded by a database trigger and owner membership check', () => {
  const migration = readFileSync('supabase/migrations/20261113120000_orders_owner_only_cancel.sql', 'utf8')
  assert.match(migration, /before update of status on public\.orders/i)
  assert.match(migration, /tm\.role = 'owner'/)
  assert.match(migration, /request\.jwt\.claim\.role.*service_role/)
})

test('F04 generated complete schema is current and migration source checks are preserved', () => {
  const generated = readFileSync('supabase/complete_schema.sql', 'utf8')
  assert.match(generated, /Applied migration changed:/)
  assert.match(generated, /orders_owner_only_cancel on public\.orders/)
})

test('F05 a persisted inbound message still retries failures before dispatch completion', () => {
  const worker = readFileSync('lib/integrations/facebook/webhook-worker.ts', 'utf8')
  assert.match(worker, /p_outcome: review \? 'requires_review' : 'retry'/)
})

test('F06 routes use the bounded stream reader rather than request.formData directly', () => {
  for (const path of [
    'app/api/payments/verify-slip/route.ts',
    'app/api/billing/requests/[id]/proof/route.ts',
    'app/api/inbox/media/route.ts',
    'app/api/payment-codes/route.ts',
  ]) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /readUploadForm\(/, path)
    assert.doesNotMatch(source, /req\.formData\(/, path)
  }
})

test('F07 explicit public false overrides the legacy live auction flag', () => {
  const flags = load('lib/feature-flags.ts', {}, { process: { env: { NEXT_PUBLIC_ENABLE_LIVE_CF: 'false', ENABLE_LIVE_CF: 'true' } } })
  assert.equal(flags.isFeatureEnabled('live_cf'), false)
  assert.equal(flags.LIVE_CF_ENABLED, false)
})
