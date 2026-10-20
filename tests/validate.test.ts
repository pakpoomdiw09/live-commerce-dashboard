import test from 'node:test'
import assert from 'node:assert/strict'

import { parseCustomerInput, parseTenantInput } from '../lib/validation.ts'

test('parseTenantInput accepts valid tenant settings', () => {
  const result = parseTenantInput({
    name: '  ร้านส้มโอ  ',
    bank_code: 'kbank',
    account_number: '123-456-7890',
    account_name: '  มนัส มนัส  ',
    page_id: '123456789',
    expected_amount: '250.50',
    auto_reply_enabled: true,
    auto_verify_enabled: false,
    slip_quota: 50,
    page_access_token: 'abcdEFGH1234567890abcdefg',
  }, false)

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.value, {
    name: 'ร้านส้มโอ',
    bank_code: 'KBANK',
    account_number: '1234567890',
    account_name: 'มนัส มนัส',
    page_id: '123456789',
    expected_amount: 250.5,
    auto_reply_enabled: true,
    auto_verify_enabled: false,
    slip_quota: 50,
    page_access_token: 'abcdEFGH1234567890abcdefg',
  })
})

test('parseTenantInput rejects invalid data before saving', () => {
  assert.deepEqual(parseTenantInput({ name: '', bank_code: 'NOPE' }, false), {
    ok: false,
    error: 'ชื่อร้านต้องมี 1-120 ตัวอักษร',
  })

  assert.deepEqual(parseTenantInput({ name: 'Valid', bank_code: 'KTB', account_number: '12' }, false), {
    ok: false,
    error: 'เลขบัญชี / พร้อมเพย์ต้องเป็นตัวเลข 10-15 หลัก',
  })

  assert.deepEqual(parseTenantInput({ name: 'Valid', bank_code: 'KTB', account_number: '1234567890', page_access_token: 'bad!' }, false), {
    ok: false,
    error: 'Page Access Token ไม่ถูกต้อง',
  })
})

test('parseTenantInput supports partial updates without requiring every field', () => {
  const result = parseTenantInput({
    auto_reply_enabled: true,
    page_access_token: '',
    account_name: '  ทอง  ',
  }, true)

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.equal(result.value.auto_reply_enabled, true)
  assert.equal(result.value.page_access_token, null)
  assert.equal(result.value.account_name, 'ทอง')
})

test('parseCustomerInput validates CRM updates and tag deduplication', () => {
  const result = parseCustomerInput({
    display_name: '  กานต์  ',
    phone: '+66 81-234-5678',
    address: '  123 Main St  ',
    tags: ['vip', 'vip', ' new ', 'VIP'],
    notes: '  คุยเรื่องออเดอร์  ',
    order_status: 'paid',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return

  assert.deepEqual(result.value, {
    display_name: 'กานต์',
    phone: '+66812345678',
    address: '123 Main St',
    tags: ['vip', 'new', 'VIP'],
    notes: 'คุยเรื่องออเดอร์',
    order_status: 'paid',
  })
})

test('parseCustomerInput rejects malformed arrays and oversized fields', () => {
  assert.deepEqual(parseCustomerInput({ tags: 'vip' }), {
    ok: false,
    error: 'tags must be an array',
  })

  assert.deepEqual(parseCustomerInput({ display_name: 'x'.repeat(121) }), {
    ok: false,
    error: 'ชื่อลูกค้ายาวเกิน 120 ตัวอักษร',
  })

  assert.deepEqual(parseCustomerInput({ phone: 'abc' }), {
    ok: false,
    error: 'เบอร์โทรไม่ถูกต้อง',
  })

  assert.deepEqual(parseCustomerInput({ order_status: 'unknown-status' as never }), {
    ok: false,
    error: 'สถานะออเดอร์ไม่ถูกต้อง',
  })
})

test('parseCustomerInput requires something to update', () => {
  assert.deepEqual(parseCustomerInput({}), {
    ok: false,
    error: 'nothing to update',
  })
})
