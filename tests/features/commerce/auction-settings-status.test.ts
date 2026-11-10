import assert from 'node:assert/strict'
import test from 'node:test'
import { auctionSettingsStatus } from '../../../lib/features/commerce/auction-settings-status'

test('auction settings status reports loaded settings, loading, and failure without claiming auction automation is working', () => {
  assert.deepEqual(auctionSettingsStatus(false, false), {
    label: 'โหลดการตั้งค่าแล้ว',
    badgeClass: 'bg-emerald-500 text-white',
    dotClass: 'bg-white',
  })
  assert.equal(auctionSettingsStatus(true, false).label, 'กำลังตรวจสอบการตั้งค่า')
  assert.equal(auctionSettingsStatus(true, true).label, 'ตรวจสอบการตั้งค่าไม่ได้')
  assert.notEqual(auctionSettingsStatus(true, true).badgeClass, 'bg-emerald-500 text-white')
})
