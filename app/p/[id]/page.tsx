import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MessageCircle, Package, ShieldCheck } from 'lucide-react'
import { supabaseAdmin } from '@/lib/supabase/server'
import { baht, UUID } from '@/lib/utils'
import { CopyCode } from './CopyCode'

/**
 * Public mini sale page for one product (no login): the link admins paste in Messenger.
 * Read with the service role and limited to active products and non-secret columns.
 */
const getProduct = cache(async (id: string) => {
  if (!UUID.test(id)) return null
  const { data } = await supabaseAdmin()
    .from('products')
    .select('id, code, name, price, stock, description, image_url, is_active, tenants!inner(name, page_id, is_active)')
    .eq('id', id)
    .eq('is_active', true)
    .eq('tenants.is_active', true)
    .maybeSingle()
  if (!data) return null
  return { ...data, price: Number(data.price), tenant: data.tenants as unknown as { name: string; page_id: string | null } | null }
})

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const p = await getProduct((await params).id)
  if (!p) return { title: 'ไม่พบสินค้า' }
  const description = `${baht(p.price)}${p.description ? ` · ${p.description.slice(0, 140)}` : ''}`
  return {
    title: `${p.name} | ${p.tenant?.name ?? 'ร้านค้า'}`,
    description,
    openGraph: { title: p.name, description, images: p.image_url ? [p.image_url] : [] },
  }
}

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const p = await getProduct((await params).id)
  if (!p) notFound()
  const soldOut = p.stock <= 0
  const chat = p.tenant?.page_id ? `https://m.me/${p.tenant.page_id}` : null

  return (
    <main className="min-h-dvh bg-linear-to-b from-orange-50 to-pink-50 px-4 py-8">
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl bg-white shadow-xl shadow-orange-900/5 ring-1 ring-slate-200">
        <div className="relative aspect-square bg-slate-100">
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <span className="grid h-full place-items-center text-slate-300">
              <Package className="h-16 w-16" aria-hidden />
            </span>
          )}
          {soldOut && <span className="absolute top-3 right-3 rounded-full bg-slate-900/85 px-3 py-1 text-sm font-semibold text-white">สินค้าหมด</span>}
        </div>

        <div className="space-y-5 p-6">
          <div>
            {p.tenant?.name && <p className="text-xs font-medium tracking-wide text-orange-600 uppercase">{p.tenant.name}</p>}
            <h1 className="mt-1 text-xl font-bold text-slate-900">{p.name}</h1>
            <p className="mt-2 text-2xl font-bold text-orange-600 tabular-nums">{baht(p.price)}</p>
            {!soldOut && p.stock <= 5 && <p className="mt-1 text-sm font-medium text-rose-600">เหลือเพียง {p.stock} ชิ้น</p>}
          </div>

          {p.description && <p className="text-sm leading-relaxed whitespace-pre-line text-slate-600">{p.description}</p>}

          {!soldOut && (
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">วิธีสั่งซื้อ</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-600">
                <li>กดปุ่มด้านล่างเพื่อเปิดแชทกับร้าน</li>
                <li>
                  พิมพ์ <CopyCode text={`CF ${p.code}`} /> แล้วส่ง
                </li>
                <li>ระบบแจ้งยอดและเลขบัญชี โอนแล้วส่งสลิปในแชทได้เลย</li>
              </ol>
            </div>
          )}

          {chat && (
            <a
              href={chat}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-orange-500 to-pink-500 font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:brightness-105"
            >
              <MessageCircle className="h-5 w-5" aria-hidden />
              {soldOut ? 'สอบถามร้านทาง Messenger' : 'สั่งซื้อทาง Messenger'}
            </a>
          )}

          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
            ตรวจสลิปอัตโนมัติ ปลอดภัยทุกการโอน
          </p>
        </div>
      </div>
    </main>
  )
}
