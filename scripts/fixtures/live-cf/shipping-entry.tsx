import React from 'react'
import { createRoot } from 'react-dom/client'
import jsQR from 'jsqr'
import { ShippingDashboard } from '@/components/shipping/ShippingDashboard'
import { ShippingPrintView } from '@/components/shipping/ShippingPrintView'
import { shippingCsv } from '@/lib/features/shipping/shipping-csv'
import type {
  ShippingSettings,
  ShippingShipment,
  ShippingPrintBatch,
} from '@/lib/features/shipping/shipping-types'

const tenant = '11111111-1111-4111-8111-111111111111'
const settings: ShippingSettings = {
  sender_name: 'SnapBot ร้านพระเครื่อง',
  sender_phone: '0899999999',
  sender_address: '111 ถนนพระเครื่อง แขวงคลองถนน เขตสายไหม กรุงเทพมหานคร 10220',
  default_courier: 'Bee Move',
}
const shipments: ShippingShipment[] = Array.from({ length: 6 }, (_, index) => ({
  id: `22222222-2222-4222-8222-22222222222${index}`,
  tenant_id: tenant,
  customer_id: `33333333-3333-4333-8333-33333333333${index}`,
  customer_tab_id: `44444444-4444-4444-8444-44444444444${index}`,
  live_session_id: '55555555-5555-4555-8555-555555555555',
  customer_name: `ลูกค้า Facebook ${index + 1}`,
  recipient_name: index === 5 ? '' : `สมชาย ใจดี ${index + 1}`,
  phone_number: index === 5 ? '' : '0812345678',
  shipping_address: index === 5 ? '' : '99/1 หมู่ 2 ตำบลบางรัก อำเภอเมือง จังหวัดนนทบุรี 11000',
  subdistrict: 'บางรัก',
  district: 'เมือง',
  province: 'นนทบุรี',
  zipcode: '11000',
  fulfillment_status: index === 5 ? 'pending_address' : 'ready_to_ship',
  courier_name: 'Bee Move',
  tracking_number: null,
  note: 'พระเครื่อง ระวังแตก',
  label_printed_at: null,
  label_print_count: 0,
  address_confirmed_at: index === 5 ? null : '2026-11-02T12:00:00Z',
  revision: 1,
  created_at: '2026-11-02T12:00:00Z',
  shipped_at: null,
  paid_amount: 550,
  payment_ready: true,
  items: [
    {
      order_id: `66666666-6666-4666-8666-66666666666${index}`,
      item_name: 'เหรียญรุ่นแรก หลวงพ่อพระเครื่อง',
      amount: 500,
    },
  ],
}))
const state = {
  shipments,
  requests: [] as any[],
  prints: 0,
  opened: '',
  csvText: '',
  failPrint: false,
  readQr: async () => {
    const svg = document.querySelector('.label-footer svg')!
    const image = new Image()
    image.src = 'data:image/svg+xml;base64,' + btoa(new XMLSerializer().serializeToString(svg))
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 420
    canvas.height = 420
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'white'
    ctx.fillRect(0, 0, 420, 420)
    ctx.drawImage(image, 30, 30, 360, 360)
    return jsQR(ctx.getImageData(0, 0, 420, 420).data, 420, 420)?.data
  },
}
declare global {
  interface Window {
    shippingQA: typeof state
  }
}
window.shippingQA = state
window.print = () => {
  state.prints++
}
window.open = () =>
  ({
    opener: null,
    location: {
      set href(value: string) {
        state.opened = value
      },
    },
    close() {},
  }) as unknown as Window
const originalCreate = URL.createObjectURL.bind(URL)
URL.createObjectURL = (blob: Blob | MediaSource) => {
  if (blob instanceof Blob)
    void blob.text().then((text) => {
      state.csvText = text
    })
  return originalCreate(blob)
}
window.fetch = async (input, init) => {
  const url = String(input)
  if (init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    state.requests.push(body)
    if (url.endsWith('/export'))
      return new Response(shippingCsv(shipments.filter((row) => body.ids.includes(row.id))), {
        headers: { 'Content-Type': 'text/csv' },
      })
    if (body.action === 'mark_print')
      return state.failPrint
        ? Response.json({ error: 'ที่อยู่เปลี่ยน กรุณาเตรียมฉลากใหม่' }, { status: 409 })
        : Response.json({ ok: true })
    if (body.action === 'prepare_print')
      return Response.json({ ok: true, batchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })
    if (body.action === 'settings') Object.assign(settings, body.settings)
    if (body.action === 'edit')
      Object.assign(
        shipments.find((row) => row.id === body.ids[0])!,
        body.address,
        {
          courier_name: body.courier,
          tracking_number: body.tracking,
          note: body.note,
          address_confirmed_at: body.confirmed ? new Date().toISOString() : null,
          fulfillment_status: body.confirmed ? 'ready_to_ship' : 'pending_address',
        },
      )
    if (['dispatch', 'cancel', 'restore'].includes(body.action))
      for (const row of shipments.filter((row) => body.ids.includes(row.id)))
        row.fulfillment_status =
          body.action === 'dispatch'
            ? 'shipped'
            : body.action === 'cancel'
              ? 'cancelled'
              : 'ready_to_ship'
    return Response.json({ ok: true })
  }
  return Response.json({
    shipments,
    settings,
    sessions: [
      { id: shipments[0].live_session_id, live_post_id: '456', created_at: '2026-11-02T10:00:00Z' },
    ],
  })
}
const format = new URL(location.href).searchParams.get('format') === 'a4' ? 'a4' : 'thermal'
const batch: ShippingPrintBatch = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenant_id: tenant,
  format,
  sender: settings,
  shipments: shipments.slice(0, 5),
  created_at: new Date().toISOString(),
  opened_at: null,
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {location.pathname.startsWith('/shipping/print/') ? (
      <ShippingPrintView batch={batch} />
    ) : (
      <div className="flex min-h-dvh min-w-0 flex-col bg-slate-50">
        <ShippingDashboard tenantId={tenant} shopName="SnapBot ร้านพระเครื่อง" />
      </div>
    )}
  </React.StrictMode>,
)
