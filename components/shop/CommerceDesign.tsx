import type { SalesDesign } from '@/lib/features/commerce/commerce-core'
import type { ReactNode } from 'react'
/** Plain React text only. No HTML, iframe, script or arbitrary CTA URL. */
export function CommerceDesign({ design, products }: { design: SalesDesign | null; products?: ReactNode }) {
  if (!design) return null
  return <div className="space-y-6">{design.blocks.filter(block => block.title || block.text || block.image || block.button || ['products', 'cta'].includes(block.type)).map(block => <section key={block.id} className={`overflow-hidden rounded-2xl p-5 sm:p-8 ${block.type === 'hero' || block.type === 'promotion' ? 'bg-orange-50' : 'border border-slate-100 bg-white'}`}>
    {block.image && <img src={block.image} alt={block.title || 'ภาพประกอบร้านค้า'} className="mb-4 max-h-80 w-full rounded-xl object-cover"/>}
    <h2 className="break-words text-xl font-bold" style={{ color: design.theme }}>{block.title}</h2>
    <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{block.text}</p>
    {block.type === 'products' && products}
    {['cta', 'hero'].includes(block.type) && <a href="#store-products" style={{ backgroundColor: design.theme }} className="mt-4 inline-flex rounded-xl px-5 py-3 text-sm font-semibold text-white">{block.button || 'เลือกซื้อสินค้า'}</a>}
  </section>)}</div>
}
