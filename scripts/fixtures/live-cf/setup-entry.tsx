import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveCfSetup } from '@/components/live-cf/LiveCfSetup'
import { LiveCfVariantPayment } from '@/components/live-cf/LiveCfVariantPayment'
import { liveCfTest } from './setup-mocks'

const productId = '33333333-3333-4333-8333-333333333333'
const newProductId = '44444444-4444-4444-8444-444444444444'
const state = Object.assign(liveCfTest, {
  requests: [] as { url: string; body: any }[],
  failure: false,
  categoryFailure: false,
  uploadFailure: false,
  liveFailure: false,
  liveEmpty: false,
  liveId: '456',
  newProductId,
})
;(window as any).liveCfTest = state
window.fetch = async (input, init) => {
  const url = String(input),
    body =
      init?.body instanceof FormData
        ? { file: (init.body.get('file') as File)?.name }
        : JSON.parse(String(init?.body ?? '{}'))
  state.requests.push({ url, body })
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (url.startsWith('/api/facebook/live-videos')) {
    if (state.liveFailure) return Response.json({ error: 'กรุณาเชื่อมต่อเพจใหม่' }, { status: 409 })
    const pageId = new URL(url, location.origin).searchParams.get('page_id')
    return Response.json({
      pageId,
      videos: state.liveEmpty
        ? []
        : [
            {
              id: pageId === '200' ? '654' : state.liveId,
              title: pageId === '200' ? 'ไลฟ์สดเพจที่สอง' : 'ไลฟ์เสื้อผ้าวันนี้',
              thumbnail: 'https://storage.example/live.webp',
              createdAt: '2026-11-01T04:00:00.000Z',
            },
          ],
    })
  }
  if (url.startsWith('/api/commerce/product-options')) {
    if (state.categoryFailure)
      return Response.json({ error: 'โหลดหมวดหมู่ไม่สำเร็จ กรุณาลองใหม่' }, { status: 503 })
    return Response.json({
      categories: [
        { id: '77777777-7777-4777-8777-777777777777', name: 'เสื้อผ้าและเครื่องแต่งกาย' },
      ],
    })
  }
  if (url.startsWith('/api/commerce/media')) {
    if (state.uploadFailure)
      return Response.json({ error: 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่' }, { status: 503 })
    return Response.json({ url: 'https://storage.example/commerce/test/product.webp' })
  }
  if (url === '/api/commerce') {
    if (state.failure)
      return Response.json({ error: 'รหัสสินค้านี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น' }, { status: 409 })
    return Response.json({ id: newProductId })
  }
  if (url === '/api/live-cf/setup')
    return Response.json({ id: '55555555-5555-4555-8555-555555555555' })
  if (url === '/api/live-cf/payment-variant') {
    if (state.failure)
      return Response.json({ error: 'ตัวเลือกนี้หมดแล้ว กรุณาเลือกแบบอื่น' }, { status: 409 })
    return Response.json({
      variant_id: body.variantId,
      variant_label: 'สี: ดำ / ขนาด: M',
      amount: 259,
      confirmed_at: '2026-11-01T12:00:00Z',
      payment_total: 259,
      remaining_selections: 0,
    })
  }
  throw Error('Unexpected fetch ' + url)
}

const empty = location.search.includes('empty')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.search.includes('payment') ? (
      <LiveCfVariantPayment
        token="offline-signed-fixture"
        productName="เสื้อยืดคอกลม"
        status="pending_payment"
        initialSelection={{
          variant_id: null,
          variant_label: null,
          amount: 159,
          confirmed_at: null,
          payment_total: 159,
          remaining_selections: 1,
        }}
        variants={[
          {
            id: '88888888-8888-4888-8888-888888888888',
            label: 'สี: ขาว / ขนาด: S',
            price: 159,
            stock: 0,
          },
          {
            id: '99999999-9999-4999-8999-999999999999',
            label: 'สี: ดำ / ขนาด: M',
            price: 259,
            stock: 1,
          },
        ]}
        bank={{ name: 'ธนาคารทดสอบ', account_name: 'ร้านทดสอบ', account_number: '1234567890' }}
        qrUrl={null}
      />
    ) : (
      <LiveCfSetup
        tenantId="11111111-1111-4111-8111-111111111111"
        pages={[
          { id: '100', name: 'เพจร้านทดสอบ', picture: null },
          { id: '200', name: 'เพจที่สอง', picture: null },
        ]}
        products={
          empty
            ? []
            : [
                {
                  id: productId,
                  name: 'เสื้อยืดผ้าฝ้ายสำหรับไลฟ์สด',
                  code: '159',
                  price: 159,
                  stock: 8,
                  image_url: '/sample-product.svg',
                  description: 'เนื้อผ้านุ่ม ใส่สบาย',
                  sales_page_url: '/s/test-shop',
                  variants: [],
                },
              ]
        }
        bankAccounts={[
          {
            id: '66666666-6666-4666-8666-666666666666',
            bank_code: 'กสิกรไทย',
            account_name: 'ร้านทดสอบ',
            account_number: '1234567890',
            is_primary: true,
          },
        ]}
        initialRule={
          location.search.includes('aliases')
            ? {
                id: '55555555-5555-4555-8555-555555555555',
                tenant_id: '11111111-1111-4111-8111-111111111111',
                name: 'หลายรหัส',
                page_ids: ['100'],
                keywords: ['a1', '159', 'จอง'],
                match_type: 'keyword',
                reply_enabled: true,
                reply_text: 'รับออเดอร์แล้ว',
                inbox_enabled: false,
                inbox_type: 'text',
                inbox_text: null,
                inbox_image_url: null,
                is_active: true,
                created_at: '2026-11-01T00:00:00Z',
                mode: 'live_cf',
                live_product_id: productId,
              }
            : null
        }
        setupError={null}
        salesPageUrl="/s/test-shop"
      />
    )}
  </StrictMode>,
)
