'use client'

import { FeatureLocked } from '@/components/shared/FeatureLocked'

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
  Sparkles,
  type LucideIcon,
  Plus,
  Trash2,
  UserRound,
} from 'lucide-react'
import { supabaseBrowser } from '@/lib/supabase/browser'
import { parseStoreRules } from '@/lib/features/store-rules/store-rule-items'
import {
  DEFAULT_HANDOVER_MESSAGE,
  handoverMessages,
  MAX_FALLBACK_MESSAGES,
} from '@/lib/features/agents/fallback-messages'
import {
  DEFAULT_AI_INSTRUCTIONS,
  ruleOrder,
  type BotSettings,
  type ChatRule,
  type ReplyMode,
} from '@/lib/features/agents/chatbot'
import { cn, customerName, when } from '@/lib/utils'
import { Button } from '@/components/ui/button'

import { Card, CardHeader, PageHeader } from '@/components/ui/card'
import { Field, IconTile, Notice, inputClass } from '@/components/ui/field'

import { KeywordInput } from '@/components/comment-rules/RuleEditor'

import { LockKeyhole } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/Switch'
import { ChatRuleForm } from '@/components/chatbot/ChatRuleForm'
import { AiTestingStudio } from '@/components/chatbot/AiTestingStudio'
import type { TenantAiQuota } from '@/lib/features/agents/tenant-ai-quota-types'

export type HandedOver = {
  id: string
  display_name: string | null
  platform_user_id: string
  handover_at: string
  conversation_version?: number
}

type Props = {
  aiQuota?: TenantAiQuota | null
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
  {
    value: 'keyword',
    label: 'ตอบตามคีย์เวิร์ด',
    icon: ListChecks,
    desc: 'ตอบตามคีย์เวิร์ดที่ตั้งไว้ คาดเดาได้ 100% เหมาะกับคำถามซ้ำ ๆ',
  },
  {
    value: 'ai',
    label: 'ผู้ช่วย AI',
    icon: Sparkles,
    desc: 'AI จะอ่านข้อมูลร้านค้า รายการสินค้า และข้อความที่บันทึกไว้ทั้งหมดเป็นคลังความรู้ เพื่อตอบคำถามลูกค้าอย่างฉลาดและเป็นธรรมชาติ พร้อมส่งต่อให้แอดมินทันทีเมื่อข้อมูลไม่เพียงพอ',
  },
]

