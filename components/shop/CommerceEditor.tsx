'use client'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  BLOCK_NAMES,
  type SalesBlock,
  type SalesDesign,
} from '@/lib/features/commerce/commerce-core'
import { CommerceDesign } from '@/components/shop/CommerceDesign'
export const commerceInput =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:bg-slate-50'
export const commerceButton =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-sm font-medium text-orange-800 hover:bg-orange-50 disabled:opacity-50'
export const commercePrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50'
export type ShopMutation = (
  action: string,
  value: any,
  id?: string,
  version?: number,
) => Promise<string | null>
const newBlock = (type: SalesBlock['type']): SalesBlock => ({
  id: crypto.randomUUID(),
  type,
  title: '',
  text: '',
  image: '',
  button: '',
})
export function CommerceEditor({
  pages,
  products,
  advanced,
  canManage,
  busy,
  mutate,
  upload,
}: {
  pages: any[]
  products: any[]
  advanced: boolean
  canManage: boolean
  busy: boolean
  mutate: ShopMutation
  upload: (file: File) => Promise<string | null>
}) {
  const [current, setCurrent] = useState<any>(null),
    [name, setName] = useState('หน้าแรก'),
    [slug, setSlug] = useState('home'),
    [mobile, setMobile] = useState(false)
  const [design, setDesign] = useState<SalesDesign>({ theme: '#f97316', blocks: [] })
  const load = (page: any) => {
    setCurrent(page)
    setName(page.name)
    setSlug(page.slug)
    setDesign(page.draft)
  }
  const patch = (index: number, value: Partial<SalesBlock>) =>
    setDesign((d) => ({
      ...d,
      blocks: d.blocks.map((block, i) => (i === index ? { ...block, ...value } : block)),
    }))
  const move = (i: number, next: number) =>
    setDesign((d) => {
      const blocks = [...d.blocks]
      ;[blocks[i], blocks[next]] = [blocks[next], blocks[i]]
      return { ...d, blocks }
    })
  const save = async () => {
    const id = await mutate('page', { name, slug, design }, current?.id, current?.version)
    if (id) setCurrent(null)
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          เปิดฉบับร่าง{' '}
          <select
            className={commerceInput}
            value={current?.id ?? ''}
            onChange={(e) => {
              const p = pages.find((p) => p.id === e.target.value)
              if (p) load(p)
            }}
          >
            <option value="">เลือกหน้าเพื่อแก้ไข</option>
            {pages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.published ? 'เผยแพร่แล้ว' : 'ฉบับร่าง'}
              </option>
            ))}
          </select>
        </label>
        <button
          className={commerceButton}
          onClick={() => {
            setCurrent(null)
            setName('หน้าใหม่')
            setSlug('')
            setDesign({ theme: '#f97316', blocks: [] })
          }}
        >
          สร้างหน้าใหม่
        </button>
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <fieldset
            disabled={busy || !canManage}
            className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"
          >
            <legend className="px-2 font-semibold">ออกแบบหน้าเว็บของร้าน</legend>
            <label className="block text-sm">
              ชื่อหน้า
              <input
                className={commerceInput}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              ชื่อลิงก์ (หน้าแรกใช้ home)
              <input
                className={commerceInput}
                value={slug}
                maxLength={60}
                onChange={(e) => setSlug(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              สีร้าน
              <input
                aria-label="สีธีมร้านค้า"
                type="color"
                value={design.theme}
                onChange={(e) => setDesign({ ...design, theme: e.target.value })}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={commerceButton}
                onClick={() =>
                  setDesign({
                    theme: '#f97316',
                    blocks: [
                      {
                        ...newBlock('hero'),
                        title: 'ยินดีต้อนรับสู่ร้านของเรา',
                        text: 'แนะนำร้านและสินค้าของคุณที่นี่',
                      },
                      newBlock('products'),
                      newBlock('footer'),
                    ],
                  })
                }
              >
                เทมเพลตร้านเรียบง่าย
              </button>
              <button
                type="button"
                disabled={!advanced}
                className={commerceButton}
                onClick={() =>
                  setDesign({
                    template: 'premium',
                    theme: '#db2777',
                    blocks: [
                      newBlock('hero'),
                      newBlock('promotion'),
                      newBlock('products'),
                      newBlock('faq'),
                      newBlock('footer'),
                    ],
                  })
                }
              >
                {!advanced && '🔒 '}เทมเพลตร้านพรีเมียม
              </button>
            </div>
            <p className="text-xs text-slate-500">
              ข้อความตัวอย่างในเทมเพลตต้องแก้เป็นข้อมูลจริงก่อนเผยแพร่
              รีวิวใช้เฉพาะคำรีวิวจริงที่ได้รับอนุญาต
            </p>
            {design.blocks.map((b, i) => (
              <div key={b.id} className="space-y-3 rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">
                    {i + 1}. {BLOCK_NAMES[b.type]}
                  </strong>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      aria-label={`เลื่อนส่วนที่ ${i + 1} ขึ้น`}
                      disabled={i === 0}
                      className={commerceButton}
                      onClick={() => move(i, i - 1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`เลื่อนส่วนที่ ${i + 1} ลง`}
                      disabled={i === design.blocks.length - 1}
                      className={commerceButton}
                      onClick={() => move(i, i + 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`ลบส่วนที่ ${i + 1}`}
                      className={commerceButton}
                      onClick={() =>
                        setDesign((d) => ({ ...d, blocks: d.blocks.filter((_, j) => i !== j) }))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <label className="block text-xs">
                  หัวข้อ
                  <input
                    className={commerceInput}
                    maxLength={160}
                    value={b.title}
                    onChange={(e) => patch(i, { title: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  รายละเอียด
                  <textarea
                    className={commerceInput}
                    rows={3}
                    maxLength={5000}
                    value={b.text}
                    onChange={(e) => patch(i, { text: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  ข้อความปุ่ม
                  <input
                    className={commerceInput}
                    value={b.button}
                    maxLength={60}
                    onChange={(e) => patch(i, { button: e.target.value })}
                  />
                </label>
                <label className="block text-xs">
                  รูปประกอบ
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (e) => {
                      const f = e.target.files?.[0]
                      if (f) {
                        const url = await upload(f)
                        if (url) patch(i, { image: url })
                      }
                    }}
                  />
                </label>
                {b.image && (
                  <button
                    type="button"
                    className={commerceButton}
                    onClick={() => patch(i, { image: '' })}
                  >
                    เอารูปออก
                  </button>
                )}
              </div>
            ))}
            <label className="block text-sm">
              เพิ่มส่วนประกอบ
              <select
                className={commerceInput}
                value=""
                disabled={design.blocks.length >= 30}
                onChange={(e) =>
                  setDesign((d) => ({
                    ...d,
                    blocks: [...d.blocks, newBlock(e.target.value as SalesBlock['type'])],
                  }))
                }
              >
                <option value="">เลือกส่วนที่ต้องการเพิ่ม</option>
                {Object.entries(BLOCK_NAMES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className={commercePrimary} onClick={() => void save()}>
              <Plus className="h-4 w-4" />
              บันทึกฉบับร่าง
            </button>
          </fieldset>
          <p className="text-xs leading-6 text-slate-500">
            หลังบันทึก ให้เลือกฉบับร่างอีกครั้งก่อนเผยแพร่
            หน้าเว็บที่เผยแพร่จะใช้ฉบับที่บันทึกแล้วเท่านั้น ยกเลิกเผยแพร่เฉพาะแบบหน้านี้
            หากต้องการปิดทั้งร้านให้ปิดที่ตั้งค่าร้านค้า
          </p>
          {current && (
            <div className="flex flex-wrap gap-2">
              <button
                disabled={busy || !canManage}
                className={commercePrimary}
                onClick={() => {
                  if (confirm('เผยแพร่ฉบับที่บันทึกแล้วให้ลูกค้าเห็นหรือไม่?'))
                    void mutate('publish', {}, current.id, current.version).then((id) => {
                      if (id) setCurrent(null)
                    })
                }}
              >
                เผยแพร่ฉบับที่บันทึก
              </button>
              <button
                disabled={busy || !canManage || !current.published}
                className={commerceButton}
                onClick={() => {
                  if (confirm('ยกเลิกการเผยแพร่หน้านี้หรือไม่?'))
                    void mutate('unpublish', {}, current.id, current.version).then((id) => {
                      if (id) setCurrent(null)
                    })
                }}
              >
                ยกเลิกเผยแพร่
              </button>
            </div>
          )}
        </div>
        <aside className="min-w-0 space-y-3 xl:sticky xl:top-4">
          <div className="flex flex-wrap gap-2">
            <button
              className={commerceButton}
              onClick={() => setMobile(false)}
              aria-pressed={!mobile}
            >
              ดูบนคอมพิวเตอร์
            </button>
            <button
              className={commerceButton}
              onClick={() => setMobile(true)}
              aria-pressed={mobile}
            >
              ดูบนมือถือ
            </button>
          </div>
          <p className="text-xs text-slate-500">
            ตัวอย่างข้อความและภาพ · สินค้าจริงจะแสดงในหน้าร้าน ไม่สร้างออเดอร์ในหน้าตัวอย่างนี้
          </p>
          <div
            className={`mx-auto min-h-80 overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 ${mobile ? 'max-w-[375px]' : 'w-full'}`}
          >
            <CommerceDesign
              design={design}
              products={
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {products
                    .filter((p) => p.is_active)
                    .slice(0, 4)
                    .map((p) => (
                      <div key={p.id} className="rounded-xl bg-slate-50 p-3 text-sm">
                        <strong className="break-words">{p.name}</strong>
                        <p className="mt-2 text-orange-700">
                          ฿{Number(p.price).toLocaleString('th-TH')}
                        </p>
                      </div>
                    ))}
                </div>
              }
            />
            {!design.blocks.length && (
              <p className="p-8 text-center text-sm text-slate-500">
                เลือกเทมเพลตหรือเพิ่มส่วนประกอบเพื่อเริ่มต้น
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
