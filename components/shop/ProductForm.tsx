'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Minus, Plus } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import type { ProductRow } from '@/lib/types'
import { baht, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Notice, inputClass } from '@/components/ui/field'
import { Switch } from '@/components/ui/Switch'
import { ImagePicker } from '@/components/ui/ImagePicker'

type Draft = { code: string; name: string; price: string; stock: string; description: string; image_url: string | null; is_active: boolean }

/** Same rule as cfCode() in lib/features/commerce/orders.ts: what a customer can type after "CF". */
const CODE = /^[\p{L}\p{N}_-]{1,20}$/u

export function ProductForm({ tenantId, product, takenCodes, onDone }: { tenantId: string; product: ProductRow | null; takenCodes: string[]; onDone: () => void }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const [d, setD] = useState<Draft>(() => ({
    code: product?.code ?? '',
    name: product?.name ?? '',
    price: product ? String(product.price) : '',
    stock: product ? String(product.stock) : '0',
    description: product?.description ?? '',
    image_url: product?.image_url ?? null,
    is_active: product?.is_active ?? true,
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))

  const code = d.code.trim()
  const price = Number(d.price)
  const stock = Number(d.stock)
  const problems = [
    !CODE.test(code) && 'รหัสสินค้า 1-20 ตัว (ตัวอักษร ตัวเลข - _ ไม่มีช่องว่าง)',
    takenCodes.includes(code.toLowerCase()) && `รหัส ${code} ถูกใช้แล้ว`,
    !d.name.trim() && 'ใส่ชื่อสินค้า',
    !(price > 0 && price < 10_000_000) && 'ราคาต้องมากกว่า 0',
    !(Number.isInteger(stock) && stock >= 0 && stock <= 1_000_000) && 'สต็อกต้องเป็นจำนวนเต็มตั้งแต่ 0',
  ].filter((p): p is string => !!p)

  async function save() {
    if (problems.length) return setError(problems.join(' · '))
    setSaving(true)
    setError(null)
    const row = {
      tenant_id: tenantId,
      code,
      name: d.name.trim(),
      price: Math.round(price * 100) / 100,
      stock,
      description: d.description.trim() || null,
      image_url: d.image_url,
      is_active: d.is_active,
    }
    const { error: saveError } = product ? await db.from('products').update(row).eq('id', product.id) : await db.from('products').insert(row)
    setSaving(false)
    if (saveError) {
      return setError(saveError.code === '23505' ? `รหัส ${code} ถูกใช้แล้ว` : `บันทึกไม่สำเร็จ: ${saveError.message}`)
    }
    onDone()
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <button type="button" onClick={onDone} aria-label="กลับ" className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
              <ArrowLeft className="h-4 w-4" />
            </button>
            {product ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}
          </span>
        }
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onDone}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} loading={saving}>
              บันทึก
            </Button>
          </div>
        }
      />
      <div className="grid gap-6 p-5 md:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
            <Field label="รหัส CF" hint={code ? `ลูกค้าพิมพ์ “CF ${code}”` : 'เช่น A12'}>
              <input value={d.code} onChange={(e) => set('code', e.target.value)} maxLength={20} className={cn(inputClass, 'font-mono')} />
            </Field>
            <Field label="ชื่อสินค้า">
              <input value={d.name} onChange={(e) => set('name', e.target.value)} maxLength={120} placeholder="เช่น เสื้อยืด Oversize สีดำ" className={inputClass} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="ราคา (บาท)" hint={price > 0 ? baht(price) : undefined}>
              <input type="number" inputMode="decimal" min={0} step="0.01" value={d.price} onChange={(e) => set('price', e.target.value)} className={inputClass} />
            </Field>
            <Field label="สต็อก" hint="ลดลงอัตโนมัติเมื่อมีออเดอร์ คืนเมื่อยกเลิก">
              <div className="flex">
                <button
                  type="button"
                  onClick={() => set('stock', String(Math.max(0, (Number(d.stock) || 0) - 1)))}
                  aria-label="ลดสต็อก"
                  className="rounded-l-lg border border-r-0 border-slate-200 px-3 text-slate-500 hover:bg-slate-50"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <input type="number" inputMode="numeric" min={0} value={d.stock} onChange={(e) => set('stock', e.target.value)} className={cn(inputClass, 'rounded-none text-center')} />
                <button
                  type="button"
                  onClick={() => set('stock', String((Number(d.stock) || 0) + 1))}
                  aria-label="เพิ่มสต็อก"
                  className="rounded-r-lg border border-l-0 border-slate-200 px-3 text-slate-500 hover:bg-slate-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </Field>
          </div>
          <Field label="รายละเอียด" hint="แสดงบนเซลเพจ และ AI Agent ใช้ตอบคำถามลูกค้า">
            <textarea
              rows={5}
              maxLength={2000}
              value={d.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="ขนาด วัสดุ วิธีใช้ ฯลฯ"
              className={cn(inputClass, 'resize-none')}
            />
          </Field>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-700">เปิดขาย (รับออเดอร์ CF และแสดงเซลเพจ)</span>
            <Switch checked={d.is_active} onChange={(v) => set('is_active', v)} label="เปิดขาย" />
          </div>
        </div>
        <div>
          <span className="mb-1.5 block text-sm font-medium text-slate-700">รูปสินค้า</span>
          <ImagePicker value={d.image_url} onChange={(url) => set('image_url', url)} folder="products" onError={setError} />
        </div>
      </div>
    </Card>
  )
}
