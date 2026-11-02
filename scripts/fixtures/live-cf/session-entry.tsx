import React from 'react'
import { createRoot } from 'react-dom/client'
import { LiveSessionDashboard } from '@/components/live-cf/LiveSessionDashboard'
import {
  sessionProfit,
  sumMoney,
  type SessionSnapshot,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'

const tenantId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const ids = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
]
const tabs: SessionTab[] = [
  {
    id: ids[0],
    name: 'สมชาย ใจดี',
    total: 3120,
    paid: 200,
    remaining: 2920,
    shipping: 50,
    items: [260, 410, 2400].map((amount, index) => ({
      orderId: `77777777-7777-4777-8777-77777777777${index}`,
      name: `พระรายการ ${index + 1}`,
      amount,
    })),
  },
  {
    id: ids[1],
    name: 'เอก ผู้สะสม',
    total: 250,
    paid: 0,
    remaining: 250,
    shipping: 50,
    items: [
      { orderId: '88888888-8888-4888-8888-888888888888', name: 'เหรียญรุ่นแรก', amount: 200 },
    ],
  },
  {
    id: ids[2],
    name: 'พรชัย ชำระครบ',
    total: 300,
    paid: 300,
    remaining: 0,
    shipping: 0,
    items: [{ orderId: '99999999-9999-4999-8999-999999999999', name: 'พระสมเด็จ', amount: 300 }],
  },
].map((tab, index) => ({
  ...tab,
  customerId: ids[index],
  credit: 0,
  slips: tab.paid ? 1 : 0,
  revision: 1,
  canMessage: true,
  lastReminder: null,
  account: 'KTB • 9260337828',
}))
const snapshot: SessionSnapshot = {
  session: {
    id: sessionId,
    page_id: '100',
    live_post_id: '456',
    created_at: '2026-11-02T10:00:00Z',
    ended_at: '2026-11-02T16:00:00Z',
    cost_amount: 100,
    ad_spent: 50,
    shipping_cost: 20,
    financial_revision: 0,
  },
  metrics: {
    comments: 120,
    matched: 42,
    commenters: 18,
    slips: 2,
    paid: 500,
    remaining: 3170,
    unpaidPeople: 1,
    partialPeople: 1,
    profit: 330,
  },
  tabs,
  rounds: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      itemName: 'พระรายการ 1',
      price: 260,
      winner: tabs[0].name,
      winnerId: '900',
      orderId: tabs[0].items[0].orderId,
      closedAt: '2026-11-02T15:46:40Z',
      status: 'closed',
      orderStatus: 'pending_payment',
      tabId: tabs[0].id,
      tabRevision: 1,
    },
  ],
}
const state = { snapshot, requests: [] as Record<string, any>[], failAdjust: false, reads: 0 }
declare global {
  interface Window {
    sessionQA: typeof state
  }
}
window.sessionQA = state
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin)
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    state.requests.push(body)
    if (body.action === 'costs') {
      Object.assign(snapshot.session, {
        cost_amount: Number(body.cost),
        ad_spent: Number(body.ads),
        shipping_cost: Number(body.shipping),
        financial_revision: snapshot.session.financial_revision + 1,
      })
      snapshot.metrics.profit = sessionProfit(
        snapshot.metrics.paid,
        Number(body.cost),
        Number(body.ads),
        Number(body.shipping),
      )
    }
    if (body.action === 'adjust') {
      if (state.failAdjust)
        return Response.json({ error: 'ยอดเปลี่ยนแล้ว กรุณาโหลดบิลล่าสุด' }, { status: 409 })
      const tab = tabs.find((tab) => tab.id === body.tabId)!
      tab.items = tab.items
        .filter(
          (item) =>
            !body.items.find(
              (line: { orderId: string; cancelled: boolean }) => line.orderId === item.orderId,
            )?.cancelled,
        )
        .map((item) => ({
          ...item,
          amount: body.items.find((line: { orderId: string }) => line.orderId === item.orderId)
            .amount,
        }))
      tab.shipping = body.shipping
      tab.total = sumMoney([
        ...tab.items.map((item) => item.amount),
        ...(tab.items.length ? [body.shipping] : []),
      ])
      tab.remaining = Math.max(0, sumMoney([tab.total, -tab.paid]))
      tab.revision++
    }
    if (body.action === 'winner') snapshot.rounds[0].winner = 'เอก ผู้สะสม'
    if (body.action === 'remind')
      return Response.json({
        queued: body.tabIds ? body.tabIds.length : 2,
        message: 'เข้าคิวแจ้งยอดแล้ว',
      })
    return Response.json({ ok: true })
  }
  state.reads++
  if (!url.searchParams.has('sessionId')) return Response.json({ sessions: [snapshot.session] })
  if (url.searchParams.has('roundId'))
    return Response.json({
      bids: [
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          bidder_id: '901',
          bidder_name: 'เอก ผู้สะสม',
          bid_amount: 240,
          comment_text: '240',
          created_at: '2026-11-02T15:45:30Z',
        },
      ],
    })
  if (url.searchParams.has('tabId')) {
    const tab = tabs.find((tab) => tab.id === url.searchParams.get('tabId'))!
    return Response.json({
      tab: {
        id: tab.id,
        revision: tab.revision,
        paid_amount: tab.paid,
        shipping_fee: tab.shipping,
      },
      items: tab.items.map((item) => ({
        orderId: item.orderId,
        name: item.name,
        amount: item.amount,
        cancelled: false,
        source: 'live_auction',
        orderStatus: 'pending_payment',
        bidAmount: item.amount,
        commentId: '456_789',
        commentText: String(item.amount),
        bidAt: '2026-11-02T15:45:39Z',
        closeAt: '2026-11-02T15:46:40Z',
        originalTime: true,
      })),
      payments: tab.paid
        ? [{ slipId: 'paid-slip', amount: tab.paid, at: '2026-11-02T15:50:00Z' }]
        : [],
    })
  }
  return Response.json(snapshot)
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <main className="min-h-dvh min-w-0 bg-slate-50 p-4 md:p-8">
      <LiveSessionDashboard tenantId={tenantId} />
    </main>
  </React.StrictMode>,
)
