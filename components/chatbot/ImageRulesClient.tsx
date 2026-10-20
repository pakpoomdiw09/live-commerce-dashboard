'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Images, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { IMAGE_RULE_COLUMNS, IMAGE_TRIGGERS, imageRuleError, type ImageResponseRule, type ImageRuleDraft, type ImageTrigger } from '@/lib/features/vision/image-rules'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Field, Notice } from '@/components/ui/field'
import { ImagePicker } from '@/components/ui/ImagePicker'
import { MessengerPreview } from '@/components/chatbot/MessengerPreview'

const orangeButton = 'bg-orange-500 hover:bg-orange-600 focus-visible:outline-orange-500'
const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100'
const empty: ImageRuleDraft = { name: '', trigger_type: 'general', response_text: '', media_url: null, is_active: true, priority: 0 }

function RuleSwitch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-50 ${checked ? 'bg-orange-500' : 'bg-slate-300'}`}><span className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} /></button>
}

export function ImageRulesClient({ tenantId, tenantName, initialRules, canManage }: { tenantId: string; tenantName: string; initialRules: ImageResponseRule[]; canManage: boolean }) {
  const db = useMemo(() => supabaseBrowser(), [])
  const router = useRouter()
  const validRules = (value: unknown): ImageResponseRule[] => Array.isArray(value) ? value.filter(rule => rule && typeof rule.id === 'string' && typeof rule.name === 'string' && Object.hasOwn(IMAGE_TRIGGERS, rule.trigger_type)) : []
  const [rules, setRules] = useState(() => validRules(initialRules))
  const [editing, setEditing] = useState<ImageResponseRule | 'new' | null>(null)
  const [draft, setDraft] = useState<ImageRuleDraft>(empty)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ImageTrigger | 'all'>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  useEffect(() => setRules(validRules(initialRules)), [initialRules])
  const visible = rules.filter(rule => (filter === 'all' || rule.trigger_type === filter) && `${rule.name} ${rule.response_text ?? ''}`.toLocaleLowerCase('th-TH').includes(query.toLocaleLowerCase('th-TH')))
  function open(rule: ImageResponseRule | 'new') {
    setEditing(rule)
    setDraft(rule === 'new' ? { ...empty } : { name: rule.name, trigger_type: rule.trigger_type, response_text: rule.response_text, media_url: rule.media_url, is_active: rule.is_active, priority: rule.priority ?? 0 })
    setNotice(null)
    setUploadError(null)
  }
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canManage || !editing || busy || uploading) return
    const problem = imageRuleError(draft)
    if (problem) return setNotice({ tone: 'error', text: problem })
    setBusy('save'); setNotice(null)
    try {
      const values = { ...draft, name: draft.name.trim(), response_text: draft.response_text?.trim() || null }
      const query = editing === 'new' ? db.from('image_response_rules').insert({ ...values, tenant_id: tenantId }) : db.from('image_response_rules').update(values).eq('id', editing.id).eq('tenant_id', tenantId)
      const { data, error } = await query.select(IMAGE_RULE_COLUMNS).single()
      if (error || !data) throw new Error('บันทึกกฎไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และลองใหม่')
      const saved = data as ImageResponseRule
      setRules(previous => editing === 'new' ? [saved, ...previous] : previous.map(rule => rule.id === saved.id ? saved : rule))
      setEditing(null); setNotice({ tone: 'success', text: 'บันทึกกฎตอบกลับรูปภาพแล้ว' }); router.refresh()
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ' }) }
    finally { setBusy(null) }
  }
  async function toggle(rule: ImageResponseRule, active: boolean) {
    if (!canManage || busy) return
    setBusy(rule.id); setNotice(null)
    try {
      const { data, error } = await db.from('image_response_rules').update({ is_active: active }).eq('id', rule.id).eq('tenant_id', tenantId).select(IMAGE_RULE_COLUMNS).single()
      if (error || !data) throw new Error('เปลี่ยนสถานะไม่สำเร็จ กรุณาลองใหม่')
      setRules(previous => previous.map(item => item.id === rule.id ? data as ImageResponseRule : item))
      setNotice({ tone: 'success', text: `${active ? 'เปิด' : 'ปิด'}กฎ ${rule.name} แล้ว` }); router.refresh()
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'เปลี่ยนสถานะไม่สำเร็จ' }) }
    finally { setBusy(null) }
  }
  async function remove(rule: ImageResponseRule) {
    if (!canManage || busy || !confirm(`ลบกฎ “${rule.name}” หรือไม่?`)) return
    setBusy(rule.id); setNotice(null)
    try {
      const { data, error } = await db.from('image_response_rules').delete().eq('id', rule.id).eq('tenant_id', tenantId).select('id').single()
      if (error || !data) throw new Error('ลบกฎไม่สำเร็จ กรุณาลองใหม่')
      setRules(previous => previous.filter(item => item.id !== rule.id)); setNotice({ tone: 'success', text: 'ลบกฎแล้ว' }); router.refresh()
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'ลบไม่สำเร็จ' }) }
    finally { setBusy(null) }
  }
  return <div className="mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8">
    <PageHeader variant="section" title="ผู้ช่วยตอบรูปภาพ" description={`${tenantName} · จัดการเงื่อนไข ข้อความตอบกลับ และรูปภาพแนบ`} action={canManage && <Button className={orangeButton} onClick={() => open('new')} disabled={!!busy || !!editing}><Plus className="h-4 w-4" />เพิ่มกฎตอบรูปภาพ</Button>} />
    <div className="grid gap-4 sm:grid-cols-3">{(Object.entries(IMAGE_TRIGGERS) as [ImageTrigger, { label: string; description: string }][]).map(([type, trigger]) => <Card key={type} className="border-orange-100 p-5"><p className="text-sm text-slate-500">{trigger.label}</p><p className="mt-2 text-2xl font-semibold text-orange-600">{rules.filter(rule => rule.trigger_type === type).length} <span className="text-sm font-normal text-slate-500">กฎ</span></p><p className="mt-1 text-xs text-slate-500">เปิดอยู่ {rules.filter(rule => rule.trigger_type === type && rule.is_active).length} กฎ</p></Card>)}</div>
    {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    {!canManage && <p className="rounded-xl bg-orange-50 p-4 text-sm text-orange-800">ดูรายการได้ · เฉพาะเจ้าของร้านและผู้ดูแลระบบที่เพิ่มหรือแก้ไขกฎได้</p>}
    {editing && <Card><CardHeader title={editing === 'new' ? 'เพิ่มกฎตอบกลับรูปภาพ' : 'แก้ไขกฎตอบกลับรูปภาพ'} description="เลือกประเภทภาพและกำหนดคำตอบที่ต้องการ" /><form onSubmit={save}><div className="grid gap-6 p-5 lg:grid-cols-2"><fieldset disabled={!!busy} className="space-y-4">
      <Field label="ชื่อกฎ"><input className={input} required maxLength={100} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="เช่น รับรูปสลิปแล้ว" /></Field>
      <Field label="ลำดับความสำคัญ (ตัวเลขสูงทำงานก่อน)" hint="หากเท่ากันจะเลือกตาม ID เพียงกฎเดียว"><input className={input} type="number" min={0} max={1000} step={1} value={draft.priority ?? 0} onChange={event=>setDraft({...draft,priority:Number(event.target.value)})}/></Field>
      <Field label="ประเภทภาพที่ใช้เป็นเงื่อนไข (Trigger Type)"><select className={input} value={draft.trigger_type} onChange={event => setDraft({ ...draft, trigger_type: event.target.value as ImageTrigger })}>{Object.entries(IMAGE_TRIGGERS).map(([value, trigger]) => <option key={value} value={value}>{trigger.label}</option>)}</select></Field>
      <Field label="ข้อความตอบกลับ" hint={`${draft.response_text?.length ?? 0}/2,000 ตัวอักษร`}><textarea className={input} rows={5} maxLength={2000} value={draft.response_text ?? ''} onChange={event => setDraft({ ...draft, response_text: event.target.value })} placeholder="ได้รับรูปภาพแล้วค่ะ แอดมินจะตรวจสอบให้โดยเร็ว" /></Field>
      <div><p className="mb-2 text-sm font-medium text-slate-700">รูปภาพแนบกลับ (ไม่บังคับ)</p><p className="mb-2 text-xs text-slate-500">รูปนี้เป็นสื่อส่งให้ลูกค้าและมีลิงก์สาธารณะ</p><ImagePicker key={editing === 'new' ? 'new' : editing.id} folder={`image-rules/${tenantId}`} value={draft.media_url} onChange={media_url => setDraft(previous => ({ ...previous, media_url }))} onError={setUploadError} onUploadingChange={setUploading} />{uploadError && <p role="alert" className="mt-2 text-sm text-rose-600">{uploadError}</p>}</div>
      <div className="flex items-center justify-between rounded-xl bg-orange-50 p-3"><span className="text-sm font-medium text-orange-900">เปิดใช้งานกฎนี้</span><RuleSwitch checked={draft.is_active} label="เปิดใช้งานกฎที่กำลังแก้ไข" onChange={is_active => setDraft({ ...draft, is_active })} /></div>
    </fieldset><div className="space-y-3"><p className="text-sm font-semibold text-slate-700">ตัวอย่างคำตอบที่ลูกค้าจะได้รับ</p><div className="rounded-2xl border border-orange-100 bg-orange-50/40 p-4"><Badge tone="warning">{IMAGE_TRIGGERS[draft.trigger_type]?.label ?? ''}</Badge><div className="mt-4"><MessengerPreview text={draft.response_text} imageUrl={draft.media_url} /></div></div><p className="text-xs text-slate-500">ใส่ข้อความอย่างเดียว รูปภาพอย่างเดียว หรือทั้งสองอย่างได้</p></div></div><div className="flex justify-end gap-2 border-t border-slate-100 p-5"><Button variant="secondary" onClick={() => setEditing(null)} disabled={!!busy || uploading}>ยกเลิก</Button><Button type="submit" className={orangeButton} loading={busy === 'save'} disabled={uploading}>บันทึกกฎ</Button></div></form></Card>}
    <Card><CardHeader title="กฎตอบกลับรูปภาพ" description={`แสดง ${visible.length} จาก ${rules.length} กฎ${rules.length === 1000 ? 'ล่าสุด (สูงสุด 1,000 กฎ)' : ''}`} /><div className="flex flex-wrap gap-3 border-b border-slate-100 p-5"><div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input aria-label="ค้นหากฎ" className={`${input} pl-9`} value={query} onChange={event => setQuery(event.target.value)} placeholder="ค้นหาชื่อกฎหรือข้อความตอบกลับ" /></div><select aria-label="กรองประเภทภาพ" className={`${input} sm:w-auto`} value={filter} onChange={event => setFilter(event.target.value as ImageTrigger | 'all')}><option value="all">ทุกประเภทภาพ</option>{Object.entries(IMAGE_TRIGGERS).map(([value, trigger]) => <option key={value} value={value}>{trigger.label}</option>)}</select></div>
      {visible.length === 0 ? <div className="flex flex-col items-center gap-3 p-12 text-center"><Images className="h-10 w-10 text-orange-300" /><p className="font-medium text-slate-700">{rules.length ? 'ไม่พบกฎที่ตรงกับการค้นหา' : 'ยังไม่มีกฎตอบรูปภาพ'}</p><p className="text-sm text-slate-500">{rules.length ? 'ลองเปลี่ยนคำค้นหาหรือประเภทภาพ' : 'เพิ่มกฎแรกเพื่อกำหนดข้อความและรูปภาพตอบกลับ'}</p></div> : <ul className="divide-y divide-slate-100">{visible.map(rule => <li key={rule.id} className="space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">{rule.name}</h2><div className="mt-2 flex flex-wrap gap-2"><Badge tone="warning">{IMAGE_TRIGGERS[rule.trigger_type]?.label ?? ''}</Badge><Badge tone={rule.is_active ? 'success' : 'neutral'}>{rule.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</Badge></div></div><div className="flex items-center gap-3"><RuleSwitch checked={rule.is_active} disabled={!canManage || !!busy || !!editing} onChange={value => void toggle(rule, value)} label={`${rule.is_active ? 'ปิด' : 'เปิด'}กฎ ${rule.name}`} />{canManage && <><Button size="sm" variant="secondary" disabled={!!busy || !!editing} onClick={() => open(rule)}><Pencil className="h-3.5 w-3.5" />แก้ไข</Button><Button size="sm" variant="ghost" className="text-rose-600 hover:text-rose-700" disabled={!!busy || !!editing} onClick={() => void remove(rule)} aria-label={`ลบกฎ ${rule.name}`}><Trash2 className="h-4 w-4" /></Button></>}</div></div><MessengerPreview text={rule.response_text} imageUrl={rule.media_url} /></li>)}</ul>}
    </Card>
  </div>
}
