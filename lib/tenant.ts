import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase/server'
import { getActor, tenantRole, type Actor } from '@/lib/auth'
import {
  getPagePicture,
  getPageProfile,
  getPageTokenStatus,
  inspectPageToken,
  pageTokenFor,
  type PageProfile,
} from '@/lib/integrations/facebook/client'
import {
  TENANT_COLUMNS,
  type PageConnectionStatus,
  type TenantRole,
  type TenantRow,
} from '@/lib/types'
import type { TenantInput } from '@/lib/validation'

export const ACTIVE_TENANT_COOKIE = 'active_tenant'

/** Service-role reads require an authenticated actor and an explicit membership scope. */
export async function getTenantsForActor(
  actor: Actor | null,
): Promise<{ tenants: TenantRow[]; error: string | null }> {
  if (!actor) return { tenants: [], error: 'กรุณาเข้าสู่ระบบ' }
  const db = supabaseAdmin()
  let tenantIds: string[] | null = null
  if (actor.kind === 'user' && !actor.isPlatformAdmin) {
    const membership = await db.from('tenant_members').select('tenant_id').eq('user_id', actor.id)
    if (membership.error) return { tenants: [], error: membership.error.message }
    tenantIds = (membership.data ?? []).map((row) => row.tenant_id as string)
    if (!tenantIds.length) return { tenants: [], error: null }
  }
  const query = (columns: string) => {
    let scoped = db.from('tenants').select(columns)
    if (tenantIds) scoped = scoped.in('id', tenantIds).eq('is_active', true)
    return scoped.order('created_at').returns<TenantRow[]>()
  }
  let { data, error } = await query(TENANT_COLUMNS)
  // Optional top-up migration/grants must not hide all otherwise accessible shops.
  if (error && ['42501', '42703', 'PGRST204'].includes(error.code)) {
    const baseColumns = TENANT_COLUMNS.split(',')
      .map((column) => column.trim())
      .filter((column) => column !== 'slip_quota_credits')
      .join(',')
    const base = await query(baseColumns)
    data = base.data?.map((tenant) => ({ ...tenant, slip_quota_credits: 0 })) ?? null
    error = base.error
    if (!error) console.warn('[tenant] optional slip top-up column unavailable; using base quota')
  }
  if (error) {
    console.error(
      '[tenant] list failed (did you run supabase/platform.sql and supabase/security.sql?)',
      error,
    )
    return { tenants: [], error: error.message }
  }
  return {
    tenants: (data ?? []).map((tenant) => ({ ...tenant, account_number: null })) as TenantRow[],
    error: null,
  }
}

/** React cache deduplicates within this request only; never persists tenants across users. */
export const getTenants = cache(async () => getTenantsForActor(await getActor()))

/** The tenant picked in the Quick Switcher, falling back to the oldest one. null when there are none. */
export const getActiveTenant = cache(async (): Promise<TenantRow | null> => {
  const { tenants } = await getTenants()
  const picked = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value
  return tenants.find((t) => t.id === picked) ?? tenants[0] ?? null
})

/** The signed-in user's role in the active tenant, and whether they are a platform admin. */
export const getViewer = cache(
  async (): Promise<{ role: TenantRole | null; isPlatformAdmin: boolean }> => {
    const [actor, active] = await Promise.all([getActor(), getActiveTenant()])
    if (!actor) return { role: null, isPlatformAdmin: false }
    const isPlatformAdmin = actor.kind === 'internal' || actor.isPlatformAdmin
    return { role: await tenantRole(actor, active?.id ?? null), isPlatformAdmin }
  },
)

/** The Facebook Page linked to a tenant, with its name and picture when the tenant's token works. */
export async function tenantPages(
  tenant: (Pick<TenantRow, 'id' | 'page_id'> & Partial<Pick<TenantRow, 'page_name'>>) | null,
): Promise<PageProfile[]> {
  if (!tenant?.page_id) return []
  // the token is hidden from dashboard users, so read it with the service role
  const { data, error } = await supabaseAdmin()
    .from('tenants')
    .select('page_id, page_name, page_access_token')
    .eq('id', tenant.id)
    .maybeSingle()
  if (error) console.error('[tenant/profile] database lookup failed', error.code)
  if (process.env.FB_DEBUG === 'true')
    console.log('[tenant/profile] saved Page', {
      tenantId: tenant.id,
      pageId: data?.page_id ?? tenant.page_id,
      pageName: data?.page_name ?? tenant.page_name,
      page_access_token: data?.page_access_token
        ? `[REDACTED: ${data.page_access_token.length} characters]`
        : null,
    })
  const token = pageTokenFor(data ?? { page_id: tenant.page_id, page_access_token: null })
  const profile = await getPageProfile(token)
  const picture =
    (!profile || profile.id === tenant.page_id) && !profile?.picture
      ? await getPagePicture(tenant.page_id, token)
      : profile?.id === tenant.page_id
        ? profile.picture
        : null
  if (process.env.FB_DEBUG === 'true')
    console.log('[tenant/profile] display props', {
      tenantId: tenant.id,
      profileLookup: profile ? 'returned' : 'unavailable',
      pageIdMatches: profile ? profile.id === tenant.page_id : null,
      pictureUrl: picture,
      name: profile?.id === tenant.page_id ? profile.name : data?.page_name || tenant.page_name,
    })
  return [
    profile?.id === tenant.page_id
      ? { ...profile, picture }
      : {
          id: tenant.page_id,
          name: data?.page_name || tenant.page_name || `เพจ ${tenant.page_id}`,
          picture,
        },
  ]
}

