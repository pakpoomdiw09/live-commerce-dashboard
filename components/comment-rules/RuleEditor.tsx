'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { ruleMatches, type CommentRule } from '@/lib/comment-rules'
import type { PageProfile } from '@/lib/facebook'
import { ICONS, Icon } from '@/components/ui/Icon'
import { Switch } from '@/components/ui/Switch'

type Draft = Omit<CommentRule, 'id' | 'created_at'>

const EMPTY: Omit<Draft, 'tenant_id'> = {
  name: '',
  page_ids: [],
  match_type: 'keyword',
  keywords: [],
  reply_enabled: true,
  reply_text: '',
  inbox_enabled: false,
  inbox_type: 'text',
  inbox_text: '',
  inbox_image_url: null,
  is_active: true,
}
const SUGGESTIONS = ['สนใจ', 'ราคา', 'ขอรายละเอียด', 'เท่าไหร่', 'cf']
// Messenger accepts these for image attachments
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif']
const IMAGE_MAX_BYTES = 8 * 1024 * 1024

const input =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-red-400 focus:ring-2 focus:ring-red-500/20 focus:outline-none'

/** pages: the active tenant's Page(s); a new rule belongs to tenantId (RLS refuses any other) */
export function RuleEditor({ rule, pages, tenantId }: { rule?: CommentRule; pages: PageProfile[]; tenantId: string }) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const [draft, setDraft] = useState<Draft>(() =>
    rule ? { ...rule, tenant_id: rule.tenant_id ?? tenantId } : { ...EMPTY, tenant_id: tenantId, page_ids: pages.length === 1 ? [pages[0].id] : [] },
  )
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sample, setSample] = useState('')

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  // pages a saved rule still points at but the token no longer returns: keep them visible so they can be unticked
  const pageOptions = [
    ...pages,
    ...draft.page_ids.filter((id) => !pages.some((p) => p.id === id)).map((id) => ({ id, name: `เพจ ${id}`, picture: null })),
  ]

  const responseProblems = [
    !draft.reply_enabled && !draft.inbox_enabled && 'เปิดการตอบกลับอย่างน้อย 1 แบบ',
    draft.reply_enabled && !draft.reply_text?.trim() && 'ใส่ข้อความตอบกลับใต้คอมเมนต์',
    draft.inbox_enabled && draft.inbox_type === 'text' && !draft.inbox_text?.trim() && 'ใส่ข้อความส่งเข้าอินบ็อกซ์',
    draft.inbox_enabled && draft.inbox_type === 'image' && !draft.inbox_image_url && 'อัปโหลดรูปที่จะส่งเข้าอินบ็อกซ์',
  ].filter((p): p is string => !!p)
  const done = [draft.page_ids.length > 0, draft.keywords.length > 0, responseProblems.length === 0]
  const problems = [
    !draft.name.trim() && 'ตั้งชื่อกฎ',
    !done[0] && 'เลือกเพจอย่างน้อย 1 เพจ',
    !done[1] && 'เพิ่มคีย์เวิร์ดอย่างน้อย 1 คำ',
    ...responseProblems,
  ].filter((p): p is string => !!p)

  async function upload(file: File) {
    if (!IMAGE_TYPES.includes(file.type)) return setError('รองรับเฉพาะไฟล์ JPG, PNG หรือ GIF')
    if (file.size > IMAGE_MAX_BYTES) return setError('ไฟล์ใหญ่เกิน 8 MB')
    setUploading(true)
    setError(null)
    const path = `rules/${crypto.randomUUID()}.${file.type.split('/')[1]}`
    const { error: upErr } = await db.storage.from('comment-media').upload(path, file, { contentType: file.type })
    setUploading(false)
    if (upErr) return setError(`อัปโหลดไม่สำเร็จ: ${upErr.message}`)
    set('inbox_image_url', db.storage.from('comment-media').getPublicUrl(path).data.publicUrl)
  }

  async function save() {
    if (problems.length) return setError(`ยังขาด: ${problems.join(' · ')}`)
    setSaving(true)
    setError(null)
    const row = {
      ...draft,
      name: draft.name.trim(),
      reply_text: draft.reply_text?.trim() || null,
      inbox_text: draft.inbox_text?.trim() || null,
    }
    const { error: saveErr } = rule
      ? await db.from('comment_rules').update(row).eq('id', rule.id)
      : await db.from('comment_rules').insert(row)
    if (saveErr) {
      setSaving(false)
      return setError(`บันทึกไม่สำเร็จ: ${saveErr.message}`)
    }
    router.push('/comment-replies')
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/comment-replies" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
            <Icon d={ICONS.back} className="h-4 w-4" />
            ตอบกลับคอมเมนต์
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{rule ? 'แก้ไขกฎตอบกลับ' : 'สร้างกฎตอบกลับใหม่'}</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/comment-replies" className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-white">
            ยกเลิก
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={saving || uploading}
            className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-red-200 transition hover:bg-red-600 active:scale-95 disabled:opacity-50"
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">{error}</p>}

      {/* name + active */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <label className="min-w-64 flex-1">
          <span className="mb-1.5 block text-sm font-medium">ชื่อข้อความตอบกลับคอมเมนต์</span>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={100} placeholder="เช่น ตอบคนถามราคา" className={input} />
        </label>
        <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-4 py-2.5">
          <span className="text-sm text-slate-600">เปิดใช้งานกฎนี้</span>
          <Switch checked={draft.is_active} onChange={(v) => set('is_active', v)} label="เปิดใช้งานกฎนี้" />
        </div>
      </div>

      {/* stepper */}
      <ol className="grid grid-cols-3 gap-2 text-sm">
        {['เงื่อนไข', 'การเริ่มทำงาน', 'การตอบกลับ'].map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <StepBadge n={i + 1} done={done[i]} />
            <span className={`truncate font-medium ${done[i] ? 'text-slate-900' : 'text-slate-500'}`}>{label}</span>
            {i < 2 && <span className={`hidden h-0.5 flex-1 rounded-full sm:block ${done[i] ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
          </li>
        ))}
      </ol>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        {/* 1. pages */}
        <StepCard n={1} done={done[0]} title="เงื่อนไข" desc="เลือกเพจที่ต้องการให้กฎนี้ทำงาน">
          {pageOptions.length === 0 ? (
            <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">ยังไม่ได้เชื่อมเพจ: ตั้งค่า FB_PAGE_ID และ PAGE_ACCESS_TOKEN ใน .env.local</p>
          ) : (
            <div className="space-y-2">
              {pageOptions.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-checked:border-red-300 has-checked:bg-red-50/60"
                >
                  <input
                    type="checkbox"
                    checked={draft.page_ids.includes(p.id)}
                    onChange={(e) => set('page_ids', e.target.checked ? [...draft.page_ids, p.id] : draft.page_ids.filter((x) => x !== p.id))}
                    className="h-4 w-4 accent-red-500"
                  />
                  {p.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.picture} alt="" className="h-9 w-9 rounded-full object-cover" />
                  ) : (
                    <span className="grid h-9 w-9 place-items-center rounded-full bg-blue-500 text-sm font-semibold text-white">{p.name.charAt(0)}</span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="block font-mono text-[11px] text-slate-400">{p.id}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </StepCard>

        {/* 2. trigger */}
        <StepCard n={2} done={done[1]} title="การเริ่มทำงาน" desc="ตอบเมื่อคอมเมนต์ของลูกค้าตรงกับเงื่อนไข">
          <div role="radiogroup" aria-label="รูปแบบการตรวจจับ" className="grid grid-cols-2 gap-2">
            {(
              [
                ['exact', 'ทั้งประโยค', 'คอมเมนต์ตรงกับคำทั้งข้อความ'],
                ['keyword', 'คีย์เวิร์ด', 'คอมเมนต์มีคำนี้แยกเป็นคำ (1 ไม่ตรงกับ 985)'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className="cursor-pointer rounded-xl border border-slate-200 p-3 transition hover:bg-slate-50 has-checked:border-red-300 has-checked:bg-red-50/60"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input
                    type="radio"
                    name="match_type"
                    checked={draft.match_type === value}
                    onChange={() => set('match_type', value)}
                    className="h-4 w-4 accent-red-500"
                  />
                  {label}
                </span>
                <span className="mt-1 block text-xs text-slate-500">{hint}</span>
              </label>
            ))}
          </div>

          <div className="mt-4">
            <span className="mb-1.5 block text-sm font-medium">{draft.match_type === 'exact' ? 'ประโยคที่ลูกค้าพิมพ์' : 'คีย์เวิร์ด'}</span>
            <KeywordInput value={draft.keywords} onChange={(v) => set('keywords', v)} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400">ตัวอย่าง:</span>
              {SUGGESTIONS.filter((s) => !draft.keywords.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('keywords', [...draft.keywords, s])}
                  className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-red-300 hover:text-red-600"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-slate-50 p-3">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">ลองพิมพ์คอมเมนต์ตัวอย่าง</span>
            <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="เช่น สนใจค่ะ ราคาเท่าไหร่" className={input} />
            {sample.trim() && (
              <p className={`mt-2 text-xs font-medium ${ruleMatches(draft, sample) ? 'text-emerald-600' : 'text-slate-500'}`}>
                {ruleMatches(draft, sample) ? '✓ ตรงเงื่อนไข ระบบจะตอบคอมเมนต์นี้' : '✗ ไม่ตรงเงื่อนไข'}
              </p>
            )}
          </div>
        </StepCard>

        {/* 3. responses */}
        <StepCard n={3} done={done[2]} title="การตอบกลับ" desc="เลือกว่าจะตอบใต้คอมเมนต์ ส่งเข้าอินบ็อกซ์ หรือทั้งสองแบบ">
          <div className="space-y-4">
            <ResponseBlock
              title="ข้อความตอบกลับใต้คอมเมนต์"
              hint="ทุกคนที่เห็นโพสต์จะเห็นข้อความนี้"
              enabled={draft.reply_enabled}
              onToggle={(v) => set('reply_enabled', v)}
            >
              <textarea
                value={draft.reply_text ?? ''}
                onChange={(e) => set('reply_text', e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="เช่น ขอบคุณที่สนใจค่ะ แอดมินส่งรายละเอียดไปทางแชทแล้วนะคะ"
                className={`${input} resize-none`}
              />
              <p className="mt-1 text-right text-[11px] text-slate-400">{draft.reply_text?.length ?? 0}/2000</p>
            </ResponseBlock>

            <ResponseBlock
              title="ข้อความส่งเข้าอินบ็อกซ์ (Private Message)"
              hint="Meta ให้ส่งได้ 1 ข้อความต่อคอมเมนต์ จึงเลือกได้ทีละแบบ"
              enabled={draft.inbox_enabled}
              onToggle={(v) => set('inbox_enabled', v)}
            >
              <div role="tablist" className="mb-3 grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm">
                {(['text', 'image'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="tab"
                    aria-selected={draft.inbox_type === t}
                    onClick={() => set('inbox_type', t)}
                    className={`rounded-lg py-1.5 font-medium transition ${draft.inbox_type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
                  >
                    {t === 'text' ? 'ข้อความ' : 'รูปภาพ'}
                  </button>
                ))}
              </div>
              {draft.inbox_type === 'text' ? (
                <textarea
                  value={draft.inbox_text ?? ''}
                  onChange={(e) => set('inbox_text', e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="เช่น สวัสดีค่ะ ราคาสินค้า 590 บาท สั่งซื้อได้ที่แชทนี้เลยค่ะ"
                  className={`${input} resize-none`}
                />
              ) : draft.inbox_image_url ? (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.inbox_image_url} alt="รูปที่จะส่งเข้าอินบ็อกซ์" className="max-h-56 w-full rounded-xl object-contain ring-1 ring-slate-200" />
                  <button
                    type="button"
                    onClick={() => set('inbox_image_url', null)}
                    aria-label="ลบรูป"
                    className="absolute top-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-slate-600 shadow hover:text-red-600"
                  >
                    <Icon d={ICONS.close} className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 transition hover:border-red-300 hover:bg-red-50/40">
                  <Icon d={ICONS.image} className="h-8 w-8 text-slate-400" />
                  {uploading ? 'กำลังอัปโหลด...' : 'คลิกเพื่ออัปโหลดรูปภาพ'}
                  <span className="text-xs text-slate-400">JPG, PNG, GIF ไม่เกิน 8 MB</span>
                  <input
                    type="file"
                    accept={IMAGE_TYPES.join(',')}
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      e.target.value = ''
                      if (file) void upload(file)
                    }}
                    className="sr-only"
                  />
                </label>
              )}
            </ResponseBlock>
          </div>
        </StepCard>
      </div>
    </div>
  )
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? 'bg-emerald-500 text-white' : 'bg-red-50 text-red-600 ring-1 ring-red-200'}`}
    >
      {done ? <Icon d={ICONS.check} className="h-4 w-4" /> : n}
    </span>
  )
}

function StepCard({ n, done, title, desc, children }: { n: number; done: boolean; title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
      <header className="flex items-start gap-3 border-b border-slate-100 p-5">
        <StepBadge n={n} done={done} />
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function ResponseBlock({
  title,
  hint,
  enabled,
  onToggle,
  children,
}: {
  title: string
  hint: string
  enabled: boolean
  onToggle: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <div className={`rounded-xl border p-4 transition ${enabled ? 'border-slate-200 bg-white' : 'border-dashed border-slate-200 bg-slate-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
        <Switch checked={enabled} onChange={onToggle} label={title} />
      </div>
      {enabled && <div className="mt-3">{children}</div>}
    </div>
  )
}

/** Tags on top, input on its own line below. Enter or comma adds, Backspace on an empty field removes the last one. */
export function KeywordInput({ value, onChange, placeholder = 'ตัวอย่างเช่น "สอบถาม" แล้วกด Enter หรือ ,' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const fresh = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !value.includes(s))
    if (fresh.length) onChange([...value, ...new Set(fresh)])
    setText('')
  }
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-red-400 focus-within:ring-2 focus-within:ring-red-500/20">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 p-2">
          {value.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-red-50 py-0.5 pr-1 pl-2.5 text-sm text-red-700 ring-1 ring-red-100">
              {k}
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x !== k))}
                aria-label={`ลบ ${k}`}
                className="rounded-full p-0.5 hover:bg-red-100"
              >
                <Icon d={ICONS.close} className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        value={text}
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add(text)
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1))
          }
        }}
        onBlur={() => text.trim() && add(text)}
        maxLength={100}
        placeholder={placeholder}
        aria-label="เพิ่มคีย์เวิร์ด"
        className="block w-full px-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none"
      />
    </div>
  )
}
