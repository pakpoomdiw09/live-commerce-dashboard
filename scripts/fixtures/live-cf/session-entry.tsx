import React from 'react'
import { createRoot } from 'react-dom/client'
import { LiveSessionDashboard } from '@/components/live-cf/LiveSessionDashboard'
import { defaultSessionAutomation } from '@/lib/features/commerce/session-automation'
import type { ShippingShipment } from '@/lib/features/shipping/shipping-types'
import {
  sessionProfit,
  sumMoney,
  type SessionSnapshot,
  type SessionTab,
} from '@/lib/features/commerce/live-session-types'

const tenantId = '11111111-1111-4111-8111-111111111111'
const sessionId = '22222222-2222-4222-8222-222222222222'
const allInOne = new URL(location.href).searchParams.has('all')
const bankId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const secondSessionId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
const options = {
  pages: [{ id: '100', name: 'ดิว ไลฟ์สดพระเครื่อง' }],
  bankAccounts: [{ id: bankId, bank_code: 'KTB', account_number: '9260337828' }],
  shopName: 'SnapBot',
}
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
  fbId: ['900', '901', '902'][index],
  matched: index < 2,
  note: '',
  noteRevision: 0,
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
if (allInOne) {
  for (const tab of tabs)
    tab.items = tab.items.map((item) => ({
      ...item,
      name: `${tab === tabs[1] ? '[CF-A1]' : '[ประมูล]'} ${item.name}`,
    }))
  snapshot.metrics.matchedPeople = 2
  snapshot.session.ended_at = null
  snapshot.session.auction_settings = defaultSessionAutomation(bankId)
  snapshot.session.automation_revision = 0
  snapshot.slips = [
    {
      id: 'paid-slip',
      name: tabs[2].name,
      amount: 300,
      at: '2026-11-02T15:50:00Z',
      transRef: 'VERIFIED',
      senderName: 'นายผู้โอนจาก SlipOK',
      senderBank: '004',
    },
  ]
  for (let index = 1; index < 12; index++)
    snapshot.slips.push({
      id: `paid-slip-${index}`,
      name: tabs[0].name,
      amount: index === 11 ? 20 : 18,
      at: new Date(Date.parse('2026-11-02T15:50:00Z') - index * 60000).toISOString(),
      transRef: `VERIFIED-${index}`,
      senderName: 'ผู้โอนส่วนที่เหลือ',
      senderBank: '006',
    })
  snapshot.metrics.slips = 12
  tabs[0].slips = 11
  snapshot.commenters = [
    {
      fbId: '900',
      customerId: tabs[0].customerId,
      name: tabs[0].name,
      at: '2026-11-02T15:50:00Z',
      comments: 10,
      matched: true,
    },
  ]
  snapshot.commenters.push({
    fbId: '903',
    customerId: null,
    name: 'ผู้ชมยังไม่มีบิล',
    at: '2026-11-02T15:49:00Z',
    comments: 1,
    matched: false,
    note: '',
    noteRevision: 0,
  })
}
const secondSession = { ...snapshot.session, id: secondSessionId, live_post_id: '457' }
const shipment: ShippingShipment = {
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tenant_id: tenantId,
  customer_id: ids[2],
  customer_tab_id: ids[2],
  live_session_id: sessionId,
  customer_name: tabs[2].name,
  recipient_name: 'พรชัย',
  phone_number: '0812345678',
  shipping_address: '1 แขวงคลองถนน เขตสายไหม กรุงเทพมหานคร 10220',
  subdistrict: 'คลองถนน',
  district: 'สายไหม',
  province: 'กรุงเทพมหานคร',
  zipcode: '10220',
  courier_name: 'Flash Express',
  tracking_number: null,
  fulfillment_status: 'ready_to_ship',
  label_printed_at: null,
  label_print_count: 0,
  address_confirmed_at: '2026-11-02T15:50:00Z',
  revision: 1,
  created_at: '2026-11-02T15:50:00Z',
  shipped_at: null,
  paid_amount: 300,
  payment_ready: true,
  items: [{ order_id: tabs[2].items[0].orderId, item_name: 'พระสมเด็จ', amount: 300 }],
  note: '',
}
const state = {
  snapshot,
  requests: [] as Record<string, any>[],
  paths: [] as string[],
  failAdjust: false,
  reads: 0,
}
declare global {
  interface Window {
    sessionQA: typeof state
  }
}
window.sessionQA = state
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin)
  state.paths.push(url.pathname + url.search)
  if (url.pathname === '/api/facebook/live-videos')
    return Response.json({
      pageId: '100',
      fallback: false,
      videos: [
        {
          id: '456',
          title: 'ไลฟ์สดพระเครื่อง',
          thumbnail: null,
          createdAt: '2026-11-02T10:00:00Z',
          isLive: true,
        },
      ],
    })
  if (url.pathname === '/api/shipping' && init?.method !== 'POST')
    return Response.json({
      shipments: [
        shipment,
        { ...shipment, id: 'unpaid', payment_ready: false, customer_name: 'Unpaid buyer' },
        {
          ...shipment,
          id: 'foreign',
          live_session_id: secondSessionId,
          customer_name: 'Other Session buyer',
        },
      ],
      settings: null,
      sessions: [snapshot.session, secondSession],
    })
  if (url.pathname === '/api/shipping/export')
    return new Response('\uFEFFRecipient Name,Phone Number\r\nBuyer,0812345678', {
      headers: { 'Content-Type': 'text/csv;charset=utf-8' },
    })
  if (url.pathname === '/api/live-cf/auction' && init?.method !== 'POST')
    return Response.json({ auctions: [], bids: [], deliveries: [] })
  if (url.pathname.startsWith('/api/slips/'))
    return Response.json({
      slip: {
        id: 'paid-slip',
        amount: 300,
        expected_amount: 300,
        status: 'valid',
        raw: {},
        imageUrl: '/logo-icon.png',
        receiver: { name: 'ร้านพระ', bank: '006', account: '9260337828' },
        transferredAt: '2026-11-02T15:50:00Z',
      },
    })
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    state.requests.push(body)
    if (url.pathname === '/api/live-cf/auction') {
      snapshot.activeAuction = {
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        itemName: body.itemName,
      }
      return Response.json({ id: snapshot.activeAuction.id })
    }
    if (url.pathname === '/api/live-cf/auction/close') {
      snapshot.activeAuction = null
      return Response.json({ status: 'cancelled' })
    }
    if (url.pathname === '/api/shipping') return Response.json({ batchId: 'print-batch', ok: true })
    if (url.pathname === '/api/live-auction/session') {
      if (body.action === 'load_customers') {
        for (const person of snapshot.commenters ?? [])
          if (body.fbIds.includes(person.fbId) && !person.customerId)
            person.customerId = 'abababab-abab-4bab-8bab-abababababab'
        return Response.json(snapshot)
      }
      if (body.action === 'note') {
        const tab = snapshot.tabs.find((tab) => tab.fbId === body.fbId)
        const person = snapshot.commenters?.find((person) => person.fbId === body.fbId)
        const revision = Number(tab?.noteRevision ?? person?.noteRevision ?? 0) + 1
        if (tab) Object.assign(tab, { note: body.note, noteRevision: revision })
        if (person) Object.assign(person, { note: body.note, noteRevision: revision })
        return Response.json({ note: body.note, revision })
      }
      if (body.action === 'settings') {
        snapshot.session.auction_settings = body.settings
        snapshot.session.automation_revision = (snapshot.session.automation_revision ?? 0) + 1
      }
      return Response.json({ id: sessionId, revision: snapshot.session.automation_revision ?? 0 })
    }
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
  if (!url.searchParams.has('sessionId'))
    return Response.json({
      sessions: allInOne ? [snapshot.session, secondSession] : [snapshot.session],
    })
  if (url.searchParams.get('sessionId') === secondSessionId)
    return Response.json({
      ...snapshot,
      session: secondSession,
      tabs: [],
      rounds: [],
      slips: [],
      commenters: [],
    })
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
      <LiveSessionDashboard tenantId={tenantId} auction={allInOne ? options : undefined} />
    </main>
  </React.StrictMode>,
)
