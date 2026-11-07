import { NextRequest, NextResponse } from 'next/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { pageTokenFor } from '@/lib/integrations/facebook/client'

export const runtime = 'nodejs'
export const maxDuration = 60

const PAGE_ID = '122099866472012045'
const GRAPH_ENDPOINT = 'https://graph.facebook.com/v21.0'
const PAGE_FIELDS = 'id,updated_time,participants,messages{id,message,from,created_time}'

type FacebookProfile = { id?: unknown; name?: unknown }
type FacebookMessage = {
  id?: unknown
  message?: unknown
  from?: FacebookProfile
  created_time?: unknown
}
type FacebookConversation = {
  id?: unknown
  participants?: { data?: FacebookProfile[] }
  messages?: { data?: FacebookMessage[]; paging?: { next?: string } }
}
type GraphResponse<T> = { data?: T[]; paging?: { next?: string }; error?: unknown }
type CustomerForSync = {
  id: string
  tenant_id: string | null
  last_message_at: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function externalId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function profileName(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}

function checkedNextPage(value: unknown): URL | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'graph.facebook.com' ||
      !url.pathname.startsWith('/v21.0/')
    )
      throw new InboxError('Facebook ส่งลิงก์หน้าถัดไปที่ไม่ถูกต้อง', 502)
    return url
  } catch (error) {
    if (error instanceof InboxError) throw error
    throw new InboxError('Facebook ส่งลิงก์หน้าถัดไปที่ไม่ถูกต้อง', 502)
  }
}

async function graphRequest<T>(url: URL): Promise<GraphResponse<T>> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) })
  } catch {
    throw new InboxError(
      'เชื่อมต่อ Facebook ไม่สำเร็จ กรุณาลองอีกครั้ง',
      502,
      'FACEBOOK_UNAVAILABLE',
    )
  }
  const result: unknown = await response.json().catch(() => null)
  if (!response.ok || !isRecord(result) || !Array.isArray(result.data)) {
    throw new InboxError('Facebook ไม่สามารถส่งประวัติข้อความได้', 502, 'FACEBOOK_SYNC_FAILED')
  }
  return result as GraphResponse<T>
}

function firstConversationsUrl(token: string): URL {
  const url = new URL(`${GRAPH_ENDPOINT}/me/conversations`)
  url.searchParams.set('fields', PAGE_FIELDS)
  url.searchParams.set('limit', '100')
  url.searchParams.set('access_token', token)
  return url
}

async function resolveCustomer(
  db: Awaited<ReturnType<typeof inboxTenant>>['db'],
  tenantId: string,
  psid: string,
  name: string | null,
): Promise<CustomerForSync> {
  const existing = await db
    .from('customers')
    .select('id,tenant_id,last_message_at')
    .eq('platform', 'facebook')
    .eq('platform_user_id', psid)
    .maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    if (existing.data.tenant_id && existing.data.tenant_id !== tenantId)
      throw new InboxError(
        'ลูกค้า Facebook นี้เชื่อมกับร้านค้าอื่น',
        409,
        'CUSTOMER_TENANT_MISMATCH',
      )
    const changes: Record<string, string> = {}
    if (!existing.data.tenant_id) changes.tenant_id = tenantId
    if (name) changes.display_name = name
    if (Object.keys(changes).length) {
      const saved = await db
        .from('customers')
        .update(changes)
        .eq('id', existing.data.id)
        .eq('platform', 'facebook')
        .eq('platform_user_id', psid)
        .select('id,tenant_id,last_message_at')
        .single()
      if (saved.error) throw saved.error
      if (saved.data.tenant_id !== tenantId)
        throw new InboxError(
          'ลูกค้า Facebook นี้เชื่อมกับร้านค้าอื่น',
          409,
          'CUSTOMER_TENANT_MISMATCH',
        )
      return saved.data as CustomerForSync
    }
    return existing.data as CustomerForSync
  }

  const inserted = await db
    .from('customers')
    .insert({
      platform: 'facebook',
      platform_user_id: psid,
      tenant_id: tenantId,
      ...(name ? { display_name: name } : {}),
    })
    .select('id,tenant_id,last_message_at')
    .single()
  if (inserted.error?.code === '23505') {
    return resolveCustomer(db, tenantId, psid, name)
  }
  if (inserted.error) throw inserted.error
  return inserted.data as CustomerForSync
}

