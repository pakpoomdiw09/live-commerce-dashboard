// Browser test sandbox: no secrets, Supabase clients or real outbound requests.
import React from 'react'
export default function MockLink({ children, href, ...props }: React.ComponentProps<'a'>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  )
}
export const useRouter = () => ({ refresh() {}, push() {}, replace() {} })
const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
]
export const customers = ids.map((id, i) => ({
  id,
  tenant_id: 'test-shop',
  display_name: ['ลูกค้า A', 'ลูกค้า B', 'ลูกค้า C'][i],
  platform_user_id: 'test-' + i,
  bot_enabled: true,
  assigned_user_id: null as string | null,
  conversation_status: 'open',
  conversation_version: 0,
  inbound_seq: 1,
  last_message_at: '2026-10-16T01:00:00Z',
  phone: null,
  address: null,
  tags: [],
  notes: null,
  order_status: 'new',
  created_at: '2026-10-16T00:00:00Z',
  inbox_stage: 'UNASSIGNED',
}))
export const messages = customers.map((c, i) => ({
  id: 'msg-' + i,
  customer_id: c.id,
  sender: 'customer',
  body: 'ข้อความของ ' + c.display_name,
  attachments: [],
  created_at: '2026-10-16T01:00:00Z',
  inbound_seq: 1,
}))
export const metrics = {
  mutations: 0,
  threadReads: 0,
  channels: new Set<unknown>(),
  requests: [] as string[],
  workspaceWrites: [] as { customerId: string; action: string; requestId: string }[],
  conversationWrites: [] as { action: string; requestId?: string }[],
}
export const workspaceControl = {
  failNext: false,
  lastInboundAt: null as string | null,
  humanAgentAvailable: false,
}
export const conversationControl = { failNext: false, masterEnabled: true, aiAllowed: true }
const listeners = new Set<{
  table: string
  event: string
  handler: (event: unknown) => void
  channel: unknown
}>()
export function replay() {
  for (const row of messages)
    for (let n = 0; n < 3; n++)
      for (const l of listeners)
        if (l.table === 'messages' && l.event === 'INSERT')
          l.handler({ new: row, eventType: 'INSERT' })
}
export function reconnect() {
  for (const channel of metrics.channels)
    (channel as { status: (value: string) => void }).status('SUBSCRIBED')
}
function emitMessage(row: (typeof messages)[number]) {
  for (const l of listeners)
    if (l.table === 'messages' && (l.event === 'INSERT' || l.event === '*'))
      l.handler({ new: row, eventType: 'INSERT' })
}
export function threadChange(kind: 'fill' | 'append' | 'prepend') {
  const base = messages[2],
    offset = messages.length
  const count = kind === 'fill' ? 60 : 1
  for (let i = 0; i < count; i++) {
    const row = {
      ...base,
      id: 'scroll-' + offset + '-' + i,
      body: kind + ' ' + i + '\nข้อความทดสอบการอ่านประวัติ\nข้อความบรรทัดถัดไป',
      created_at: new Date(
        Date.parse(base.created_at) + (kind === 'prepend' ? -60000 : (offset + i) * 60000),
      ).toISOString(),
    }
    messages.push(row)
    emitMessage(row)
  }
}
export function supabaseBrowser() {
  return db
}
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {}
    const q = {
      select() {
        return q
      },
      eq(key: string, value: unknown) {
        filters[key] = value
        return q
      },
      order() {
        return q
      },
      limit() {
        return q
      },
      abortSignal() {
        return q
      },
      async maybeSingle() {
        return {
          data: customers
            .filter((c) => !filters.id || c.id === filters.id)
            .map((c) => ({
              ...c,
              messages: messages.filter((m) => m.customer_id === c.id),
              slips: [],
            }))[0],
          error: null,
        }
      },
      then(resolve: (value: unknown) => void) {
        if (table === 'messages') metrics.threadReads++
        const rows =
          table === 'messages'
            ? messages.filter((m) => m.customer_id === filters.customer_id)
            : table === 'customers'
              ? customers.map((c) => ({
                  ...c,
                  messages: messages.filter((m) => m.customer_id === c.id),
                  slips: [],
                }))
              : []
        setTimeout(
          () => resolve({ data: rows, error: null }),
          filters.customer_id === ids[0] ? 80 : filters.customer_id === ids[1] ? 40 : 5,
        )
      },
    }
    return q
  },
  channel() {
    const channel = {
      status(_value: string) {},
      on(
        _kind: string,
        filter: { table: string; event: string },
        handler: (value: unknown) => void,
      ) {
        listeners.add({ ...filter, handler, channel })
        return channel
      },
      subscribe(callback: (value: string) => void) {
        channel.status = callback
        metrics.channels.add(channel)
        setTimeout(() => {
          if (metrics.channels.has(channel)) callback('SUBSCRIBED')
        }, 0)
        return channel
      },
    }
    return channel
  },
  async removeChannel(channel: unknown) {
    metrics.channels.delete(channel)
    for (const l of listeners) if (l.channel === channel) listeners.delete(l)
  },
}
const savedReplies: { id: string; body: string; shortcut?: string }[] = []
const workspace = new Map<
  string,
  {
    starred: boolean
    followedUp: boolean
    notes: { id: string; body: string; actor_id: string; created_at: string }[]
  }
