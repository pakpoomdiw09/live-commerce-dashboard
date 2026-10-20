import test from 'node:test'
import assert from 'node:assert/strict'

import { chatReplyStrategy } from '../lib/features/agents/chatbot.ts'

test('keyword matches take priority for free and AI-entitled tenants', () => {
  assert.equal(chatReplyStrategy(true, false), 'keyword')
  assert.equal(chatReplyStrategy(true, true), 'keyword')
})

test('unmatched free-tier messages stop without an AI fallback', () => {
  assert.equal(chatReplyStrategy(false, false), 'none')
})

test('unmatched AI-entitled messages use the AI fallback', () => {
  assert.equal(chatReplyStrategy(false, true), 'ai')
})
