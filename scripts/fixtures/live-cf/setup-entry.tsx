import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveCfSetup } from '@/components/live-cf/LiveCfSetup'
import { LiveCfVariantPayment } from '@/components/live-cf/LiveCfVariantPayment'
import { QuickProductModal } from '@/components/live-cf/QuickProductModal'
import type { LiveProductOption } from '@/lib/features/comments/comment-rules'
import { liveCfTest } from './setup-mocks'

const productId = '33333333-3333-4333-8333-333333333333'
const newProductId = '44444444-4444-4444-8444-444444444444'
const secondProductId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const state = Object.assign(liveCfTest, {
  requests: [] as { url: string; body: any }[],
  failure: false,
  categoryFailure: false,
  uploadFailure: false,
  detailFailure: false,
  editStale: false,
  detailDelays: {} as Record<string, number>,
  saveDelay: 0,
  liveExtra: false,
  savedCallbacks: [] as LiveProductOption[],
  details: {
    [productId]: {
      id: productId,
      code: '159',
      name: 'เสื้อยืดผ้าฝ้ายสำหรับไลฟ์สด',
      description: 'รายละเอียดเดิม',
      price: 159,
      stock: 8,
      images: ['https://storage.example/one.webp', 'https://storage.example/two.webp'],
      category_id: '77777777-7777-4777-8777-777777777777',
      cost: 65,
      compare_price: 399,
      featured: true,
      is_active: true,
      version: 7,
      variants: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          label: 'สี: ขาว',
          price: 199,
          stock: 3,
          variant_code: 'WHITE',
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          label: 'สี: ดำ',
          price: 259,
          stock: 5,
          variant_code: 'BLACK',
        },
      ],
    },
    [secondProductId]: {
      id: secondProductId,
      code: 'SECOND',
      name: 'สินค้าตัวที่สอง',
      description: '',
      price: 499,
      stock: 13,
      images: [],
      category_id: null,
      cost: null,
      compare_price: null,
      featured: false,
      is_active: true,
      version: 3,
      variants: [
        { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: 'สี: น้ำเงิน', price: 599, stock: 6 },
        { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', label: 'สี: เขียว', price: 699, stock: 7 },
      ],
    },
  } as Record<string, any>,
  liveFailure: false,
  liveEmpty: false,
  liveFallback: false,
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
  if (url.startsWith('/api/commerce/products/')) {
    if (state.detailFailure)
      return Response.json({ error: 'โหลดข้อมูลสินค้าไม่สำเร็จ' }, { status: 503 })
    const id = new URL(url, location.origin).pathname.split('/').at(-1)!
    const snapshot = structuredClone(state.details[id])
    // Deliberately ignore AbortSignal: late provider responses must still be fenced by the form.
    if (state.detailDelays[id])
      await new Promise((resolve) => setTimeout(resolve, state.detailDelays[id]))
    return snapshot
      ? Response.json({ product: snapshot })
      : Response.json({ error: 'ไม่พบสินค้า' }, { status: 404 })
  }
  if (url.startsWith('/api/facebook/live-videos')) {
    if (state.liveFailure) return Response.json({ error: 'กรุณาเชื่อมต่อเพจใหม่' }, { status: 409 })
    const pageId = new URL(url, location.origin).searchParams.get('page_id')
    return Response.json({
      pageId,
      fallback: state.liveFallback && !state.liveEmpty,
      videos: state.liveEmpty
        ? []
        : [
            {
              id: pageId === '200' ? '654' : state.liveId,
              title: pageId === '200' ? 'ไลฟ์สดเพจที่สอง' : 'ไลฟ์เสื้อผ้าวันนี้',
              thumbnail: 'https://storage.example/live.webp',
              createdAt: '2026-11-01T04:00:00.000Z',
              isLive: !state.liveFallback,
            },
            ...(state.liveExtra ? [{
              id: '987654321098765432',
              title: 'รายการพระเครื่องชื่อยาวสำหรับตรวจหน้าจอ '.repeat(12),
              thumbnail: null,
              createdAt: '2026-11-01T13:30:00Z',
              isLive: false,
            }] : []),
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
    if (state.saveDelay) await new Promise((resolve) => setTimeout(resolve, state.saveDelay))
    if (state.failure)
      return Response.json({ error: 'รหัสสินค้านี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น' }, { status: 409 })
    if (body.id && state.editStale) {
      state.details[body.id].version++
      return Response.json({ error: 'ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่ก่อนบันทึก' }, { status: 409 })
    }
    const id = body.id ?? newProductId
    state.details[id] = { ...body.value, id, version: (state.details[id]?.version ?? 0) + 1 }
    return Response.json({ id })
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
function ModalIsolationProbe() {
  const [selected, setSelected] = useState<string | null>(productId)
  const [tenant, setTenant] = useState('11111111-1111-4111-8111-111111111111')
  useEffect(() => {
    ;(window as any).selectModalProduct = setSelected
    ;(window as any).selectModalTenant = setTenant
  }, [])
  const details = selected ? state.details[selected] : null
  return (
    <QuickProductModal
      tenantId={tenant}
      salesPageUrl="/s/test-shop"
      initialData={details ? { ...details, variants: [...details.variants] } : null}
      onSaved={(product) => {
        state.savedCallbacks.push(product)
      }}
      onDismiss={() => setSelected(null)}
    />
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.search.includes('modal-isolation') ? (
      <ModalIsolationProbe />
    ) : location.search.includes('payment') ? (
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
                {
                  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                  name: 'สินค้าใช้ SKU',
                  code: 'OTHER',
                  sku: ' 01 ',
                  price: 100,
                  stock: 5,
                  variants: [],
                },
                {
                  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                  name: 'สินค้าไม่มีรหัส',
                  code: '',
                  price: 100,
                  stock: 5,
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
