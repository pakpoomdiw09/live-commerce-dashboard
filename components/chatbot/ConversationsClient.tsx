'use client'

import { FeatureLocked } from '@/components/FeatureLocked'
import {AutomationEmergencyStop} from './AutomationEmergencyStop'
import { LockKeyhole } from 'lucide-react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CircleCheck,
  Hand,
  ListChecks,
  MessageSquareText,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { DEFAULT_FALLBACK_MESSAGE, DEFAULT_HANDOVER_MESSAGE, fallbackMessages, handoverMessages, MAX_FALLBACK_MESSAGES } from '@/lib/fallback-messages'
import { DEFAULT_AI_INSTRUCTIONS, ruleOrder, type BotSettings, type ChatRule, type ReplyMode } from '@/lib/chatbot'
import { cn, customerName, when } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Field, IconTile, Notice, inputClass } from '@/components/ui/field'
import { Switch } from '@/components/ui/Switch'
import { KeywordInput } from '@/components/comment-rules/RuleEditor'
import { ChatRuleForm } from './ChatRuleForm'
import { BotPlayground } from './BotPlayground'

export type HandedOver = { id: string; display_name: string | null; platform_user_id: string; handover_at: string; conversation_version?:number }

type Props = {
  hidePlayground?: boolean
  aiAllowed: boolean
  tenantId: string
  tenantBotOn: boolean
  aiReady: boolean
  initialSettings: BotSettings
  initialRules: ChatRule[]
  handedOver: HandedOver[]
}

const MODES: { value: ReplyMode; label: string; icon: LucideIcon; desc: string }[] = [
  { value: 'keyword', label: 'ตอบตามคีย์เวิร์ด', icon: ListChecks, desc: 'ตอบตามคีย์เวิร์ดที่ตั้งไว้ คาดเดาได้ 100% เหมาะกับคำถามซ้ำ ๆ' },
  { value: 'ai', label: 'ผู้ช่วย AI', icon: Sparkles, desc: 'AI อ่านแชทแล้วตอบเองจากข้อมูลร้านและรายการสินค้า' },
]

