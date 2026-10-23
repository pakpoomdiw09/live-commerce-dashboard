import test from 'node:test'
import assert from 'node:assert/strict'

import { isMissingCustomerAvatarColumn, isMissingDatabaseColumn } from '../lib/types.ts'

test('recognizes a missing optional customer avatar column', () => {
  assert.equal(
    isMissingCustomerAvatarColumn({
      code: '42703',
      message: 'column customers.avatar_url does not exist',
    }),
    true,
  )
  assert.equal(
    isMissingCustomerAvatarColumn({
      code: 'PGRST204',
      message: "Could not find the 'avatar_url' column in the schema cache",
    }),
    true,
  )
})

test('does not mask unrelated database errors as an avatar migration issue', () => {
  assert.equal(
    isMissingCustomerAvatarColumn({
      code: '42703',
      message: 'column customers.phone does not exist',
    }),
    false,
  )
  assert.equal(
    isMissingCustomerAvatarColumn({ code: '42501', message: 'permission denied' }),
    false,
  )
  assert.equal(isMissingCustomerAvatarColumn(null), false)
})

test('detects only named optional columns when chatbot schema migrations are incomplete', () => {
  assert.equal(
    isMissingDatabaseColumn(
      { code: '42703', message: 'column bot_settings.fallback_messages does not exist' },
      'fallback_messages',
    ),
    true,
  )
  assert.equal(
    isMissingDatabaseColumn(
      { code: '42703', message: 'column customers.conversation_version does not exist' },
      'conversation_version',
    ),
    true,
  )
  assert.equal(
    isMissingDatabaseColumn(
      { code: '42703', message: 'column customers.handover_at does not exist' },
      'conversation_version',
    ),
    false,
  )
})