>()
export function installFetch() {
  window.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
    const url = String(input)
    metrics.requests.push(url)
    if (!url.startsWith('/api/')) throw Error('External network is forbidden in fixture')
    const json = (value: unknown, status = 200) =>
      Promise.resolve(
        new Response(JSON.stringify(value), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    if (url.startsWith('/api/inbox/quick-replies')) {
      if (options?.method === 'POST') {
        const body = JSON.parse(String(options.body))
        const reply = { id: body.requestId, body: body.body, shortcut: body.shortcut ?? '' }
        if (!savedReplies.some((r) => r.id === reply.id)) savedReplies.push(reply)
        return json({ reply })
      }
      return json({ replies: savedReplies })
    }
    if (url.endsWith('/draft')) return json({ draft: 'ข้อความร่างสำหรับทดสอบ' })
    if (url.startsWith('/api/inbox/media?'))
      return json({
        id: '44444444-4444-4444-8444-444444444444',
        name: 'attachment.png',
        kind: 'image',
      })
    if (url.startsWith('/api/inbox/search')) {
      const query = new URL(url, 'https://fixture.test').searchParams.get('q') ?? ''
      const found = customers.filter((c) => c.display_name.includes(query))
      return json({
        customerIds: found.map((c) => c.id),
        chats: found.map((customer) => ({
          customer,
          preview: messages.find((m) => m.customer_id === customer.id),
          latestSlip: null,
        })),
      })
    }
    if (url.startsWith('/api/inbox/stars'))
      return json({
        customerIds: [...workspace.entries()].filter(([, v]) => v.starred).map(([id]) => id),
        followUpCustomerIds: [...workspace.entries()]
          .filter(([, value]) => value.followedUp)
          .map(([id]) => id),
        paidCustomerIds: [ids[1]],
        pendingPaymentIds: [ids[0]],
        followUpAvailable: true,
        limited: false,
      })
    if (url.startsWith('/api/inbox/state') && location.hash === '#state-error')
      return json({ error: 'โหลดสถานะแชททดสอบไม่สำเร็จ' }, 503)
    if (url.startsWith('/api/inbox/state'))
      return json({
        viewerId: 'admin',
        members: [{ id: 'admin', name: 'แอดมินทดสอบ' }],
        conversations: customers.map((c) => ({ ...c, unread_count: 0 })),
        aiAllowed: conversationControl.aiAllowed,
        autoReplyEnabled: conversationControl.masterEnabled,
        pageName: 'เพจทดสอบออฟไลน์',
        proEnabled: true,
      })
    if (url.startsWith('/api/inbox/pro'))
      return json({
        enabled: true,
        counts: {
          total: 3,
          waiting: 0,
          active: 0,
          closed: 0,
          resolved: 0,
          ai: 0,
          bot: 3,
          overdue: 0,
        },
        averageResponseSeconds: null,
        responseSamples: 0,
        team: [],
        overdueMinutes: 15,
        days: 30,
      })
    const c = customers.find((c) => url.includes(c.id))
    if (url.endsWith('/workspace') && c) {
      let data = workspace.get(c.id)
      if (!data) {
        data = { starred: false, followedUp: false, notes: [] }
        workspace.set(c.id, data)
      }
      if (options?.method === 'POST') {
        const input = JSON.parse(String(options.body))
        metrics.workspaceWrites.push({
          customerId: c.id,
          action: input.action,
          requestId: input.requestId,
        })
        if (workspaceControl.failNext) {
          workspaceControl.failNext = false
          return json({ error: 'ทดสอบบันทึกไม่สำเร็จ' }, 503)
        }
        if (input.action === 'note')
          data.notes.unshift({
            id: input.requestId,
            body: input.body,
            actor_id: 'admin',
            created_at: new Date().toISOString(),
          })
        else if (input.action === 'star' || input.action === 'unstar')
          data.starred = input.action === 'star'
        else if (input.action === 'followup' || input.action === 'unfollowup')
          data.followedUp = input.action === 'followup'
        return json({ ok: true })
      }
      return json({
        ...data,
        followUpAvailable: true,
        lastInboundAt: workspaceControl.lastInboundAt ?? new Date().toISOString(),
        humanAgentAvailable: workspaceControl.humanAgentAvailable,
        serverNow: new Date().toISOString(),
      })
    }
    if (url.endsWith('/expiry') && c) {
      const changed =
        !!workspaceControl.lastInboundAt &&
        Date.parse(workspaceControl.lastInboundAt) <= Date.now() - 86400000 &&
        c.bot_enabled
      if (changed) {
        c.bot_enabled = false
        c.conversation_version++
      }
      return json({ changed })
    }
    if (options?.method === 'PATCH' && c) {
      const body = JSON.parse(String(options.body))
      metrics.conversationWrites.push(body)
      await new Promise((resolve) => setTimeout(resolve, 60))
      if (conversationControl.failNext) {
        conversationControl.failNext = false
        return json({ error: 'ทดสอบเปลี่ยนสถานะ AI ไม่สำเร็จ' }, 503)
      }
      metrics.mutations++
      if (body.action === 'claim') {
        c.assigned_user_id = 'admin'
        c.bot_enabled = false
        c.inbox_stage = 'ASSIGNED'
      }
      if (body.action === 'bot') {
        c.assigned_user_id = null
        c.bot_enabled = true
        c.conversation_status = 'open'
        c.inbox_stage = 'UNASSIGNED'
      }
      if (body.action === 'pause') c.bot_enabled = false
      if (body.action === 'close') {
        c.conversation_status = 'closed'
        c.inbox_stage = 'CLOSED'
      }
      if (body.action === 'reopen') {
        c.conversation_status = 'open'
        c.inbox_stage = 'ASSIGNED'
      }
      c.conversation_version++
      return json({ ok: true })
    }
    if (options?.method === 'POST' && url.endsWith('/read')) return json({ ok: true })
    if (url.startsWith('/api/follow-ups/customers/'))
      return json({ followup_opted_out: false, contact_suspended: false })
    if (c) return json({ customer: c, orders: [], events: [], followups: [] })
    throw Error('Unmocked API: ' + url)
  }) as typeof fetch
}
