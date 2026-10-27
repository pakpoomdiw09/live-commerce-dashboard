'use client'

import { useEffect, useState } from 'react'
import { MapPin, Pencil, Phone, RefreshCw, StickyNote } from 'lucide-react'
import { BotToggle } from '@/components/chatbot/BotToggle'
import { Badge, Tag } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ORDER_STATUS, ORDER_STATUSES } from '@/lib/status'
import type { CustomerRow, OrderStatus, SlipRow } from '@/lib/types'
import { apiError, baht, customerName, when } from '@/lib/utils'
import { Avatar } from '@/components/inbox/Avatar'

/** Customer type and behaviour tags offered as one-click suggestions. */
const SUGGESTED_TAGS = ['VIP', 'ลูกค้าใหม่', 'ลูกค้าประจำ', 'ซื้อบ่อย', 'ต่อราคา', 'โอนช้า']

const input =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:outline-none'

export function CustomerPanel({
  customer,
  slips,
  onSaved,
}: {
  customer: CustomerRow
  slips: SlipRow[]
  onSaved: (c: CustomerRow) => void
}) {
  const [editing, setEditing] = useState(false)
  const [syncingProfile, setSyncingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  useEffect(() => setEditing(false), [customer.id])

  async function syncFacebookProfile() {
    setSyncingProfile(true)
    setProfileError(null)
    try {
      const response = await fetch(`/api/inbox/conversations/${customer.id}/profile`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await apiError(response))
      const body = (await response.json()) as { customer: CustomerRow }
      onSaved(body.customer)
    } catch (error) {
      setProfileError(
        error instanceof Error ? error.message : 'รีเฟรชโปรไฟล์จาก Facebook ไม่สำเร็จ',
      )
    } finally {
      setSyncingProfile(false)
    }
  }

  const paid = slips
    .filter((s) => s.status === 'valid')
    .reduce((sum, s) => sum + Number(s.amount ?? 0), 0)
  const order = ORDER_STATUS[customer.order_status] ?? ORDER_STATUS.new

  return (
    <section aria-label="ข้อมูลลูกค้า">
      <div className="flex items-center gap-3">
        <Avatar c={customer} className="h-12 w-12 text-lg" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-slate-900">{customerName(customer)}</h3>
          <p className="text-[11px] text-slate-500">
            รหัสลูกค้า ...{customer.platform_user_id.slice(-6)}
          </p>
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void syncFacebookProfile()}
              disabled={syncingProfile}
              aria-label="รีเฟรชชื่อและรูปจาก Facebook"
              title="รีเฟรชชื่อและรูปจาก Facebook"
            >
              <RefreshCw className={`h-4 w-4 ${syncingProfile ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEditing(true)}
              aria-label="แก้ไขข้อมูลลูกค้า"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {profileError && (
        <p role="alert" className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {profileError}
        </p>
      )}

      {editing ? (
        <CustomerForm
          customer={customer}
          onCancel={() => setEditing(false)}
          onSaved={(c) => {
            onSaved(c)
            setEditing(false)
          }}
        />
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={order.tone}>{order.label}</Badge>
            {customer.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>

          <dl className="mt-4 space-y-2.5 text-sm">
            <Info icon={Phone} label="เบอร์โทร">
              {customer.phone ? (
                <a href={`tel:${customer.phone}`} className="hover:text-orange-700">
                  {customer.phone}
                </a>
              ) : null}
            </Info>
            <Info icon={MapPin} label="ที่อยู่จัดส่ง">
              {customer.address}
            </Info>
            {customer.notes && (
              <Info icon={StickyNote} label="บันทึก">
                {customer.notes}
              </Info>
            )}
          </dl>

          <dl className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="text-[11px] text-slate-500">ยอดชำระสะสม</dt>
              <dd className="text-sm font-semibold tabular-nums">{baht(paid)}</dd>
            </div>
            <div className="rounded-lg bg-slate-50 p-2.5">
              <dt className="text-[11px] text-slate-500">ลูกค้าตั้งแต่</dt>
              <dd className="text-sm font-semibold" suppressHydrationWarning>
                {when(customer.created_at).split(' ')[0]}
              </dd>
            </div>
          </dl>
        </>
      )}

      <details className="mt-4 rounded-xl bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-600">
          การตอบอัตโนมัติในแชทนี้
        </summary>
        <div className="mt-3">
          <BotToggle customerId={customer.id} enabled={customer.bot_enabled} />
          <p className="mt-1.5 text-[11px] text-slate-500">
            ปิดเมื่อแอดมินต้องการคุยกับลูกค้าเอง ระบบอัตโนมัติจะไม่ตอบแชทนี้
          </p>
        </div>
      </details>
    </section>
  )
}

function Info({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Phone
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      <div className="min-w-0">
        <dt className="text-[11px] text-slate-500">{label}</dt>
        <dd className="break-words whitespace-pre-wrap text-slate-800">
          {children || <span className="text-slate-400">ยังไม่ได้ระบุ</span>}
        </dd>
      </div>
    </div>
  )
}

function CustomerForm({
  customer,
  onCancel,
  onSaved,
}: {
  customer: CustomerRow
  onCancel: () => void
  onSaved: (c: CustomerRow) => void
}) {
  const [displayName, setDisplayName] = useState(customer.display_name ?? '')
  const [phone, setPhone] = useState(customer.phone ?? '')
  const [address, setAddress] = useState(customer.address ?? '')
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [tags, setTags] = useState(customer.tags)
  const [newTag, setNewTag] = useState('')
  const [orderStatus, setOrderStatus] = useState<OrderStatus>(customer.order_status)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTag = (t: string) => {
    const v = t.trim()
    if (v && !tags.includes(v) && tags.length < 10) setTags([...tags, v])
    setNewTag('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/customers/${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          phone,
          address,
          notes,
          tags,
          order_status: orderStatus,
        }),
      })
      if (!res.ok) throw new Error(await apiError(res))
      onSaved(((await res.json()) as { customer: CustomerRow }).customer)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">ชื่อลูกค้า</span>
        <input
          className={input}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={120}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">เบอร์โทรศัพท์</span>
        <input
          className={input}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          inputMode="tel"
          placeholder="08x-xxx-xxxx"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">ที่อยู่จัดส่ง</span>
        <textarea
          className={input}
          rows={3}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          maxLength={500}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">สถานะออเดอร์</span>
        <select
          className={input}
          value={orderStatus}
          onChange={(e) => setOrderStatus(e.target.value as OrderStatus)}
        >
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS[s].label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mb-1 block text-xs font-medium text-slate-600">ป้ายกำกับลูกค้า</span>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <Tag key={t} onRemove={() => setTags(tags.filter((x) => x !== t))}>
              {t}
            </Tag>
          ))}
        </div>
        <input
          className={`${input} mt-2`}
          value={newTag}
          onChange={(e) => setNewTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              addTag(newTag)
            }
          }}
          placeholder="เพิ่มป้ายกำกับแล้วกดปุ่มขึ้นบรรทัดใหม่"
          maxLength={30}
        />
        <div className="mt-2 flex flex-wrap gap-1">
          {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addTag(t)}
              className="rounded-md border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-500 hover:border-orange-400 hover:text-orange-700"
            >
              + {t}
            </button>
          ))}
        </div>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-600">บันทึกภายใน</span>
        <textarea
          className={input}
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={saving} className="flex-1">
          บันทึก
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          ยกเลิก
        </Button>
      </div>
    </form>
  )
}
