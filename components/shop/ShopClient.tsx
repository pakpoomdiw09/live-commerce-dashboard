'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { AlertTriangle, Boxes, Check, Copy, ExternalLink, Package, PackageX, Pencil, Plus, ShoppingBag, Store, Trash2, Truck, XCircle } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { CF_ORDER_STATUS } from '@/lib/status'
import type { CfOrderStatus, ProductRow } from '@/lib/types'
import { apiError, baht, cn, customerName, when } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { IconTile, Notice } from '@/components/ui/field'
import { StatTile } from '@/components/ui/StatTile'
import { Switch } from '@/components/ui/Switch'
import { ProductForm } from './ProductForm'

export type ShopOrder = {
  id: string
  customer_id: string
  product_name: string
  amount: number
  status: CfOrderStatus
  paid_at: string | null
  confirmed_at?:string|null
  created_at: string
  customers: { display_name: string | null; platform_user_id: string } | null
}

const LOW_STOCK = 3

/** Where each order may go next from the dashboard. Cancelling returns the item to stock (supabase/automation.sql). */
const NEXT: Record<CfOrderStatus, { to: CfOrderStatus; label: string; icon: typeof Check }[]> = {
  pending_payment: [
    { to: 'paid', label: 'ชำระแล้ว', icon: Check },
    { to: 'cancelled', label: 'ยกเลิก', icon: XCircle },
  ],
  paid: [
    { to: 'shipped', label: 'จัดส่งแล้ว', icon: Truck },
    { to: 'cancelled', label: 'ยกเลิก', icon: XCircle },
  ],
  shipped: [],
  cancelled: [],
}

