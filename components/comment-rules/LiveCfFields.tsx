'use client'

import type { CommentRule, LiveProductOption } from '@/lib/features/comments/comment-rules'

type Fields = Pick<
  CommentRule,
  'live_product_id' | 'live_variant_id' | 'live_stock_limit' | 'live_post_id'
>
const input = 'mt-1 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm'

export function LiveCfFields({
  products,
  error,
  value,
  onChange,
}: {
  products: LiveProductOption[]
  error: string | null
  value: Fields
  onChange: (value: Partial<Fields>) => void
}) {
  const product = products.find((p) => p.id === value.live_product_id)
  return (
    <div className="min-w-0 space-y-4 text-sm">
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {!error && !products.length && (
        <p>ยังไม่มีสินค้าที่เปิดขาย กรุณาเพิ่มสินค้าในหน้าร้านค้าก่อน</p>
      )}
      <label className="block">
        สินค้าจากร้านค้า / เซลเพจ
        <select
          aria-label="สินค้าจากร้านค้า / เซลเพจ"
          className={input}
          value={value.live_product_id ?? ''}
          onChange={(e) =>
            onChange({ live_product_id: e.target.value || null, live_variant_id: null })
          }
        >
          <option value="">เลือกสินค้า</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.code} · คงเหลือ {p.stock}
            </option>
          ))}
        </select>
      </label>
      {!!product?.variants.length && (
        <label className="block">
          ตัวเลือกสินค้า
          <select
            aria-label="ตัวเลือกสินค้า"
            className={input}
            value={value.live_variant_id ?? ''}
            onChange={(e) => onChange({ live_variant_id: e.target.value || null })}
          >
            <option value="">เลือกสี / ขนาด</option>
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label} · {Number(v.price).toFixed(2)} บาท · คงเหลือ {v.stock}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block">
        สต็อกที่ใช้ขาย
        <select
          aria-label="สต็อกที่ใช้ขาย"
          className={input}
          value={value.live_stock_limit == null ? 'shared' : 'limited'}
          onChange={(e) => onChange({ live_stock_limit: e.target.value === 'shared' ? null : 1 })}
        >
          <option value="shared">ตัดจากสต็อกหลักของเซลเพจ</option>
          <option value="limited">กำหนดจำนวนสูงสุดสำหรับกฎไลฟ์นี้</option>
        </select>
      </label>
      {value.live_stock_limit != null && (
        <label className="block">
          จำนวนที่ปล่อยขายในไลฟ์
          <input
            aria-label="จำนวนที่ปล่อยขายในไลฟ์"
            className={input}
            type="number"
            min={1}
            max={1000000}
            step={1}
            value={Number.isNaN(value.live_stock_limit) ? '' : value.live_stock_limit}
            onChange={(e) => onChange({ live_stock_limit: e.target.valueAsNumber })}
          />
        </label>
      )}
      <p className="text-xs text-slate-500">
        ทุกออเดอร์ตัดสต็อกหลักทันที จำนวนที่กำหนดเป็นเพดานขายของกฎนี้ ไม่ใช่สต็อกเพิ่ม
        แยกรหัสหรือสีด้วยการสร้างกฎเพิ่มได้
      </p>
      <label className="block">
        รหัสโพสต์ / วิดีโอไลฟ์ (ไม่บังคับ)
        <input
          aria-label="รหัสโพสต์ / วิดีโอไลฟ์"
          className={input}
          value={value.live_post_id ?? ''}
          maxLength={140}
          placeholder="เช่น 123456789 หรือ 123_456"
          onChange={(e) => onChange({ live_post_id: e.target.value || null })}
        />
      </label>
      <p className="text-xs text-slate-500">
        ระบุรหัสเพื่อจำกัดเฉพาะไลฟ์นี้ รวมถึงคอมเมนต์ที่ Meta ส่งผ่าน feed หากเว้นว่าง
        จะรับเฉพาะเหตุการณ์ที่ยืนยันว่าเป็นไลฟ์สด
      </p>
      <p className="rounded-xl bg-orange-50 p-3 text-xs text-orange-900">
        ลูกค้าพิมพ์รหัสที่ตั้งไว้ในขั้นที่ 2 ได้ทันที เช่น 159 หรือ CF A1 ระบบจะส่งยอดชำระพร้อม QR
        บัญชีหลักทางแชท และยืนยันใต้คอมเมนต์ กรุณาตั้งบัญชีหลักและ QR ในหน้าจัดการสลิป
      </p>
    </div>
  )
}