export function ConversationsClient({ tenantId, tenantBotOn, aiReady, aiAllowed, initialSettings, initialRules, handedOver, hidePlayground=false }: Props) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const [draftSettings, setSettings] = useState(() => ({ ...initialSettings, ai_instructions: initialSettings.ai_instructions?.trim() ? initialSettings.ai_instructions : DEFAULT_AI_INSTRUCTIONS, fallback_messages: fallbackMessages(initialSettings), handover_messages: handoverMessages(initialSettings) }))
  const settings = !aiAllowed && draftSettings.reply_mode === 'ai' ? { ...draftSettings, reply_mode: 'keyword' as const } : draftSettings
  const [rules, setRules] = useState(initialRules)
  const [editing, setEditing] = useState<ChatRule | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [released, setReleased] = useState<string[]>([])

  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K]) => setSettings((s) => ({ ...s, [k]: v }))

  async function saveSettings() {
    setSaving(true)
    setNotice(null)
    const { error } = await db.from('bot_settings').upsert({
      tenant_id: tenantId,
      reply_mode: settings.reply_mode,
      ...(aiAllowed ? { ai_instructions: settings.ai_instructions?.trim() || null } : {}),
      fallback_text: fallbackMessages(settings)[0] ?? null,
      fallback_messages: fallbackMessages(settings),
      handover_keywords: settings.handover_keywords,
      handover_text: handoverMessages(settings)[0] ?? null,
      handover_messages: handoverMessages(settings),
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    setNotice(error ? { tone: 'error', text: `บันทึกไม่สำเร็จ: ${error.message}` } : { tone: 'success', text: 'บันทึกการตั้งค่าแล้ว มีผลกับข้อความถัดไปทันที' })
    if (!error) router.refresh()
  }

  async function toggleRule(rule: ChatRule, is_active: boolean) {
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, is_active } : r)))
    const { error } = await db.from('chat_rules').update({ is_active }).eq('id', rule.id)
    if (error) {
      setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, is_active: !is_active } : r)))
      setNotice({ tone: 'error', text: `เปลี่ยนสถานะไม่สำเร็จ: ${error.message}` })
    }
  }

  async function deleteRule(rule: ChatRule) {
    if (!confirm(`ลบคำตอบ "${rule.name}"?`)) return
    const { error } = await db.from('chat_rules').delete().eq('id', rule.id)
    if (error) return setNotice({ tone: 'error', text: `ลบไม่สำเร็จ: ${error.message}` })
    setRules((rs) => rs.filter((r) => r.id !== rule.id))
  }

  async function release(c: HandedOver) {
    try {
      const response=await fetch(`/api/inbox/conversations/${c.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'bot',version:c.conversation_version??0})})
      const body=await response.json()
      if(!response.ok)throw new Error(body.error??'เปิดบอทไม่สำเร็จ กรุณาโหลดข้อมูลใหม่')
      setReleased((r) => [...r, c.id]);router.refresh()
    }catch(error){setNotice({tone:'error',text:error instanceof Error?error.message:'เปิดบอทไม่สำเร็จ'})}
  }

  const waiting = handedOver.filter((c) => !released.includes(c.id))

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 md:p-8">
      {!hidePlayground&&<AutomationEmergencyStop tenantId={tenantId}/>}
      <PageHeader
        title="ผู้ช่วยตอบบทสนทนา"
        description="ตั้งค่าการตอบแชท Messenger อัตโนมัติ: คีย์เวิร์ด, AI Agent และการส่งต่อให้แอดมิน"
        action={
          <Button onClick={saveSettings} loading={saving}>
            บันทึกการตั้งค่า
          </Button>
        }
      />

      {!tenantBotOn && (
        <Notice tone="error">
          บอทตอบอัตโนมัติของร้านปิดอยู่ ข้อความจะไม่ถูกตอบจนกว่าจะเปิดสวิตช์บอทที่แถบเมนูหรือหน้า <Link href="/settings" className="font-medium underline">ตั้งค่า</Link>
        </Notice>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {!aiAllowed && <FeatureLocked />}
      {/* mode */}
      <div role="radiogroup" aria-label="โหมดการตอบ" className="grid gap-3 sm:grid-cols-2">
        {MODES.map((m) => {
          const active = settings.reply_mode === m.value
          const locked = m.value === 'ai' && !aiAllowed
          return (
            <label
              key={m.value}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 shadow-sm transition',
                active ? 'border-orange-300 ring-2 ring-orange-500/15' : 'border-slate-200 hover:border-slate-300',
              )}
            >
              <input type="radio" name="reply_mode" checked={active} disabled={locked} onChange={() => { if (!locked) set('reply_mode', m.value) }} className="sr-only" />
              <IconTile className={active ? 'from-orange-500 to-pink-500 text-white' : undefined}>
                <m.icon className="h-4 w-4" aria-hidden />
              </IconTile>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  {m.label}{locked && <LockKeyhole className="h-4 w-4 text-orange-500" aria-label="ยังไม่เปิดใช้งาน" />}
                  {active && <Badge tone="success">ใช้งานอยู่</Badge>}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{m.desc}</span>
              </span>
            </label>
          )
        })}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          {settings.reply_mode === 'keyword' ? (
            editing ? (
              <ChatRuleForm
                tenantId={tenantId}
                rule={editing === 'new' ? null : editing}
                onCancel={() => setEditing(null)}
                onSaved={(saved) => {
                  setRules((rs) => [...rs.filter((r) => r.id !== saved.id), saved].sort(ruleOrder))
                  setEditing(null)
                }}
              />
            ) : (
              <Card>
                <CardHeader
                  title="คำตอบตามคีย์เวิร์ด"
                  description="ระบบลองกฎจากลำดับความสำคัญสูงไปต่ำ และตอบด้วยกฎแรกที่ตรง"
                  action={
                    <Button size="sm" onClick={() => setEditing('new')}>
                      <Plus className="h-4 w-4" aria-hidden />
                      เพิ่มคำตอบ
                    </Button>
                  }
                />
                {rules.length === 0 ? (
                  <div className="grid place-items-center px-6 py-12 text-center">
                    <IconTile className="h-12 w-12">
                      <MessageSquareText className="h-6 w-6" aria-hidden />
                    </IconTile>
                    <p className="mt-3 text-sm font-medium text-slate-900">ยังไม่มีคำตอบอัตโนมัติ</p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500">เริ่มจากคำถามที่ลูกค้าถามบ่อย เช่น ราคา ค่าส่ง วิธีสั่งซื้อ</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {rules.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                        <Switch checked={r.is_active} onChange={(v) => toggleRule(r, v)} label={`เปิดใช้ ${r.name}`} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                            <span className="truncate">{r.name}</span>
                            {r.reply_type === 'image' && <Badge icon={false}>รูปภาพ</Badge>}
                            {r.quick_replies.length > 0 && <Badge icon={false}>{r.quick_replies.length} ปุ่ม</Badge>}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {r.match_type === 'exact' ? 'ทั้งประโยค' : 'คีย์เวิร์ด'}: {r.keywords.join(', ')}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 tabular-nums" title="จำนวนครั้งที่ตอบ">
                          ตอบแล้ว {r.hit_count.toLocaleString('th-TH')} ครั้ง
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => setEditing(r)} aria-label={`แก้ไข ${r.name}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteRule(r)} aria-label={`ลบ ${r.name}`} className="hover:text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          ) : (
            <Card>
              <CardHeader title="ผู้ช่วย AI" description="AI ตอบจากข้อมูลด้านล่าง + รายการสินค้าในเมนูร้านค้า (ราคาและสต็อกล่าสุด)" />
              <div className="space-y-4 p-5">
                {!aiReady && (
                  <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      ยังไม่ได้ตั้งค่า API Key สำหรับ AI บนเซิร์ฟเวอร์ ระหว่างนี้บอทจะตอบด้วยข้อความสำรองแทน
                    </span>
                  </p>
                )}
                <Field label="ข้อมูลร้านและคำสั่งสำหรับ AI" hint="เขียนเหมือนบรีฟพนักงานใหม่: ค่าส่ง เวลาจัดส่ง นโยบายเปลี่ยนคืน โปรโมชัน น้ำเสียงที่ต้องการ">
                  <textarea
                    rows={10}
                    maxLength={8000}
                    value={settings.ai_instructions ?? ''}
                    onChange={(e) => set('ai_instructions', e.target.value)}
                    placeholder={DEFAULT_AI_INSTRUCTIONS}
                    className={cn(inputClass, 'resize-y')}
                  />
                </Field>
                <ul className="grid gap-2 text-xs text-slate-600 sm:grid-cols-3">
                  {[
                    'AI ไม่แต่งราคา ส่วนลด หรือเลขบัญชีเอง: ถ้าไม่มีข้อมูลจะบอกว่าแอดมินจะยืนยันให้',
                    'ลูกค้าขอคุยกับคน ไม่พอใจ หรือขอคืนเงิน: AI ส่งต่อให้แอดมินอัตโนมัติ',
                    'การสั่งซื้อ (พิมพ์รหัส CF) และการตรวจสลิปยังทำงานตามระบบเดิม',
                  ].map((t) => (
                    <li key={t} className="flex gap-1.5 rounded-lg bg-slate-50 p-2.5">
                      <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="ข้อความสำรอง"
              description="ระบบสุ่มเลือกหนึ่งข้อความเมื่อ AI ตอบไม่ได้หรือไม่มีคีย์เวิร์ดตรง เพิ่มได้สูงสุด 20 ข้อความ"
            />
            <div className="space-y-3 p-5">
              {settings.fallback_messages.map((text, index) => (
                <div key={index} className="flex items-start gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-xs text-slate-500">ข้อความสำรอง {index + 1}</span>
                    <textarea rows={3} maxLength={2000} value={text} placeholder={DEFAULT_FALLBACK_MESSAGE}
                      onChange={event => set('fallback_messages', settings.fallback_messages.map((message, i) => i === index ? event.target.value : message))}
                      className={cn(inputClass, 'resize-none')} />
                  </label>
                  <Button size="icon" variant="ghost" className="mt-5 text-rose-500" aria-label={`ลบข้อความสำรอง ${index + 1}`}
                    onClick={() => set('fallback_messages', settings.fallback_messages.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>
              ))}
              <Button variant="secondary" disabled={settings.fallback_messages.length >= MAX_FALLBACK_MESSAGES}
                onClick={() => set('fallback_messages', [...settings.fallback_messages, ''])}><Plus className="h-4 w-4" aria-hidden />เพิ่มข้อความสำรอง</Button>
              <p className="text-xs text-slate-500">หากยังไม่มีข้อความ ระบบจะตอบว่า “{DEFAULT_FALLBACK_MESSAGE}”</p>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {!hidePlayground&&<BotPlayground key={tenantId} tenantId={tenantId} settings={settings} />}

          <Card>
            <CardHeader title="ส่งต่อให้แอดมิน (หยุดบอทชั่วคราว)" description="เมื่อลูกค้าพิมพ์คำเหล่านี้ ระบบจะหยุดการตอบอัตโนมัติทันที เพื่อให้แอดมินเข้ามารับช่วงต่อ" />
            <div className="space-y-4 p-5">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-slate-700">คำที่ใช้ขอคุยกับแอดมิน</span>
                <KeywordInput value={settings.handover_keywords} onChange={(v) => set('handover_keywords', v)} placeholder="ตัวอย่าง: ขอคุยกับคน, ติดต่อเจ้าหน้าที่" />
                <p className="mt-2 text-xs text-slate-500">พิมพ์คำที่ต้องการแล้วกด Enter หรือเครื่องหมายจุลภาค (,) เช่น ขอคุยกับคน, ติดต่อเจ้าหน้าที่</p>
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium text-slate-700">ข้อความแจ้งลูกค้าเมื่อย้ายสายหาแอดมิน</p>
                <p className="text-xs text-slate-500">ระบบสุ่มส่งหนึ่งข้อความเมื่อส่งต่อให้แอดมิน เพิ่มได้สูงสุด 20 ข้อความ</p>
                {settings.handover_messages.map((text, index) => <div key={index} className="flex items-start gap-2">
                  <label className="min-w-0 flex-1"><span className="mb-1 block text-xs text-slate-500">ข้อความแจ้งลูกค้า {index + 1}</span>
                    <textarea rows={2} maxLength={2000} value={text} placeholder={DEFAULT_HANDOVER_MESSAGE}
                      onChange={event => set('handover_messages', settings.handover_messages.map((message, i) => i === index ? event.target.value : message))}
                      className={cn(inputClass, 'resize-none')} />
                  </label>
                  <Button size="icon" variant="ghost" className="mt-5 text-rose-500" aria-label={`ลบข้อความแจ้งลูกค้า ${index + 1}`}
                    onClick={() => set('handover_messages', settings.handover_messages.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                </div>)}
                <Button variant="secondary" disabled={settings.handover_messages.length >= MAX_FALLBACK_MESSAGES}
                  onClick={() => set('handover_messages', [...settings.handover_messages, ''])}><Plus className="h-4 w-4" aria-hidden />เพิ่มข้อความแจ้งลูกค้า</Button>
                <p className="text-xs text-slate-500">หากไม่มีข้อความ ระบบจะใช้ “{DEFAULT_HANDOVER_MESSAGE}”</p>
              </div>
            </div>
            <div className="border-t border-slate-100 p-5">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Hand className="h-4 w-4 text-orange-500" aria-hidden />
                รายการแชทที่รอแอดมินดูแล ({waiting.length})
              </p>
              {waiting.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">ไม่มีแชทที่รอแอดมิน</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {waiting.map((c) => (
                    <li key={c.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                      <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <Link href={`/inbox?customer=${c.id}`} className="block truncate text-sm font-medium text-slate-800 hover:underline">
                          {customerName(c)}
                        </Link>
                        <span className="block text-[11px] text-slate-400" suppressHydrationWarning>
                          ขอแอดมินเมื่อ {when(c.handover_at)}
                        </span>
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => release(c)}>
                        <Bot className="h-3.5 w-3.5" aria-hidden />
                        เปิดบอท
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