/** Secret tokens stay on the server; failed profile reads never determine connection status. */
export async function tenantPageConnections(
  tenants: Pick<TenantRow, 'id' | 'page_id' | 'page_token_set'>[],
): Promise<Map<string, PageConnectionStatus>> {
  const statuses = new Map<string, PageConnectionStatus>(
    tenants.map((tenant) => [
      tenant.id,
      !tenant.page_id ? 'missing-page' : tenant.page_token_set ? 'unverified' : 'missing-token',
    ]),
  )
  const linked = tenants.filter((tenant) => tenant.page_id)
  if (!linked.length) return statuses
  try {
    const { data, error } = await supabaseAdmin()
      .from('tenants')
      .select('id, page_id, page_access_token')
      .in(
        'id',
        linked.map((tenant) => tenant.id),
      )
    if (error) {
      console.error('[tenant] page connection lookup failed', error.code)
      return statuses
    }
    await Promise.all(
      linked.map(async (tenant) => {
        const row = data?.find((item) => item.id === tenant.id)
        if (!row || row.page_id !== tenant.page_id) {
          statuses.set(tenant.id, 'unverified')
          return
        }
        const token = pageTokenFor(row)
        statuses.set(
          tenant.id,
          token ? await getPageTokenStatus(token, tenant.page_id!) : 'missing-token',
        )
      }),
    )
  } catch {
    // Database/configuration failures mean verification is unavailable, not an invalid token.
  }
  return statuses
}

/**
 * Before saving a new Page token: ask Meta which Page it belongs to (inspectPageToken).
 * The Page id is filled in from the token when none is set, a token of another Page is rejected,
 * and a pasted User token is replaced by its Page's token.
 * Returns Meta's reason on failure, or the non-blocking warnings (missing permissions, expiry).
 */
export async function checkPageToken(
  input: TenantInput,
  currentPageId: string | null,
): Promise<{ error: string } | { warnings: string[] }> {
  if (!input.page_access_token) return { warnings: [] }
  const pageId = input.page_id !== undefined ? input.page_id : currentPageId
  const check = await inspectPageToken(input.page_access_token, pageId)
  if (!check.ok) return { error: check.error }
  input.page_access_token = check.token
  input.page_id = check.pageId
  return { warnings: check.warnings }
}

/** A Page from "เชื่อมต่อเพจด้วย Facebook" (facebook_pages), without its token. */
export type ConnectedPageInfo = { page_id: string; name: string; picture: string | null }

/** The signed-in user's connected Pages that no tenant uses yet. [] before facebook-connect.sql has run. */
export async function unlinkedFacebookPages(userId: string): Promise<ConnectedPageInfo[]> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('facebook_pages')
    .select('page_id, name, picture')
    .eq('user_id', userId)
    .order('name')
  if (error || !data?.length) return []
  // every tenant, not only the user's: a Page linked to someone else's shop can't be added again
  const { data: linked } = await db
    .from('tenants')
    .select('page_id')
    .in(
      'page_id',
      data.map((p) => p.page_id),
    )
  const taken = new Set((linked ?? []).map((t) => t.page_id))
  return data.filter((p) => !taken.has(p.page_id))
}

/** One connected Page of this user, for pre-filling the new-tenant form. */
export async function connectedFacebookPage(
  userId: string,
  pageId: string,
): Promise<ConnectedPageInfo | null> {
  const { data } = await supabaseAdmin()
    .from('facebook_pages')
    .select('page_id, name, picture')
    .eq('user_id', userId)
    .eq('page_id', pageId)
    .maybeSingle()
  return data
}

/**
 * Saving a Page id without a token: use the token from the user's own "เชื่อมต่อเพจด้วย Facebook",
 * if they connected that Page. Only their own row, so nobody can borrow another user's token.
 */
export async function fillTokenFromFacebook(input: TenantInput, userId: string | null) {
  if (!userId || !input.page_id || input.page_access_token) return
  const { data } = await supabaseAdmin()
    .from('facebook_pages')
    .select('access_token')
    .eq('user_id', userId)
    .eq('page_id', input.page_id)
    .maybeSingle()
  if (data?.access_token) input.page_access_token = data.access_token
}

/**
 * Strict PostgREST scope for the selected Page's tenant; unassigned rows are excluded.
 */
export const tenantFilter = (tenantId: string) => `tenant_id.eq.${tenantId}`