async function conversationMessages(
  firstPage: FacebookConversation['messages'],
): Promise<FacebookMessage[]> {
  const messages = [...(firstPage?.data ?? [])]
  let next = checkedNextPage(firstPage?.paging?.next)
  while (next) {
    const page = await graphRequest<FacebookMessage>(next)
    messages.push(...(page.data ?? []))
    next = checkedNextPage(page.paging?.next)
  }
  return messages
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin)
      throw new InboxError('ไม่อนุญาตคำขอจากเว็บไซต์อื่น', 403)
    const input: unknown = await req.json().catch(() => null)
    if (!isRecord(input) || typeof input.tenantId !== 'string')
      throw new InboxError('ข้อมูลร้านค้าไม่ถูกต้อง')
    const { db, tenantId } = await inboxTenant(req, input.tenantId)

    const tenant = await db
      .from('tenants')
      .select('page_id,page_access_token')
      .eq('id', tenantId)
      .eq('page_id', PAGE_ID)
      .eq('is_active', true)
      .maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data)
      throw new InboxError('ไม่พบเพจ Facebook ที่ใช้งานอยู่', 409, 'PAGE_NOT_LINKED')
    const token = pageTokenFor(tenant.data)
    if (!token) throw new InboxError('ไม่พบ Page Access Token', 409, 'PAGE_TOKEN_MISSING')

    let target: CustomerForSync | null = null
    let targetPsid: string | null = null
    if (input.customerId !== undefined) {
      if (typeof input.customerId !== 'string') throw new InboxError('รหัสลูกค้าไม่ถูกต้อง')
      const customer = await db
        .from('customers')
        .select('id,tenant_id,platform,platform_user_id,last_message_at')
        .eq('id', input.customerId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (customer.error) throw customer.error
      if (!customer.data) throw new InboxError('ไม่พบลูกค้า', 404, 'CUSTOMER_NOT_FOUND')
      if (customer.data.platform !== 'facebook' || !externalId(customer.data.platform_user_id))
        throw new InboxError('ลูกค้ารายนี้ไม่ใช่ Facebook Messenger', 400, 'NOT_FACEBOOK_CUSTOMER')
      target = customer.data as CustomerForSync
      targetPsid = customer.data.platform_user_id
    }

    const pendingMessages: {
      customer_id: string
      external_id: string
      provider_message_id: string
      sender: 'customer' | 'agent'
      body: string | null
      attachments: never[]
      created_at: string
    }[] = []
    const customerRows = new Map<string, CustomerForSync>()
    const latestMessageAt = new Map<string, string>()
    let syncedConversations = 0
    let next: URL | null = firstConversationsUrl(token)
    let matchedTarget = false

    while (next) {
      const page = await graphRequest<FacebookConversation>(next)
      for (const conversation of page.data ?? []) {
        const participants = conversation.participants?.data ?? []
        const firstMessages = conversation.messages
        const participantProfiles = participants.filter(
          (profile) => externalId(profile.id) && externalId(profile.id) !== PAGE_ID,
        )
        const pageMessageCustomers = (firstMessages?.data ?? [])
          .map((message) => message.from)
          .filter(
            (profile): profile is FacebookProfile =>
              !!externalId(profile?.id) && externalId(profile?.id) !== PAGE_ID,
          )
        const allProfiles = [...participantProfiles, ...pageMessageCustomers]
        const targetProfile = target
          ? allProfiles.find((profile) => profile.id === targetPsid)
          : null
        if (target && !targetProfile) continue
        if (target) matchedTarget = true

        const profilesById = new Map<string, FacebookProfile>()
        for (const profile of allProfiles) {
          const id = externalId(profile.id)
          if (id && !profilesById.has(id)) profilesById.set(id, profile)
        }
        if (!profilesById.size) continue
        const resolved = new Map<string, CustomerForSync>()
        const primaryPsid =
          targetPsid ??
          participantProfiles.map((profile) => externalId(profile.id)).find((id) => id !== null) ??
          [...profilesById.keys()][0]
        for (const [psid, profile] of profilesById) {
          if (target && psid !== targetPsid) continue
          const customer =
            target && psid === targetPsid
              ? target
              : await resolveCustomer(db, tenantId, psid, profileName(profile.name))
          resolved.set(psid, customer)
          customerRows.set(customer.id, customer)
        }

        const messages = await conversationMessages(firstMessages)
        for (const message of messages) {
          const id = externalId(message.id)
          const senderId = externalId(message.from?.id)
          const createdAt =
            typeof message.created_time === 'string' &&
            Number.isFinite(Date.parse(message.created_time))
              ? new Date(message.created_time).toISOString()
              : null
          if (!id || !createdAt) continue
          const customer =
            senderId === PAGE_ID
              ? resolved.get(primaryPsid)
              : ((senderId ? resolved.get(senderId) : undefined) ?? resolved.get(primaryPsid))
          if (!customer) continue
          pendingMessages.push({
            customer_id: customer.id,
            external_id: id,
            provider_message_id: id,
            sender: senderId === PAGE_ID ? 'agent' : 'customer',
            body: typeof message.message === 'string' ? message.message : null,
            attachments: [],
            created_at: createdAt,
          })
          const prior = latestMessageAt.get(customer.id) ?? customer.last_message_at ?? ''
          if (createdAt > prior) latestMessageAt.set(customer.id, createdAt)
        }
        syncedConversations++
      }
      if (target && matchedTarget) break
      next = checkedNextPage(page.paging?.next)
    }

    if (target && !matchedTarget)
      throw new InboxError('ไม่พบบทสนทนานี้ใน Facebook', 404, 'FACEBOOK_CONVERSATION_NOT_FOUND')

    for (let offset = 0; offset < pendingMessages.length; offset += 100) {
      const saved = await db.from('messages').upsert(pendingMessages.slice(offset, offset + 100), {
        onConflict: 'external_id',
        ignoreDuplicates: true,
      })
      if (saved.error) throw saved.error
    }
    for (const [customerId, lastMessageAt] of latestMessageAt) {
      const saved = await db
        .from('customers')
        .update({ last_message_at: lastMessageAt })
        .eq('id', customerId)
        .eq('tenant_id', tenantId)
      if (saved.error) throw saved.error
    }

    return NextResponse.json(
      {
        syncedConversations,
        syncedMessages: pendingMessages.length,
        customerCount: customerRows.size,
        targetFound: target ? matchedTarget : undefined,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return inboxError(error)
  }
}
