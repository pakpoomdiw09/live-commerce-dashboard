import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CommerceWorkspace } from '@/components/shop/CommerceWorkspace'
import { CommerceStorefront } from '@/components/shop/CommerceStorefront'
const tenantId = '11111111-1111-4111-8111-111111111111', productId = '22222222-2222-4222-8222-222222222222'
const data: any = { tenant: { id: tenantId, name: 'ร้านทดสอบออฟไลน์' }, canManage: true, limits: { max_products: null, max_pages: 3, checkout: true, reports: true, advanced_templates: true }, flags: { dashboard: true, products: true, editor: true, storefront: true }, store: { slug: 'offline-only', name: 'ร้านทดสอบออฟไลน์', description: 'ข้อมูลจำลองสำหรับทดสอบเท่านั้น', logo: '', banner: '', contact: 'ไม่มีการติดต่อจริง', is_open: true }, products: [{ id: productId, code: 'A1', name: 'สินค้าทดสอบออฟไลน์', description: 'ข้อมูลทดสอบ ไม่มีการขายจริง', price: 100, stock: 3, is_active: true, image_url: null, commerce_images: [], commerce_featured: true, commerce_version: 0, commerce_category_id: null, created_at: new Date().toISOString() }], categories: [], variants: [], pages: [], orders: [], items: [], customers: [], audit: [] }
data.filters = { tab: 'overview', productPage: 1, orderPage: 1, customerPage: 1, categoryPage: 1, pagePage: 1, q: '', category: '', sort: 'new', status: 'all' }
data.pageSize = 50
data.categoryRows = []
data.counts = { products: 1, orders: 0, customers: 0, categories: 0, pages: 0 }
data.stats = { products: 1, customers: 0, todayOrders: 0, pending: 0, shipping: 0, revenue: 0, amounts: Array.from({ length: 14 }, (_, i) => ({ label: String(i + 1), amount: 0 })), best: [], low: [] }
data.report = { monthly: [] }
const fixture = { data, calls: [] as any[], checkoutCalls: 0 }
;(window as any).commerceFixture = fixture
window.fetch = async (input, init) => {
  const url = String(input), value = JSON.parse(String(init?.body ?? '{}')); fixture.calls.push({ url, value })
  let result: any = {}
  if (url.startsWith('/api/commerce?')) result = data
  else if (url === '/api/commerce') {
    const id = value.id || crypto.randomUUID(); result = { id }
    if (value.action === 'product') {
      const p = value.value, old = data.products.find((r: any) => r.id === id)
      const row = { ...p, id, commerce_images: p.images, image_url: p.images[0] || null, commerce_category_id: p.category_id, commerce_compare_price: p.compare_price, commerce_cost: p.cost, commerce_featured: p.featured, commerce_version: (old?.commerce_version ?? 0) + 1, created_at: old?.created_at || new Date().toISOString() }
      data.products = [...data.products.filter((p: any) => p.id !== id), row]
    } else if (value.action === 'archive') data.products = data.products.filter((p: any) => p.id !== id)
    else if (value.action === 'page') { const old = data.pages.find((p: any) => p.id === id); data.pages = [...data.pages.filter((p: any) => p.id !== id), { id, name: value.value.name, slug: value.value.slug, draft: value.value.design, version: old ? old.version + 1 : 0, published: old?.published ?? null }] }
    else if (value.action === 'publish') { const page = data.pages.find((p: any) => p.id === id); page.published = page.draft; page.version++ }
    else if (value.action === 'unpublish') { const page = data.pages.find((p: any) => p.id === id); page.published = null; page.version++ }
  } else if (url.includes('/checkout')) { fixture.checkoutCalls++; result = { number: 'TEST-OFFLINE-ONLY', total: 100, status: 'pending_payment' } }
  else throw Error('Network blocked: ' + url)
  data.counts.products = data.products.length
  data.counts.pages = data.pages.length
  data.stats.products = data.products.length
  return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } })
}
function Fixture() {
  const [tab, setTab] = useState<any>('overview'), [storefront, setStorefront] = useState(false)
  return <div onClickCapture={e => { const a = (e.target as Element).closest('a'); if (a?.getAttribute('href')?.startsWith('/shop?tab=')) { e.preventDefault(); setStorefront(false); setTab(new URL(a.href).searchParams.get('tab')) } }}><div className="bg-amber-100 p-4 text-sm">ทดสอบออฟไลน์เท่านั้น · ไม่สร้างออเดอร์จริง <button className="ml-4 underline" onClick={() => setStorefront(!storefront)}>{storefront ? 'กลับระบบจัดการ' : 'เปิดหน้าร้านทดสอบ'}</button></div>{storefront ? <CommerceStorefront data={{ ...data, products: data.products.filter((p: any) => p.is_active), design: data.pages[0]?.published ?? null, checkout: true }}/> : <CommerceWorkspace initial={data} tab={tab}/>}</div>
}
createRoot(document.getElementById('root')!).render(<Fixture/> )
