import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError } from '@/lib/features/inbox/inbox-server'
import {
  CUSTOMER_COLUMNS,
  CUSTOMER_COLUMNS_WITHOUT_AVATAR,
  isMissingCustomerAvatarColumn,
} from '@/lib/types'
export async function GET(req: NextRequest) {
  try {
    const { db, tenantId } = await inboxTenant(req, req.nextUrl.searchParams.get('tenantId') ?? '')
    const q = (req.nextUrl.searchParams.get('q') ?? '')
      .trim()
      .slice(0, 100)
      .replace(/[\\%_]/g, '\\$&')
    if (q.length < 2) return NextResponse.json({ customerIds: [], chats: [] })
    const [result, names, phones] = await Promise.all([
      db
        .from('messages')
        .select('customer_id,customers!inner(tenant_id)')
        .eq('customers.tenant_id', tenantId)
        .ilike('body', `%${q}%`)
        .order('created_at', { ascending: false })
        .limit(200),
      db
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('display_name', `%${q}%`)
        .limit(100),
      db
        .from('customers')
        .select('id')
        .eq('tenant_id', tenantId)
        .ilike('phone', `%${q}%`)
        .limit(100),
    ])
    for (const row of [result, names, phones]) if (row.error) throw row.error
    const ids = [
      ...new Set([
        ...(result.data ?? []).map((row) => row.customer_id),
        ...(names.data ?? []).map((row) => row.id),
        ...(phones.data ?? []).map((row) => row.id),
      ]),
    ].slice(0, 100)
    if (!ids.length) return NextResponse.json({ customerIds: [], chats: [] })
    const load = (withAvatar: boolean) =>
      withAvatar
        ? db
            .from('customers')
            .select(
              `${CUSTOMER_COLUMNS},messages(sender,body,attachments,created_at),slips(status,created_at)`,
            )
            .eq('tenant_id', tenantId)
            .eq('slips.tenant_id', tenantId)
            .in('id', ids)
            .order('created_at', { ascending: false, referencedTable: 'messages' })
            .limit(1, { referencedTable: 'messages' })
            .order('created_at', { ascending: false, referencedTable: 'slips' })
            .limit(1, { referencedTable: 'slips' })
            .limit(100)
        : db
            .from('customers')
            .select(
              `${CUSTOMER_COLUMNS_WITHOUT_AVATAR},messages(sender,body,attachments,created_at),slips(status,created_at)`,
            )
            .eq('tenant_id', tenantId)
            .eq('slips.tenant_id', tenantId)
            .in('id', ids)
            .order('created_at', { ascending: false, referencedTable: 'messages' })
            .limit(1, { referencedTable: 'messages' })
            .order('created_at', { ascending: false, referencedTable: 'slips' })
            .limit(1, { referencedTable: 'slips' })
            .limit(100)
    let chats = await load(true)
    if (isMissingCustomerAvatarColumn(chats.error)) chats = await load(false)
    if (chats.error) throw chats.error
    return NextResponse.json(
      {
        customerIds: ids,
        chats: (chats.data ?? []).map(({ messages, slips, ...customer }) => ({
          customer,
          preview: messages[0] ?? null,
          latestSlip: slips[0]?.status ?? null,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
