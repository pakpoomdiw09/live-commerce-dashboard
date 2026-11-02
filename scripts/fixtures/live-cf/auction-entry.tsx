import React from 'react'
import { createRoot } from 'react-dom/client'
import { LiveCfWorkspace } from '@/components/live-cf/LiveCfWorkspace'
import { AuctionSlipUpload } from '@/components/live-cf/AuctionSlipUpload'
import { CustomerTabsPanel } from '@/components/inbox/CustomerTabsPanel'
import type { CustomerTab } from '@/lib/features/commerce/customer-tab-types'
import { customerTabText } from '@/lib/features/commerce/customer-tab-types'
import type { Auction, AuctionBid } from '@/lib/features/commerce/auction-types'

const tenantId = '11111111-1111-4111-8111-111111111111'
const bank = {
  id: '22222222-2222-4222-8222-222222222222',
  bank_code: 'KBANK',
  account_number: '1234567890',
}
const initial: Auction = {
  id: '33333333-3333-4333-8333-333333333333',
  tenant_id: tenantId,
  page_id: '100',
  live_post_id: '456',
  item_name: 'เหรียญรุ่น 1',
  start_price: 200,
  min_step: 20,
  current_price: 200,
  shipping_fee: 50,
  leading_bidder_id: '900',
  leading_bidder_name: 'สมชาย ใจดี',
  leading_comment_id: '456_789',
  host_ids: [],
  host_count: '2',
  status: 'active',
  closed_at: null,
  order_id: null,
  created_at: '2026-11-02T10:00:00Z',
}
const state = {
  auctions: [initial],
  failOpen: false,
  loadFailure: false,
  reads: 0,
  summaryReads: 0,
  selectedSlipId: '',
  customerTabs: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      tenant_id: tenantId,
      customer_id: '900',
      customer_fb_id: '900',
      page_id: '100',
      live_session_id: 'session',
      bank_account_id: bank.id,
      shipping_fee: 0,
      total_amount: 1000,
      paid_amount: 200,
      remaining_amount: 800,
      credit_amount: 0,
      status: 'pending_payment',
      revision: 1,
      created_at: '2026-11-02T10:00:00Z',
      updated_at: '2026-11-02T10:00:00Z',
      customer_tab_items: [200, 300, 500].map((amount, index) => ({
        order_id: `item-${index}`,
        item_name: `พระรายการ ${index + 1}`,
        variant_label: null,
        amount,
        cancelled: false,
        closed_at: '2026-11-02T10:00:00Z',
      })),
      customer_tab_payments: [
        { slip_id: 'verified-slip', amount: 200, transferred_at: '2026-11-02T10:00:00Z' },
      ],
    },
  ] as CustomerTab[],
  requests: [] as { path: string; body: Record<string, unknown> }[],
  bids: [
    {
      id: 'bid',
      bidder_name: 'สมชาย ใจดี',
      comment_text: 'เปิดให้ 10 ลุ้น',
      bid_amount: 200,
      is_opening: true,
      status: 'accepted',
      created_at: '2026-11-02T10:00:01Z',
    },
  ] as AuctionBid[],
}
const roundBids = new Map<string, AuctionBid[]>([[initial.id, state.bids]])
declare global {
  interface Window {
    auctionQA: typeof state
  }
}
window.auctionQA = state
window.fetch = async (input, init) => {
  const path = String(input)
  if (path.startsWith('/api/live-cf/sessions?')) {
    state.summaryReads++
    return Response.json({ sessions: [] })
  }
  if (path.startsWith('/api/facebook/live-videos?'))
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
  if (path.startsWith('/api/customer-tabs?')) {
    if (new URL(path, 'https://test.invalid').searchParams.has('summary'))
      return Response.json({
        text: customerTabText(
          state.customerTabs[0],
          'https://shop.example/pay/live/signed',
          'KBANK 1234567890',
        ),
        link: 'https://shop.example/pay/live/signed',
      })
    return Response.json({ tabs: state.customerTabs, reminders: [] })
  }
  if (init?.method === 'POST') {
    if (path.endsWith('/slip')) return Response.json({ submitted: true })
    const body = JSON.parse(String(init.body))
    state.requests.push({ path, body })
    if (path === '/api/messages/send') return Response.json({ ok: true })
    if (path === '/api/customer-tabs')
      return Response.json({ queued: 1, message: 'Reminder queued' })
    if (path.endsWith('/host-action')) {
      const row = state.auctions.find((a) => a.id === body.auctionId)!
      if (body.action === 'close') row.status = 'closed'
      else row.host_count = body.action
      const bids = roundBids.get(row.id) ?? []
      roundBids.set(row.id, bids)
      bids.unshift({
        id: `host-${state.requests.length}`,
        bidder_name: 'Host',
        comment_text: body.action === 'close' ? '❌' : body.action,
        bid_amount: null,
        is_opening: false,
        status: body.action === 'close' ? 'closed' : 'count',
        created_at: new Date().toISOString(),
      })
      return Response.json(
        { posted: true, queued: true, message: 'Comment posted; awaiting queue' },
        { status: 202 },
      )
    }
    if (path.endsWith('/close')) {
      const row = state.auctions.find((a) => a.id === body.auctionId)!
      row.status = body.cancel ? 'cancelled' : 'closed'
      return Response.json({ status: row.status, orderId: 'order' })
    }
    if (state.failOpen)
      return Response.json({ error: 'ไลฟ์นี้มีรายการประมูลที่กำลังเปิดอยู่แล้ว' }, { status: 409 })
    const row: Auction = {
      ...initial,
      id: '44444444-4444-4444-8444-444444444444',
      item_name: body.itemName,
      live_post_id: body.livePostId,
      current_price: 0,
      leading_bidder_name: null,
      leading_bidder_id: null,
      host_count: null,
    }
    state.auctions.unshift(row)
    return Response.json({ id: row.id }, { status: 201 })
  }
  state.reads++
  if (state.loadFailure)
    return Response.json({ error: 'Auction API temporarily unavailable' }, { status: 503 })
  const params = new URL(path, 'https://test.invalid').searchParams
  const selected = state.auctions.find((a) => a.id === params.get('id')) ?? state.auctions[0]
  return Response.json({
    auctions: state.auctions,
    selectedAuctionId: selected.id,
    bids: roundBids.get(selected.id) ?? [],
    deliveries:
      selected.status === 'closed'
        ? [{ channel: 'private', status: 'sent', error_code: null }]
        : [],
  })
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div className="fixed inset-x-0 top-0 flex h-dvh w-full overflow-hidden bg-slate-50">
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto" data-dashboard-main>
        <div className="flex min-h-0 flex-1 flex-col">
          <LiveCfWorkspace
            tenantId={tenantId}
            bankAccounts={[bank]}
            pages={[{ id: '100', name: 'ดิว ไลฟ์สดพระเครื่อง' }]}
          >
            <section className="min-h-[1800px] p-8" data-cf-setup>
              CF order setup
            </section>
          </LiveCfWorkspace>
          <section className="mx-auto w-full max-w-lg shrink-0 p-4">
            <AuctionSlipUpload token="test-signed-token" initiallySubmitted={false} />
            <div data-customer-tab-fixture className="mt-4">
              <CustomerTabsPanel
                customerId="900"
                onSelectSlip={(id) => {
                  state.selectedSlipId = id
                }}
              />
            </div>
          </section>
        </div>
      </main>
    </div>
  </React.StrictMode>,
)
