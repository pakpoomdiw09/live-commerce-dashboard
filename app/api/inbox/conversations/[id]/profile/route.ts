import { NextRequest, NextResponse } from 'next/server'
import { inboxCustomer, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { getCustomerProfile, pageTokenFor } from '@/lib/integrations/facebook/client'
import { CUSTOMER_COLUMNS } from '@/lib/types'

type Context = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const maxDuration = 30

/** Re-fetch one tenant-scoped Facebook customer profile with the Page's saved token. */
export async function POST(req: NextRequest, { params }: Context) {
  try {
    const { db, customer, tenantId } = await inboxCustomer(req, (await params).id)
    const [identity, page] = await Promise.all([
      db
        .from('customers')
        .select('platform,platform_user_id')
        .eq('id', customer.id)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      db
        .from('tenants')
        .select('page_id,page_access_token')
        .eq('id', tenantId)
        .eq('is_active', true)
        .maybeSingle(),
    ])
    if (identity.error || page.error) throw identity.error || page.error
    if (
      identity.data?.platform !== 'facebook' ||
      !/^\d+$/.test(identity.data.platform_user_id ?? '')
    )
      throw new InboxError('ลูกค้ารายนี้ไม่ใช่ Facebook Messenger', 400, 'PROFILE_NOT_FACEBOOK')
    if (!page.data?.page_id)
      throw new InboxError('ร้านนี้ยังไม่ได้ผูก Facebook Page', 409, 'PAGE_NOT_LINKED')

    const token = pageTokenFor(page.data)
    if (!token)
      throw new InboxError('ไม่พบ Page Access Token ของร้านนี้', 409, 'PAGE_TOKEN_MISSING')
    const profile = await getCustomerProfile(token, identity.data.platform_user_id)
    if (!profile.display_name && !profile.avatar_url)
      throw new InboxError(
        'Meta ยังไม่ส่งชื่อหรือรูปของลูกค้า กรุณาตรวจสอบสิทธิ์และ Page token',
        502,
        'FACEBOOK_PROFILE_UNAVAILABLE',
      )

    const saved = await db
      .from('customers')
      .update(profile)
      .eq('id', customer.id)
      .eq('tenant_id', tenantId)
      .eq('platform', 'facebook')
      .eq('platform_user_id', identity.data.platform_user_id)
      .select(CUSTOMER_COLUMNS)
      .maybeSingle()
    if (saved.error) throw saved.error
    if (!saved.data) throw new InboxError('ไม่พบลูกค้า', 404, 'CUSTOMER_NOT_FOUND')
    return NextResponse.json(
      { customer: saved.data, updatedFields: Object.keys(profile) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
