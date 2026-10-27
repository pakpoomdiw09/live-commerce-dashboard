import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_WITHOUT_AVATAR,
  isMissingCustomerAvatarColumn,
} from '@/lib/types'
import { UUID } from '@/lib/utils'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await inboxTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    const before = req.nextUrl.searchParams.get('before'),
      id = req.nextUrl.searchParams.get('beforeId'),
      customerId = req.nextUrl.searchParams.get('customerId'),
      includeComments = req.nextUrl.searchParams.get('includeComments') === 'true'
    if (customerId && !UUID.test(customerId))
      throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
    const load = (withAvatar: boolean) => {
      let query = withAvatar
        ? db
            .from('customers')
            .select(
              `${CUSTOMER_COLUMNS},messages(sender,body,attachments,created_at),slips(status,created_at)`,
            )
            .eq('tenant_id', tenantId)
            .eq('slips.tenant_id', tenantId)
        : db
            .from('customers')
            .select(
              `${CUSTOMER_COLUMNS_WITHOUT_AVATAR},messages(sender,body,attachments,created_at),slips(status,created_at)`,
            )
            .eq('tenant_id', tenantId)
            .eq('slips.tenant_id', tenantId)
      if (customerId) query = query.eq('id', customerId)
      if (before) {
        if (!UUID.test(id ?? '') || (before !== 'null' && !Number.isFinite(Date.parse(before))))
          throw new InboxError('ตัวแบ่งหน้าไม่ถูกต้อง')
        if (before === 'null') query = query.is('last_message_at', null).lt('id', id!)
        else {
          const time = new Date(before).toISOString()
          query = query.or(
            `last_message_at.lt.${time},and(last_message_at.eq.${time},id.lt.${id}),last_message_at.is.null`,
          )
        }
      }
      return query
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .order('created_at', { ascending: false, referencedTable: 'messages' })
        .limit(1, { referencedTable: 'messages' })
        .order('created_at', { ascending: false, referencedTable: 'slips' })
        .limit(1, { referencedTable: 'slips' })
        .limit(101)
    }
    const commentsQuery = includeComments
      ? db
          .from('comments')
          .select('id,tenant_id,author_name,body,created_at')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(100)
      : Promise.resolve({ data: null, error: null })
    let [result, comments] = await Promise.all([load(true), commentsQuery])
    if (isMissingCustomerAvatarColumn(result.error)) result = await load(false)
    if (result.error || comments.error) throw result.error || comments.error
    return NextResponse.json(
      {
        chats: (result.data ?? []).slice(0, 100).map(({ messages, slips, ...customer }) => ({
          customer,
          preview: messages[0] ?? null,
          latestSlip: slips[0]?.status ?? null,
        })),
        hasMore: (result.data?.length ?? 0) > 100,
        ...(includeComments ? { comments: comments.data ?? [] } : {}),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
