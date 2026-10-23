import { temporaryFullAccess } from '@/lib/full-access'
// Plans and broadcast credit packs. Shared by the dashboard and the API. Keep in sync with supabase/billing.sql.

export type PlanId = 'free' | 'starter' | 'pro'

export type Plan = {
  name: string
  /** baht per month */
  price: number
  /** broadcast messages per month */
  credits: number
  /** may broadcast past Meta's 24-hour window with a message tag */
  messageTags: boolean
}

export const PLANS: Record<PlanId, Plan> = {
  free: { name: 'ใช้งานฟรี', price: 0, credits: 100, messageTags: false },
  starter: { name: 'แพ็กเกจเริ่มต้น', price: 9, credits: 1_500, messageTags: true },
  pro: { name: 'แพ็กเกจมืออาชีพ', price: 19, credits: 7_500, messageTags: true },
}

export type TopupId = 'topup_s' | 'topup_m' | 'topup_l'

/** Extra broadcast credits for every plan. They don't expire. */
export const TOPUPS: Record<TopupId, { name: string; price: number; credits: number }> = {
  topup_s: { name: 'เติมส่งข้อความ S', price: 100, credits: 400 },
  topup_m: { name: 'เติมส่งข้อความ M', price: 300, credits: 1_500 },
  topup_l: { name: 'เติมส่งข้อความ L', price: 500, credits: 3_000 },
}

export type SlipTopupId = 'slip_topup_s' | 'slip_topup_m' | 'slip_topup_l'
export const SLIP_TOPUPS: Record<SlipTopupId, { name: string; price: number; credits: number }> = {
  slip_topup_s: { name: 'เติมตรวจสลิป S', price: 100, credits: 500 },
  slip_topup_m: { name: 'เติมตรวจสลิป M', price: 300, credits: 2_000 },
  slip_topup_l: { name: 'เติมตรวจสลิป L', price: 600, credits: 5_000 },
}

/** What a shop can buy: a month of a paid plan, or a top-up pack. */
export type BillingItem = Exclude<PlanId, 'free'> | TopupId | SlipTopupId

export const BILLING_ITEMS: Record<BillingItem, { name: string; price: number; credits: number }> =
  {
    starter: PLANS.starter,
    pro: PLANS.pro,
    ...TOPUPS,
    ...SLIP_TOPUPS,
  }

export const isSlipTopup = (item: BillingItem): item is SlipTopupId =>
  item.startsWith('slip_topup_')
export const billingUnit = (item: BillingItem) =>
  isSlipTopup(item) ? 'รายการตรวจสลิป' : 'ข้อความบรอดแคสต์'

export const isTopup = (item: BillingItem): item is TopupId | SlipTopupId =>
  item.startsWith('topup_') || isSlipTopup(item)

/** A tenant's plan and broadcast credits right now. */
export type Billing = {
  /** Server-computed exemption, never accepted from request payloads. */
  featureBypass?: boolean
  plan: PlanId
  planExpiresAt: string | null
  /** this month's plan credits left */
  monthly: number
  /** plan credits per month */
  allowance: number
  /** bought credits left */
  topup: number
  /** Total slip entitlement (base quota + accumulated purchases), less checks used. */
  slipRemaining: number
  slipQuotaCredits: number
}

export const creditsLeft = (b: Billing) => b.monthly + b.topup

export const canUseFollowUps = (
  b: Pick<Billing, 'plan' | 'planExpiresAt' | 'featureBypass'>,
  now = Date.now(),
) =>
  temporaryFullAccess ||
  ((b.plan === 'starter' || b.plan === 'pro') &&
    b.planExpiresAt !== null &&
    Date.parse(b.planExpiresAt) > now)

/** UI helper only; server execution must use database feature-access guards. */
export const canUseAiAgent = (b: Pick<Billing, 'plan' | 'planExpiresAt'>, now = Date.now()) =>
  temporaryFullAccess ||
  (b.plan === 'pro' && b.planExpiresAt !== null && Date.parse(b.planExpiresAt) > now)

export const canUseAutoSlip = (
  b: Pick<Billing, 'plan' | 'planExpiresAt' | 'featureBypass'>,
  credits: number,
  now = Date.now(),
) =>
  temporaryFullAccess ||
  ((b.plan === 'starter' || b.plan === 'pro') &&
    b.planExpiresAt !== null &&
    Date.parse(b.planExpiresAt) > now &&
    credits > 0)

export type BillingRequestRow = {
  id: string
  tenant_id: string
  item: BillingItem
  price_baht: number
  credits: number
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  note: string | null
  created_at: string
  decided_at: string | null
  proof_path?: string | null
  verification_status?: 'pending' | 'failed' | 'verified'
  verification_error?: string | null
}

export const BILLING_REQUEST_COLUMNS =
  'id, tenant_id, item, price_baht, credits, status, note, created_at, decided_at'

export const UPGRADE_FOR_TAGS =
  'แพ็กเกจฟรีส่งข้อความได้เฉพาะลูกค้าภายใน 24 ชม. กรุณาอัปเกรดแพ็กเกจเพื่อส่งหาลูกค้าที่ไม่ได้ทักเกิน 24 ชม. โดยเลือกหมวดหมู่ข้อความให้ตรงกับเนื้อหา'
export const OUT_OF_CREDITS = 'เครดิตบรอดแคสต์หมดแล้ว อัปเกรดแพ็กเกจหรือเติมเครดิตเพื่อส่งต่อ'
