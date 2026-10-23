'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Bot, LoaderCircle, UserRoundCheck } from 'lucide-react'
import type {
  ConversationState,
  ConversationUpdate,
  InboxState,
} from '@/lib/features/inbox/inbox-types'
import { cn } from '@/lib/utils'
import {
  inboxActionRequest,
  refreshInboxAction,
  isConversationUpdate,
} from '@/lib/features/inbox/inbox-action-request'

type Action = 'claim' | 'pause' | 'bot'
type PendingAction = {
  signature: string
  body: { action: Action; version: number; requestId?: string }
}

export function ConversationActions({
  state,
  inbox,
  onChange,
  onSaved,
  children,
  toolbar,
  autoReplyEnabled = true,
  windowAllowed = false,
}: {
  children?: ReactNode
  toolbar?: ReactNode
  state: ConversationState | undefined
  inbox: InboxState | null
  onChange: () => Promise<void>
  onSaved?: (saved: ConversationUpdate) => void
  autoReplyEnabled?: boolean
  windowAllowed?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const locked = useRef(false)
  const pending = useRef<PendingAction | null>(null)
  const shopEnabled = inbox?.autoReplyEnabled ?? autoReplyEnabled
  const active =
    !!state &&
    windowAllowed &&
    shopEnabled &&
    state.bot_enabled &&
    !state.assigned_user_id &&
    state.conversation_status === 'open'
  const canManage =
    !!state &&
    !!inbox &&
    (!state.assigned_user_id ||
      state.assigned_user_id === inbox.viewerId ||
      inbox.canManageTeam === true)
  const enableReason = !windowAllowed
    ? 'หมดเวลา 24 ชั่วโมงหรือยังยืนยันเวลาข้อความไม่ได้'
    : !shopEnabled
      ? 'ระบบตอบอัตโนมัติของร้านปิดอยู่'
      : !inbox?.aiAllowed
        ? 'แพ็กเกจของร้านยังไม่รองรับ AI'
        : ''
  const permissionReason =
    !state || !inbox
      ? 'กำลังโหลดสถานะ AI'
      : !canManage
        ? 'แชทนี้มีผู้ดูแลคนอื่น กรุณาให้ผู้ดูแลหรือเจ้าของร้านเปลี่ยนสถานะ'
        : ''
  const pausedByViewer =
    !!state &&
    !state.bot_enabled &&
    state.assigned_user_id === inbox?.viewerId &&
    state.conversation_status === 'open'
  const canPause = canManage && state?.conversation_status === 'open' && !pausedByViewer

  async function act(action: Action) {
    if (!state || !inbox || locked.current || !canManage) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    const signature = JSON.stringify([state.id, action])
    const body =
      pending.current?.signature === signature
        ? pending.current.body
        : {
            action,
            version: state.conversation_version,
            ...(inbox.proEnabled ? { requestId: crypto.randomUUID() } : {}),
          }
    pending.current = { signature, body }
    let saved = false
    try {
      const { response, data } = await inboxActionRequest(
        `/api/inbox/conversations/${state.id}`,
        body,
      )
      if (!response.ok) {
        if (response.status < 500) pending.current = null
        throw new Error(
          typeof data?.error === 'string'
            ? data.error
            : `ดำเนินการไม่สำเร็จ (HTTP ${response.status})`,
        )
      }
      pending.current = null
      saved = true
      if (data.customer && isConversationUpdate(data.customer, state.id)) onSaved?.(data.customer)
      setNotice(
        action === 'bot' ? 'เปิด AI ตอบอัตโนมัติแล้ว' : 'ปิด AI และเปลี่ยนเป็นแอดมินดูแลแล้ว',
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกสถานะ AI ไม่สำเร็จ กรุณาลองอีกครั้ง')
    } finally {
      try {
        await refreshInboxAction(onChange)
      } catch {
        if (saved) setError('บันทึกแล้ว แต่โหลดสถานะล่าสุดไม่ได้ กรุณาตรวจสอบอีกครั้ง')
      } finally {
        locked.current = false
        setBusy(false)
      }
    }
  }

  const choice =
    'rounded-full px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50'
  return (
    <header data-chat-header className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {children && <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>}
        <div className="flex max-w-full flex-wrap items-center gap-2" aria-busy={busy}>
          {toolbar}
          {state && (
            <button
              type="button"
              aria-label="รับแชท"
              disabled={
                busy || !canManage || pausedByViewer || state.conversation_status !== 'open'
              }
              title={permissionReason || 'รับช่วงดูแลและปิด AI สำหรับแชทนี้'}
              onClick={() => void act('claim')}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-orange-500 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UserRoundCheck aria-hidden className="h-3.5 w-3.5" />
              {pausedByViewer ? 'รับแชทแล้ว' : 'รับแชท'}
            </button>
          )}
          {state && (!windowAllowed || !state.bot_enabled) && !pausedByViewer && (
            <button
              type="button"
              disabled={busy || !canPause}
              onClick={() => void act(state.assigned_user_id ? 'pause' : 'claim')}
              className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-xs font-semibold text-orange-800 ring-1 ring-orange-200 hover:bg-orange-100 disabled:opacity-50"
            >
              ส่งแชทให้แอดมิน
            </button>
          )}
          <div className="flex max-w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-1">
            <span
              role="status"
              className={cn(
                'inline-flex min-w-0 items-center gap-1.5 text-xs font-medium',
                active ? 'text-orange-700' : 'text-slate-600',
              )}
            >
              {busy ? (
                <LoaderCircle
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Bot aria-hidden className="h-3.5 w-3.5 shrink-0" />
              )}
              {!state
                ? 'กำลังโหลดสถานะ AI…'
                : pausedByViewer
                  ? 'แอดมินกำลังดูแล'
                  : active
                    ? 'AI ตอบอัตโนมัติเปิดอยู่'
                    : 'AI ปิดอยู่'}
            </span>
            <div
              role="group"
              aria-label="การตอบอัตโนมัติของ AI"
              className="inline-flex shrink-0 rounded-full bg-white p-0.5 ring-1 ring-slate-200"
            >
              <button
                type="button"
                aria-label="เปิด AI ตอบอัตโนมัติ"
                aria-pressed={active}
                disabled={busy || !!permissionReason || !!enableReason || active}
                title={permissionReason || enableReason || 'เปิด AI ตอบอัตโนมัติ'}
                onClick={() => void act('bot')}
                className={cn(
                  choice,
                  active
                    ? 'bg-orange-500 text-white'
                    : 'text-slate-500 hover:bg-orange-50 hover:text-orange-700',
                )}
              >
                เปิด
              </button>
              <button
                type="button"
                aria-label="ปิด AI ให้แอดมินดูแล"
                aria-pressed={!!state && !active}
                disabled={busy || !canPause}
                title={
                  permissionReason ||
                  (state?.conversation_status === 'closed'
                    ? 'แชทนี้ปิดอยู่'
                    : pausedByViewer
                      ? 'คุณกำลังดูแลแชทนี้'
                      : 'ปิด AI และให้แอดมินดูแล')
                }
                onClick={() => void act(state?.assigned_user_id ? 'pause' : 'claim')}
                className={cn(
                  choice,
                  !active && state
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-500 hover:bg-slate-100',
                )}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="sr-only">
          {notice}
        </p>
      )}
    </header>
  )
}
