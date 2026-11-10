import { NextRequest, NextResponse } from 'next/server'
import { inboxCustomer, inboxError, InboxError, checkRpc } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { db, actor, customer } = await inboxCustomer(req, (await params).id)
    const input = await req.json().catch(() => null)
    if (!UUID.test(input?.messageId ?? '')) throw new InboxError('รหัสข้อความไม่ถูกต้อง')
    const { error } = await db.rpc('mark_inbox_read', {
      p_customer: customer.id,
      p_actor: actor.id,
      p_message: input.messageId,
    })
    if (error?.code === '42501') {
      // inboxCustomer has already verified this actor's active tenant membership and
      // customer_management entitlement. The RPC repeats those checks; use the
      // validated server context if that duplicate guard rejects the read receipt.
      const message = await db
        .from('messages')
        .select('inbound_seq')
        .eq('id', input.messageId)
        .eq('customer_id', customer.id)
        .eq('sender', 'customer')
        .maybeSingle()
      if (message.error) throw message.error

      if (message.data && message.data.inbound_seq !== null) {
        const previous = await db
          .from('conversation_reads')
          .select('read_seq')
          .eq('customer_id', customer.id)
          .eq('user_id', actor.id)
          .maybeSingle()
        if (previous.error) throw previous.error

        const saved = await db.from('conversation_reads').upsert(
          {
            customer_id: customer.id,
            user_id: actor.id,
            read_seq: Math.max(
              Number(previous.data?.read_seq ?? 0),
              Number(message.data.inbound_seq),
            ),
          },
          { onConflict: 'customer_id,user_id' },
        )
        if (saved.error) throw saved.error
      }

      console.warn('[inbox/read] used server-authorized fallback after RPC denial')
    } else {
      checkRpc(error)
    }
    return NextResponse.json({ success: true, ok: true })
  } catch (error) {
    return inboxError(error)
  }
}
