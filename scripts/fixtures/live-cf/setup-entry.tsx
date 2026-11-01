import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LiveCfSetup } from '@/components/live-cf/LiveCfSetup'
import { liveCfTest } from './setup-mocks'

const productId = '33333333-3333-4333-8333-333333333333'
const newProductId = '44444444-4444-4444-8444-444444444444'
const state = Object.assign(liveCfTest, {
  requests: [] as { url: string; body: any }[],
  failure: false,
  newProductId,
})
;(window as any).liveCfTest = state
window.fetch = async (input, init) => {
  const url = String(input),
    body = JSON.parse(String(init?.body ?? '{}'))
  state.requests.push({ url, body })
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (url === '/api/commerce') {
    if (state.failure)
      return Response.json({ error: 'รหัสสินค้านี้ถูกใช้แล้ว กรุณาเลือกรหัสอื่น' }, { status: 409 })
    return Response.json({ id: newProductId })
  }
  if (url === '/api/live-cf/setup')
    return Response.json({ id: '55555555-5555-4555-8555-555555555555' })
  throw Error('Unexpected fetch ' + url)
}

const empty = location.search.includes('empty')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LiveCfSetup
      tenantId="11111111-1111-4111-8111-111111111111"
      pages={[{ id: '100', name: 'เพจร้านทดสอบ', picture: null }]}
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
      initialRule={null}
      setupError={null}
      salesPageUrl="/s/test-shop"
    />
  </StrictMode>,
)