export function ShopClient({ tenantId, pageLinked, products, orders }: { tenantId: string; pageLinked: boolean; products: ProductRow[]; orders: ShopOrder[] }) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const [tab, setTab] = useState<'products' | 'orders'>('products')
  const [editing, setEditing] = useState<ProductRow | 'new' | null>(null)
  const [orderFilter, setOrderFilter] = useState<CfOrderStatus | 'all'>('all')
  const [copied, setCopied] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)

  const saleUrl = (p: ProductRow) => `${window.location.origin}/p/${p.id}`

  async function copy(key: string, text: string) {
    await navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
  }

  async function toggleActive(p: ProductRow, is_active: boolean) {
    const { error } = await db.from('products').update({ is_active }).eq('id', p.id)
    if (error) setNotice({ tone: 'error', text: `เปลี่ยนสถานะไม่สำเร็จ: ${error.message}` })
    router.refresh()
  }

  async function remove(p: ProductRow) {
    if (!confirm(`ลบสินค้า "${p.name}"? ออเดอร์เดิมยังอยู่ครบ`)) return
    const { error } = await db.from('products').delete().eq('id', p.id)
    if (error) return setNotice({ tone: 'error', text: `ลบไม่สำเร็จ: ${error.message}` })
    router.refresh()
  }

  async function moveOrder(o: ShopOrder, to: CfOrderStatus) {
    if (to === 'cancelled' && !confirm(`ยกเลิกออเดอร์ ${o.product_name}? สินค้าจะถูกคืนเข้าสต็อก`)) return
    const { error } = await db.from('orders').update({ status: to }).eq('id', o.id)
    if (error) return setNotice({ tone: 'error', text: `เปลี่ยนสถานะไม่สำเร็จ: ${error.message}` })
    router.refresh()
  }
  async function confirmDelivery(o:ShopOrder){
    const evidence=prompt('ยืนยันว่าลูกค้าได้รับสินค้าจริง: ระบุเลขพัสดุพร้อมผลติดตาม/หลักฐานส่งถึง (ห้ามใช้เพียงสถานะจัดส่งแล้ว)')
    if(!evidence?.trim())return
    const deliveredAt=prompt('วันที่และเวลาส่งถึงจริง เช่น 2026-10-16T10:30:00+07:00')
    if(!deliveredAt)return
    try{
      const res=await fetch(`/api/follow-ups/orders/${o.id}/delivery`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId,evidence,deliveredAt})})
      if(!res.ok)throw new Error(await apiError(res))
      setNotice({tone:'success',text:'บันทึกหลักฐานส่งถึงแล้ว ระบบสร้างงานตาม Workflow ที่เปิดอยู่และสิทธิ์แพ็กเกจจริง'});router.refresh()
    }catch(e){setNotice({tone:'error',text:e instanceof Error?e.message:'บันทึกหลักฐานไม่ได้'})}
  }
  async function confirmOrder(o:ShopOrder){
    try{const res=await fetch(`/api/follow-ups/orders/${o.id}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tenantId})});if(!res.ok)throw new Error(await apiError(res));setNotice({tone:'success',text:'ยืนยันออเดอร์แล้ว (ยังไม่ใช่การยืนยันชำระเงิน)'});router.refresh()}
    catch(e){setNotice({tone:'error',text:e instanceof Error?e.message:'ยืนยันออเดอร์ไม่ได้'})}
  }

  const active = products.filter((p) => p.is_active)
  const lowStock = active.filter((p) => p.stock <= LOW_STOCK)
  const stockValue = active.reduce((s, p) => s + p.price * p.stock, 0)
  const pending = orders.filter((o) => o.status === 'pending_payment')
  const visibleOrders = orderFilter === 'all' ? orders : orders.filter((o) => o.status === orderFilter)

  if (editing) {
    return (
      <div className="mx-auto w-full max-w-5xl p-4 md:p-8">
        <ProductForm
          tenantId={tenantId}
          product={editing === 'new' ? null : editing}
          takenCodes={products.filter((p) => editing === 'new' || p.id !== editing.id).map((p) => p.code.toLowerCase())}
          onDone={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      <PageHeader
        title="ร้านค้า / เซลเพจ"
        description="จัดการสินค้า สต็อก และลิงก์เซลเพจสำหรับส่งในแชท ลูกค้าพิมพ์ CF + รหัสสินค้าเพื่อสั่งซื้อ ระบบตัดสต็อกให้อัตโนมัติ"
        action={
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden />
            เพิ่มสินค้า
          </Button>
        }
      />
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!pageLinked && <Notice tone="error">ร้านนี้ยังไม่ได้เชื่อมเพจ Facebook: เซลเพจจะยังไม่มีปุ่มทักแชท</Notice>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile icon={Package} label="สินค้าที่เปิดขาย" value={active.length.toLocaleString('th-TH')} foot={`ทั้งหมด ${products.length.toLocaleString('th-TH')} รายการ`} />
        <StatTile icon={Boxes} label="มูลค่าสต็อก" value={baht(stockValue)} foot="ราคาขาย × จำนวนคงเหลือ" />
        <StatTile icon={AlertTriangle} label="ใกล้หมด / หมด" value={lowStock.length.toLocaleString('th-TH')} foot={`เหลือไม่เกิน ${LOW_STOCK} ชิ้น`} />
        <StatTile icon={ShoppingBag} label="ออเดอร์รอชำระ" value={pending.length.toLocaleString('th-TH')} foot={baht(pending.reduce((s, o) => s + o.amount, 0))} />
      </div>

      <div role="tablist" className="inline-flex rounded-lg bg-slate-100 p-1 text-sm">
        {(
          [
            ['products', `สินค้า (${products.length})`],
            ['orders', `ออเดอร์ (${orders.length})`],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('rounded-md px-4 py-1.5 font-medium', tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'products' ? (
        products.length === 0 ? (
          <Card className="grid place-items-center px-6 py-16 text-center">
            <IconTile className="h-14 w-14">
              <Store className="h-7 w-7" aria-hidden />
            </IconTile>
            <p className="mt-4 font-semibold text-slate-900">ยังไม่มีสินค้า</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">เพิ่มสินค้าพร้อมรหัส CF แล้วลูกค้าจะสั่งซื้อในแชทได้ทันที</p>
            <Button className="mt-5" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden />
              เพิ่มสินค้าชิ้นแรก
            </Button>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <Card key={p.id} className={cn('flex flex-col overflow-hidden', !p.is_active && 'opacity-60')}>
                <div className="relative aspect-[4/3] bg-slate-100">
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="grid h-full place-items-center text-slate-300">
                      <Package className="h-10 w-10" aria-hidden />
                    </span>
                  )}
                  <span className="absolute top-2 left-2 rounded-md bg-slate-900/80 px-2 py-0.5 font-mono text-xs font-semibold text-white">CF {p.code}</span>
                  <span className="absolute top-2 right-2">
                    {p.stock === 0 ? (
                      <Badge tone="danger">หมด</Badge>
                    ) : p.stock <= LOW_STOCK ? (
                      <Badge tone="warning">เหลือ {p.stock}</Badge>
                    ) : (
                      <Badge tone="success">คงเหลือ {p.stock}</Badge>
                    )}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900">{p.name}</p>
                      <p className="text-sm font-semibold text-orange-600 tabular-nums">{baht(p.price)}</p>
                    </div>
                    <Switch checked={p.is_active} onChange={(v) => toggleActive(p, v)} label={`เปิดขาย ${p.name}`} />
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => copy(`link:${p.id}`, saleUrl(p))}>
                      {copied === `link:${p.id}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      ลิงก์เซลเพจ
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => copy(`msg:${p.id}`, `${p.name} ราคา ${baht(p.price)}\nดูรายละเอียด: ${saleUrl(p)}\nสั่งซื้อพิมพ์ CF ${p.code} ในแชทนี้ได้เลยค่ะ`)}
                      title="คัดลอกข้อความพร้อมลิงก์ ไปวางในแชท"
                    >
                      {copied === `msg:${p.id}` ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      ข้อความส่งแชท
                    </Button>
                    <Link href={`/p/${p.id}`} target="_blank" className="inline-flex h-8 items-center rounded-lg px-2 text-slate-500 hover:bg-slate-100" aria-label={`เปิดเซลเพจ ${p.name}`}>
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <Button size="icon" variant="ghost" className="ml-auto h-8 w-8" onClick={() => setEditing(p)} aria-label={`แก้ไข ${p.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 hover:text-rose-600" onClick={() => remove(p)} aria-label={`ลบ ${p.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : (
        <Card>
          <CardHeader
            title="ออเดอร์ล่าสุด"
            description="ยกเลิกออเดอร์ = คืนสินค้าเข้าสต็อกอัตโนมัติ · ตรวจสลิปผ่าน = เปลี่ยนเป็นชำระแล้วอัตโนมัติ"
            action={
              <select
                value={orderFilter}
                onChange={(e) => setOrderFilter(e.target.value as CfOrderStatus | 'all')}
                aria-label="กรองตามสถานะ"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
              >
                <option value="all">ทุกสถานะ</option>
                {(Object.keys(CF_ORDER_STATUS) as CfOrderStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {CF_ORDER_STATUS[s].label}
                  </option>
                ))}
              </select>
            }
          />
          {visibleOrders.length === 0 ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500">
              <PackageX className="h-4 w-4" aria-hidden />
              ไม่มีออเดอร์
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">ลูกค้า</th>
                    <th className="px-3 py-2.5 font-medium">สินค้า</th>
                    <th className="px-3 py-2.5 text-right font-medium">ยอด</th>
                    <th className="px-3 py-2.5 font-medium">สถานะ</th>
                    <th className="px-3 py-2.5 font-medium">สั่งเมื่อ</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visibleOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="px-5 py-3">
                        {o.customers ? (
                          <Link href={`/inbox?customer=${o.customer_id}`} className="font-medium text-slate-800 hover:underline">
                            {customerName(o.customers)}
                          </Link>
                        ) : (
                          '-'
                        )}
                      </td>
                      <td className="px-3 py-3 text-slate-700">{o.product_name}</td>
                      <td className="px-3 py-3 text-right font-medium tabular-nums">{baht(o.amount)}</td>
                      <td className="px-3 py-3">
                        <Badge tone={CF_ORDER_STATUS[o.status].tone}>{CF_ORDER_STATUS[o.status].label}</Badge>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500 tabular-nums" suppressHydrationWarning>
                        {when(o.created_at)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {NEXT[o.status].map((n) => (
                            <Button key={n.to} size="sm" variant={n.to === 'cancelled' ? 'ghost' : 'secondary'} onClick={() => moveOrder(o, n.to)}>
                              <n.icon className="h-3.5 w-3.5" aria-hidden />
                              {n.label}
                            </Button>
                          ))}
                          {o.status==='shipped'&&<Button size="sm" variant="secondary" onClick={()=>void confirmDelivery(o)}><Check className="h-3.5 w-3.5"/>ยืนยันส่งถึงจริง</Button>}
                          {o.status==='pending_payment'&&!o.confirmed_at&&<Button size="sm" variant="secondary" onClick={()=>void confirmOrder(o)}>ยืนยันออเดอร์</Button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
