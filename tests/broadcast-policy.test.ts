import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BROADCAST_POLICY_VERSION,
  broadcastReadiness,
  inboundBroadcastEvidence,
  recipientReason,
  standardWindowReason,
} from '../lib/features/broadcast/broadcast-policy.ts'

const pageId = '123456'
const now = Date.now()
const inWindowEvent = {
  sender: { id: 'user-42' },
  recipient: { id: pageId },
  timestamp: now - 60_000,
  message: { mid: 'm-1', is_echo: false, text: 'hello' },
}

test('standardWindowReason marks signed inbound activity within 24 hours as eligible', () => {
  assert.equal(
    standardWindowReason(
      {
        interacted_at: new Date(now - 60_000).toISOString(),
        kind: 'inbound_message',
        page_id: pageId,
        event_id: 'evt-1',
      },
      pageId,
      now,
    ),
    'eligible',
  )

  assert.equal(
    standardWindowReason(
      {
        interacted_at: new Date(now + 60_000).toISOString(),
        kind: 'inbound_message',
        page_id: pageId,
        event_id: 'evt-2',
      },
      pageId,
      now,
    ),
    'invalid_interaction',
  )

  assert.equal(
    standardWindowReason(
      {
        interacted_at: new Date(now - 86_400_000 - 1000).toISOString(),
        kind: 'inbound_message',
        page_id: pageId,
        event_id: 'evt-3',
      },
      pageId,
      now,
    ),
    'outside_window',
  )
})

test('recipientReason denies broadcasts when policy, page verification or consent are not met', () => {
  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: false,
        pageVerified: true,
        policyVerified: true,
        credits: 2,
        channel: 'within_24h',
      },
      now,
    ),
    'eligible',
  )

  assert.equal(
    recipientReason(
      {
        evidence: null,
        pageId,
        optedOut: false,
        pageVerified: true,
        policyVerified: true,
        credits: 2,
        channel: 'within_24h',
      },
      now,
    ),
    'missing_interaction',
  )

  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: true,
        pageVerified: true,
        policyVerified: true,
        credits: 2,
        channel: 'within_24h',
      },
      now,
    ),
    'opted_out',
  )

  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: false,
        pageVerified: false,
        policyVerified: true,
        credits: 2,
        channel: 'within_24h',
      },
      now,
    ),
    'page_unverified',
  )

  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: false,
        pageVerified: true,
        policyVerified: false,
        credits: 2,
        channel: 'within_24h',
      },
      now,
    ),
    'policy_unverified',
  )

  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: false,
        pageVerified: true,
        policyVerified: true,
        credits: 0,
        channel: 'within_24h',
      },
      now,
    ),
    'credits_exhausted',
  )

  assert.equal(
    recipientReason(
      {
        evidence: {
          interacted_at: new Date(now - 60_000).toISOString(),
          kind: 'inbound_message',
          page_id: pageId,
          event_id: 'evt-1',
        },
        pageId,
        optedOut: false,
        pageVerified: true,
        policyVerified: true,
        credits: 1,
        tag: 'HUMAN_AGENT',
      },
      now,
    ),
    'human_agent_forbidden',
  )
})

test('broadcastReadiness blocks sends until environment and review checks are satisfied', () => {
  const previous = { ...process.env }

  process.env.BROADCAST_STANDARD_SEND_ENABLED = 'false'
  process.env.BROADCAST_POLICY_VERSION = 'old'
  process.env.BROADCAST_POLICY_GRAPH_VERSION = 'v24.0'
  process.env.BROADCAST_POLICY_REVIEWED_AT = new Date(now - 1000).toISOString()

  assert.deepEqual(broadcastReadiness(now), {
    ready: false,
    reason: 'sending_disabled',
    message:
      'ร้านนี้ยังไม่ได้เปิดส่งบรอดแคสต์ บันทึกฉบับร่างไว้ก่อนและให้เจ้าของร้านตรวจสอบการตั้งค่าการส่ง',
  })

  process.env.BROADCAST_STANDARD_SEND_ENABLED = 'true'
  process.env.BROADCAST_POLICY_VERSION = BROADCAST_POLICY_VERSION
  process.env.BROADCAST_POLICY_GRAPH_VERSION = 'v23.0'
  process.env.BROADCAST_POLICY_REVIEWED_AT = new Date(now - 1000).toISOString()

  assert.deepEqual(broadcastReadiness(now), {
    ready: false,
    reason: 'review_version_mismatch',
    message: 'การตั้งค่าการส่งยังไม่ตรงกับระบบปัจจุบัน กรุณาให้ผู้ดูแลตรวจสอบก่อนส่ง',
  })

  process.env.BROADCAST_POLICY_GRAPH_VERSION = 'v24.0'
  process.env.BROADCAST_POLICY_REVIEWED_AT = new Date(now - 31 * 86_400_000).toISOString()
  assert.equal(broadcastReadiness(now).reason, 'review_expired')

  process.env.BROADCAST_POLICY_REVIEWED_AT = new Date(now - 1_000).toISOString()
  assert.equal(broadcastReadiness(now).ready, true)

  Object.assign(process.env, previous)
})

test('inboundBroadcastEvidence only accepts signed inbound messages from the page itself', () => {
  const direct = inboundBroadcastEvidence(inWindowEvent, pageId, now)
  assert.deepEqual(direct, {
    interacted_at: new Date(now - 60_000).toISOString(),
    kind: 'inbound_message',
    page_id: pageId,
    event_id: 'm-1',
  })

  assert.equal(
    inboundBroadcastEvidence(
      {
        sender: { id: 'user-42' },
        recipient: { id: 'other-page' },
        timestamp: now - 60_000,
        message: { mid: 'm-2', is_echo: false, text: 'hello' },
      },
      pageId,
      now,
    ),
    null,
  )

  assert.equal(
    inboundBroadcastEvidence(
      {
        sender: { id: pageId },
        recipient: { id: pageId },
        timestamp: now - 60_000,
        message: { mid: 'm-3', is_echo: false, text: 'hello' },
      },
      pageId,
      now,
    ),
    null,
  )
})
