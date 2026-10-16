'use client'

import { useMemo, useState } from 'react'
import { Image as ImageIcon, MessageSquareText, Plus, X } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { ruleMatches } from '@/lib/comment-rules'
import { CHAT_RULE_COLUMNS, QUICK_REPLY_MAX, QUICK_REPLY_TITLE_MAX, type ChatRule } from '@/lib/chatbot'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, Notice, inputClass } from '@/components/ui/field'
import { Switch } from '@/components/ui/Switch'
import { ImagePicker } from '@/components/ui/ImagePicker'
import { KeywordInput } from '@/components/comment-rules/RuleEditor'
import { MessengerPreview } from './MessengerPreview'

type Draft = Pick<ChatRule, 'name' | 'match_type' | 'keywords' | 'reply_type' | 'reply_text' | 'image_url' | 'quick_replies' | 'priority' | 'is_active'>

const EMPTY: Draft = {
  name: '',
  match_type: 'keyword',
  keywords: [],
  reply_type: 'text',
  reply_text: '',
  image_url: null,
  quick_replies: [],
  priority: 0,
  is_active: true,
}

const SUGGESTIONS = ['ราคา', 'ค่าส่ง', 'สั่งซื้อ', 'โปรโมชัน', 'ไซซ์']

/** Create or edit one keyword auto-reply. */
export function ChatRuleForm({ tenantId, rule, onCancel, onSaved }: { tenantId: string; rule: ChatRule | null; onCancel: () => void; onSaved: (r: ChatRule) => void }) {
  const db = useMemo(() => supabaseBrowser(), [])
  // only the editable columns: hit_count etc. must not be written back from a stale copy
  const [draft, setDraft] = useState<Draft>(() =>
    rule
      ? (Object.fromEntries((Object.keys(EMPTY) as (keyof Draft)[]).map((k) => [k, rule[k]])) as Draft)
      : EMPTY,
  )
  const [qr, setQr] = useState('')
  const [sample, setSample] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }))

  const problems = [
    !draft.name.trim() && 'ตั้งชื่อคำตอบ',
    !draft.keywords.length && 'เพิ่มคีย์เวิร์ดอย่างน้อย 1 คำ',
    draft.reply_type === 'text' && !draft.reply_text?.trim() && 'ใส่ข้อความตอบกลับ',
    draft.reply_type === 'image' && !draft.image_url && 'อัปโหลดรูปภาพ',
  ].filter((p): p is string => !!p)

  function addQuickReply() {
    const t = qr.trim()
    if (!t || draft.quick_replies.includes(t) || draft.quick_replies.length >= QUICK_REPLY_MAX) return
    set('quick_replies', [...draft.quick_replies, t])
    setQr('')
  }

  async function save() {
    if (problems.length) return setError(`ยังขาด: ${problems.join(' · ')}`)
    setSaving(true)
    setError(null)
    const row = {
      ...draft,
      tenant_id: tenantId,
      name: draft.name.trim(),
      reply_text: draft.reply_text?.trim() || null,
      image_url: draft.reply_type === 'image' ? draft.image_url : null,
      priority: Math.max(-100, Math.min(100, Math.round(Number(draft.priority) || 0))),
    }
    const q = rule ? db.from('chat_rules').update(row).eq('id', rule.id) : db.from('chat_rules').insert(row)
    const { data, error: saveError } = await q.select(CHAT_RULE_COLUMNS).single()
    setSaving(false)
    if (saveError || !data) return setError(`บันทึกไม่สำเร็จ: ${saveError?.message ?? 'ไม่มีข้อมูลตอบกลับ'}`)
    onSaved(data as ChatRule)
  }

  return (
    <Card>
      <CardHeader
        title={rule ? 'แก้ไขคำตอบอัตโนมัติ' : 'เพิ่มคำตอบอัตโนมัติ'}
        description="ตอบในแชท Messenger เมื่อข้อความของลูกค้าตรงกับคีย์เวิร์ด"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              ยกเลิก
            </Button>
            <Button size="sm" onClick={save} loading={saving}>
              บันทึก
            </Button>
          </div>
        }
      />
      <div className="grid gap-6 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          {error && <Notice tone="error">{error}</Notice>}
          <div className="flex items-end gap-3">
            <Field label="ชื่อคำตอบ" className="flex-1">
              <input value={draft.name} onChange={(e) => set('name', e.target.value)} maxLength={100} placeholder="เช่น ตอบคนถามราคา" className={inputClass} />
            </Field>
            <Field label="ลำดับ" hint="สูง = ลองก่อน">
              <input
                type="number"
                min={-100}
                max={100}
                value={draft.priority}
                onChange={(e) => set('priority', Number(e.target.value))}
                className={cn(inputClass, 'w-20')}
              />
            </Field>
          </div>

          <div role="radiogroup" aria-label="รูปแบบการตรวจจับ" className="grid grid-cols-2 gap-2">
            {(
              [
                ['keyword', 'มีคีย์เวิร์ด', 'ข้อความมีคำนี้อยู่'],
                ['exact', 'ทั้งประโยค', 'ข้อความตรงทุกตัวอักษร'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className="cursor-pointer rounded-lg border border-slate-200 p-3 transition hover:bg-slate-50 has-checked:border-orange-300 has-checked:bg-orange-50/60"
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <input type="radio" name="match_type" checked={draft.match_type === value} onChange={() => set('match_type', value)} className="accent-orange-500" />
                  {label}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
              </label>
            ))}
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">คีย์เวิร์ด</span>
            <KeywordInput value={draft.keywords} onChange={(v) => set('keywords', v)} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {SUGGESTIONS.filter((s) => !draft.keywords.includes(s)).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set('keywords', [...draft.keywords, s])}
                  className="rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-600 hover:border-orange-300 hover:text-orange-600"
                >
                  + {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div role="tablist" aria-label="ประเภทคำตอบ" className="mb-3 grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-sm">
              {(
                [
                  ['text', 'ข้อความ', MessageSquareText],
                  ['image', 'รูปภาพ', ImageIcon],
                ] as const
              ).map(([t, label, Icon]) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={draft.reply_type === t}
                  onClick={() => set('reply_type', t)}
                  className={cn(
                    'flex items-center justify-center gap-1.5 rounded-md py-1.5 font-medium transition',
                    draft.reply_type === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </button>
              ))}
            </div>
            {draft.reply_type === 'image' && (
              <div className="mb-3">
                <ImagePicker value={draft.image_url} onChange={(url) => set('image_url', url)} folder="chat-rules" onError={setError} />
              </div>
            )}
            <Field label={draft.reply_type === 'image' ? 'ข้อความก่อนรูป (ไม่บังคับ)' : 'ข้อความตอบกลับ'}>
              <textarea
                rows={4}
                maxLength={2000}
                value={draft.reply_text ?? ''}
                onChange={(e) => set('reply_text', e.target.value)}
                placeholder="เช่น ราคา 590 บาทค่ะ สั่งซื้อพิมพ์ CF ตามด้วยรหัสสินค้าได้เลยนะคะ"
                className={cn(inputClass, 'resize-none')}
              />
            </Field>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-medium text-slate-700">
              ปุ่ม Quick Reply <span className="font-normal text-slate-400">({draft.quick_replies.length}/{QUICK_REPLY_MAX})</span>
            </span>
            <div className="flex gap-2">
              <input
                value={qr}
                onChange={(e) => setQr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    addQuickReply()
                  }
                }}
                maxLength={QUICK_REPLY_TITLE_MAX}
                placeholder={`ข้อความบนปุ่ม (ไม่เกิน ${QUICK_REPLY_TITLE_MAX} ตัวอักษร)`}
                className={inputClass}
                aria-label="เพิ่มปุ่ม Quick Reply"
              />
              <Button variant="secondary" onClick={addQuickReply} disabled={!qr.trim() || draft.quick_replies.length >= QUICK_REPLY_MAX}>
                <Plus className="h-4 w-4" aria-hidden />
                เพิ่ม
              </Button>
            </div>
            {draft.quick_replies.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {draft.quick_replies.map((q) => (
                  <span key={q} className="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pr-1 pl-2.5 text-xs text-blue-700 ring-1 ring-blue-100">
                    {q}
                    <button type="button" onClick={() => set('quick_replies', draft.quick_replies.filter((x) => x !== q))} aria-label={`ลบปุ่ม ${q}`} className="rounded-full p-0.5 hover:bg-blue-100">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-slate-500">ลูกค้ากดปุ่มแล้วระบบจะได้ข้อความบนปุ่ม จึงตั้งคำตอบอื่นให้ตรงกับปุ่มได้ เช่น ปุ่ม “คุยกับแอดมิน”</p>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <span className="text-sm text-slate-700">เปิดใช้งานคำตอบนี้</span>
            <Switch checked={draft.is_active} onChange={(v) => set('is_active', v)} label="เปิดใช้งานคำตอบนี้" />
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium text-slate-700">ตัวอย่างใน Messenger</p>
            <MessengerPreview text={draft.reply_text} imageUrl={draft.reply_type === 'image' ? draft.image_url : null} quickReplies={draft.quick_replies} />
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <Field label="ลองพิมพ์ข้อความลูกค้า">
              <input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="เช่น ราคาเท่าไหร่คะ" className={inputClass} />
            </Field>
            {sample.trim() && (
              <p className={cn('mt-2 text-xs font-medium', ruleMatches(draft, sample) ? 'text-emerald-600' : 'text-slate-500')}>
                {ruleMatches(draft, sample) ? '✓ ตรงเงื่อนไข: ระบบจะตอบด้วยคำตอบนี้' : '✗ ไม่ตรงเงื่อนไข'}
              </p>
            )}
          </div>
        </div>
      </div>
    </Card>
  )
}
