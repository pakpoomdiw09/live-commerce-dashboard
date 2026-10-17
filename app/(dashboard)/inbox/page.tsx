import { hasFeature } from '@/lib/feature-access'
import { FeatureLocked } from '@/components/FeatureLocked'
import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant } from '@/lib/tenant'
import { SetupNotice } from '@/components/SetupNotice'
import { CUSTOMER_COLUMNS, type CustomerRow, type MessageRow, type SlipStatus } from '@/lib/types'
import type { ChatSummary, CommentItem } from '@/components/inbox/InboxClient'
import { SmartInboxV2 } from '@/components/inbox/SmartInboxV2'
import { InlineError } from '@/components/ErrorState'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'กล่องข้อความรวม' }

type Preview = Pick<MessageRow, 'sender' | 'body' | 'attachments' | 'created_at'>
type Row = CustomerRow & { messages: Preview[]; slips: { status: SlipStatus }[] }

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const [db, tenant, { customer: requested }] = await Promise.all([supabaseServer(), getActiveTenant(), searchParams])
  if (!tenant) return <SetupNotice kind="no-tenant" />
  if (!(await hasFeature(db, tenant.id, 'customer_management'))) return <FeatureLocked />

  let customersQuery = db
    .from('customers')
    // newest message (chat list preview) and newest slip (status badge) per customer
    .select(`${CUSTOMER_COLUMNS}, messages(sender, body, attachments, created_at), slips(status, created_at)`)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .order('created_at', { ascending: false, referencedTable: 'messages' })
    .limit(1, { referencedTable: 'messages' })
    .order('created_at', { ascending: false, referencedTable: 'slips' })
    .limit(1, { referencedTable: 'slips' })
    .limit(150)
  let commentsQuery = db.from('comments').select('id, tenant_id, author_name, body, created_at').order('created_at', { ascending: false }).limit(100)
  if (tenant) {
    customersQuery = customersQuery.eq('tenant_id', tenant.id).eq('slips.tenant_id', tenant.id)
    commentsQuery = commentsQuery.eq('tenant_id', tenant.id)
  }

  const [customers, comments] = await Promise.all([customersQuery, commentsQuery])

  if (customers.error) {
    return (
      <div className="p-6">
        <InlineError title="โหลดรายชื่อแชทไม่สำเร็จ" message="กรุณาลองอีกครั้ง หากยังใช้งานไม่ได้ ให้เจ้าของร้านตรวจสอบการเชื่อมต่อระบบ" />
      </div>
    )
  }

  const chats: ChatSummary[] = ((customers.data ?? []) as unknown as Row[]).map(({ messages, slips, ...c }) => ({
    customer: c,
    preview: messages[0] ?? null,
    latestSlip: slips[0]?.status ?? null,
  }))

  return (
    <SmartInboxV2
      key={tenant?.id ?? 'all'}
      initialChats={chats}
      initialComments={(comments.data ?? []) as CommentItem[]}
      initialSelectedId={chats.some((c) => c.customer.id === requested) ? requested! : (chats[0]?.customer.id ?? null)}
      tenant={tenant && { id: tenant.id, name: tenant.name, autoVerify: tenant.auto_verify_enabled, autoReply: tenant.auto_reply_enabled }}
    />
  )
}