export function ConversationsClient({
  tenantId,
  tenantBotOn,
  aiReady,
  aiAllowed,
  initialSettings,
  initialRules,
  handedOver,
  hidePlayground = false,
  aiQuota,
}: Props) {
  const router = useRouter()
  const db = useMemo(() => supabaseBrowser(), [])
  const [draftSettings, setSettings] = useState(() => ({
    ...initialSettings,
    ai_instructions: initialSettings.ai_instructions ?? '',
    handover_messages: handoverMessages(initialSettings),
  }))
  const settings =
    !aiAllowed && draftSettings.reply_mode === 'ai'
      ? { ...draftSettings, reply_mode: 'keyword' as const }
      : draftSettings
  const quotaPercent =
    aiQuota && aiQuota.limit === 0
      ? 100
      : aiQuota
        ? Math.min(100, Math.round((aiQuota.used / aiQuota.limit) * 100))
        : 0
  const quotaNearEmpty =
    !!aiQuota &&
    aiQuota.remaining > 0 &&
    aiQuota.limit > 0 &&
    aiQuota.remaining / aiQuota.limit <= 0.1
  const [rules, setRules] = useState(initialRules)
  const [editing, setEditing] = useState<ChatRule | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null)
  const [released, setReleased] = useState<string[]>([])

  const set = <K extends keyof BotSettings>(k: K, v: BotSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }))

  async function saveSettings() {
    if (aiAllowed && !hidePlayground) {
      const rules = parseStoreRules(settings.ai_instructions)
      if (!rules.ok) {
        setNotice({ tone: 'error', text: rules.issues[0].message })
        return
      }
    }
    setSaving(true)
    setNotice(null)
    const { error } = await db.from('bot_settings').upsert({
      tenant_id: tenantId,
      reply_mode: settings.reply_mode,
      ...(aiAllowed && !hidePlayground
        ? { ai_instructions: settings.ai_instructions?.trim() || null }
        : {}),
      handover_keywords: settings.handover_keywords,
      handover_text: handoverMessages(settings)[0] ?? null,
      handover_messages: handoverMessages(settings),
      updated_at: new Date().toISOString(),
    })
    setSaving(false)
    setNotice(
      error
        ? { tone: 'error', text: `บันทึกไม่สำเร็จ: ${error.message}` }
        : { tone: 'success', text: 'บันทึกการตั้งค่าแล้ว มีผลกับข้อความถัดไปทันที' },
    )
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
      const response = await fetch(`/api/inbox/conversations/${c.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bot', version: c.conversation_version ?? 0 }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error ?? 'เปิดบอทไม่สำเร็จ กรุณาโหลดข้อมูลใหม่')
      setReleased((r) => [...r, c.id])
      router.refresh()
    } catch (error) {
      setNotice({
        tone: 'error',
        text: error instanceof Error ? error.message : 'เปิดบอทไม่สำเร็จ',
      })
    }
  }

  const waiting = handedOver.filter((c) => !released.includes(c.id))

  return (
    <div
      className={
        hidePlayground
          ? 'w-full min-w-0 space-y-6'
          : 'mx-0 w-full min-w-0 max-w-none space-y-6 p-4 md:p-8'
      }
    >
      <PageHeader
        variant={hidePlayground ? 'section' : 'page'}
        title="ผู้ช่วยตอบบทสนทนา"
        description="ผู้ช่วย AI ตอบจากข้อมูลร้าน สินค้า และข้อความที่บันทึกไว้ พร้อมส่งต่อแอดมินเมื่อข้อมูลไม่เพียงพอ"
        action={
          <Button onClick={saveSettings} loading={saving}>
            บันทึกการตั้งค่า
          </Button>
        }
      />

      {aiQuota && (
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="border-orange-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-700">โควตาข้อความ AI</p>
              <span
                className={
                  aiQuota.remaining === 0
                    ? 'rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600'
                    : quotaNearEmpty
                      ? 'rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-orange-700'
                      : 'rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700'
                }
              >
                {aiQuota.remaining === 0
                  ? 'โควตาหมด'
                  : quotaNearEmpty
                    ? 'โควตาใกล้หมด'
                    : 'พร้อมใช้งาน'}
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums text-slate-900">
                {aiQuota.remaining.toLocaleString('th-TH')}
              </span>
              <span className="text-xs text-slate-500">
                คงเหลือจาก {aiQuota.limit.toLocaleString('th-TH')} โควตา
              </span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="การใช้โควตา AI"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={quotaPercent}
            >
              <div
                className="h-full rounded-full bg-orange-500 transition-[width] duration-300"
                style={{ width: `${quotaPercent}%` }}
              />
            </div>
            <div className="mt-1 flex justify-end text-xs text-slate-500">
              {quotaPercent}% ใช้แล้ว
            </div>
            {aiQuota.remaining === 0 && (
              <p className="mt-1 text-xs text-amber-700">
                แชทที่ต้องใช้ AI จะส่งเข้า Inbox ของแอดมิน
              </p>
            )}
          </Card>
          <Card className="flex flex-col justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-medium text-slate-500">ใช้โควตา AI แล้ว</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
                {aiQuota.used.toLocaleString('th-TH')}
                <span className="ml-1 text-xs font-normal text-slate-500">ครั้ง</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                รวมคำตอบจริงและการทดลอง · ไม่มีการรีเซ็ตอัตโนมัติ
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => router.refresh()}>
                อัปเดต
              </Button>
              <Link
                href="/billing"
                className="inline-flex h-8 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                เติมโควตา
              </Link>
            </div>
          </Card>
        </div>
      )}
      {!tenantBotOn && (
        <Notice tone="error">
          บอทตอบอัตโนมัติของร้านปิดอยู่ ข้อความจะไม่ถูกตอบจนกว่าจะเปิดสวิตช์บอทที่แถบเมนูหรือหน้า{' '}
          <Link href="/settings" className="font-medium underline">
            ตั้งค่า
          </Link>
        </Notice>
      )}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}

      {!aiAllowed && <FeatureLocked />}
      <div className="space-y-6">
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
                  active
                    ? 'border-orange-300 ring-2 ring-orange-500/15'
                    : 'border-slate-200 hover:border-slate-300',
                )}
              >
                <input
                  type="radio"
                  name="reply_mode"
                  checked={active}
                  disabled={locked}
                  onChange={() => {
                    if (!locked) set('reply_mode', m.value)
                  }}
                  className="sr-only"
                />
                <IconTile className={active ? 'from-orange-500 to-pink-500 text-white' : undefined}>
                  <m.icon className="h-4 w-4" aria-hidden />
                </IconTile>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    {m.label}
                    {locked && (
                      <LockKeyhole
                        className="h-4 w-4 text-orange-500"
                        aria-label="ยังไม่เปิดใช้งาน"
                      />
                    )}
                    {active && <Badge tone="success">ใช้งานอยู่</Badge>}
                  </span>
                  <span className="mt-1.5 block text-xs leading-6 text-slate-500">{m.desc}</span>
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
                    setRules((rs) =>
                      [...rs.filter((r) => r.id !== saved.id), saved].sort(ruleOrder),
                    )
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
                      <p className="mt-3 text-sm font-medium text-slate-900">
                        ยังไม่มีคำตอบอัตโนมัติ
                      </p>
                      <p className="mt-1 max-w-sm text-xs text-slate-500">
                        เริ่มจากคำถามที่ลูกค้าถามบ่อย เช่น ราคา ค่าส่ง วิธีสั่งซื้อ
                      </p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {rules.map((r) => (
                        <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                          <Switch
                            checked={r.is_active}
                            onChange={(v) => toggleRule(r, v)}
                            label={`เปิดใช้ ${r.name}`}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
                              <span className="truncate">{r.name}</span>
                              {r.reply_type === 'image' && <Badge icon={false}>รูปภาพ</Badge>}
                              {r.quick_replies.length > 0 && (
                                <Badge icon={false}>{r.quick_replies.length} ปุ่ม</Badge>
                              )}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-slate-500">
                              {r.match_type === 'exact' ? 'ทั้งประโยค' : 'คีย์เวิร์ด'}:{' '}
                              {r.keywords.join(', ')}
                            </p>
                          </div>
                          <span
                            className="text-xs text-slate-400 tabular-nums"
                            title="จำนวนครั้งที่ตอบ"
                          >
                            ตอบแล้ว {r.hit_count.toLocaleString('th-TH')} ครั้ง
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditing(r)}
                            aria-label={`แก้ไข ${r.name}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteRule(r)}
                            aria-label={`ลบ ${r.name}`}
                            className="hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )
            ) : hidePlayground ? (
              <p className="rounded-2xl border border-orange-100 bg-orange-50/50 p-4 text-sm text-orange-900">
                จัดการเงื่อนไขและแนวทางตอบลูกค้าได้ที่แท็บ “กฎของทางร้าน”
              </p>
            ) : (
              <Card>
                <CardHeader
                  title="กฎของทางร้าน"
                  description="ข้อมูลและแนวทางที่ AI ใช้ร่วมกับสินค้าและข้อความตอบกลับที่บันทึกไว้เพื่อตอบลูกค้า"
                />
                <div className="space-y-4 p-5">
                  {!aiReady && (
                    <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      <span>
                        ยังไม่ได้ตั้งค่าการเชื่อมต่อบริการ AI บนเซิร์ฟเวอร์
                        ระบบจะส่งต่อให้แอดมินดูแลเมื่อ AI ไม่พร้อม
                      </span>
                    </p>
                  )}
                  <Field
                    label="ข้อมูลร้านและคำสั่งสำหรับ AI"
                    hint="เขียนเหมือนบรีฟพนักงานใหม่: ค่าส่ง เวลาจัดส่ง นโยบายเปลี่ยนคืน โปรโมชัน น้ำเสียงที่ต้องการ"
                  >
                    <textarea
                      rows={10}
                      maxLength={50000}
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
                        <CircleCheck
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                          aria-hidden
                        />
                        {t}
                      </li>
                    ))}
                  </ul>
                </div>
              </Card>
            )}

            <AiTestingStudio
              key={tenantId}
              tenantId={tenantId}
              settings={settings}
              activeRuleCount={rules.filter((rule) => rule.is_active).length}
              aiAllowed={aiReady && (aiQuota?.remaining ?? 0) > 0}
              onUsage={() => router.refresh()}
            />
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader
                title="ส่งต่อให้แอดมิน (หยุดบอทชั่วคราว)"
                description="เมื่อลูกค้าพิมพ์คำเหล่านี้ ระบบจะหยุดการตอบอัตโนมัติทันที เพื่อให้แอดมินเข้ามารับช่วงต่อ"
              />
              <div className="space-y-4 p-5">
                <div>
                  <span className="mb-1.5 block text-sm font-medium text-slate-700">
                    คำที่ใช้ขอคุยกับแอดมิน
                  </span>
                  <KeywordInput
                    value={settings.handover_keywords}
                    onChange={(v) => set('handover_keywords', v)}
                    placeholder="ตัวอย่าง: ขอคุยกับคน, ติดต่อเจ้าหน้าที่"
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    พิมพ์คำที่ต้องการแล้วกด Enter หรือเครื่องหมายจุลภาค (,) เช่น ขอคุยกับคน,
                    ติดต่อเจ้าหน้าที่
                  </p>
                </div>
                <div className="space-y-3">
                  <p className="text-sm font-medium text-slate-700">
                    ข้อความแจ้งลูกค้าเมื่อย้ายสายหาแอดมิน
                  </p>
                  <p className="text-xs text-slate-500">
                    ระบบสุ่มส่งหนึ่งข้อความเมื่อส่งต่อให้แอดมิน เพิ่มได้สูงสุด 20 ข้อความ
                  </p>
                  {settings.handover_messages.map((text, index) => (
                    <div key={index} className="flex items-start gap-2">
                      <label className="min-w-0 flex-1">
                        <span className="mb-1 block text-xs text-slate-500">
                          ข้อความแจ้งลูกค้า {index + 1}
                        </span>
                        <textarea
                          rows={2}
                          maxLength={2000}
                          value={text}
                          placeholder={DEFAULT_HANDOVER_MESSAGE}
                          onChange={(event) =>
                            set(
                              'handover_messages',
                              settings.handover_messages.map((message, i) =>
                                i === index ? event.target.value : message,
                              ),
                            )
                          }
                          className={cn(inputClass, 'resize-none')}
                        />
                      </label>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="mt-5 text-rose-500"
                        aria-label={`ลบข้อความแจ้งลูกค้า ${index + 1}`}
                        onClick={() =>
                          set(
                            'handover_messages',
                            settings.handover_messages.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="secondary"
                    disabled={settings.handover_messages.length >= MAX_FALLBACK_MESSAGES}
                    onClick={() => set('handover_messages', [...settings.handover_messages, ''])}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    เพิ่มข้อความแจ้งลูกค้า
                  </Button>
                  <p className="text-xs text-slate-500">
                    หากไม่มีข้อความ ระบบจะใช้ “{DEFAULT_HANDOVER_MESSAGE}”
                  </p>
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
                      <li
                        key={c.id}
                        className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <UserRound className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <Link
                            href={`/inbox?customer=${c.id}`}
                            className="block truncate text-sm font-medium text-slate-800 hover:underline"
                          >
                            {customerName(c)}
                          </Link>
                          <span
                            className="block text-[11px] text-slate-400"
                            suppressHydrationWarning
                          >
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
    </div>
  )
}
