import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import { getActor, tenantRole } from '@/lib/auth'
import { getPageProfile, inspectPageToken, pageTokenFor, type PageProfile } from '@/lib/facebook'
import { TENANT_COLUMNS, type TenantRole, type TenantRow } from '@/lib/types'
import type { TenantInput } from '@/lib/validation'

export const ACTIVE_TENANT_COOKIE = 'active_tenant'

/** Every tenant the signed-in user may see (RLS: platform admin = all, member = own). Cached per request. */
export const getTenants = cache(async (): Promise<{ tenants: TenantRow[]; error: string | null }> => {
  const db = await supabaseServer()
  const { data, error } = await db.from('tenants').select(TENANT_COLUMNS).order('created_at')
  if (error) {
    console.error('[tenant] list failed (did you run supabase/platform.sql and supabase/security.sql?)', error)
    return { tenants: [], error: error.message }
  }
  return { tenants: (data ?? []) as TenantRow[], error: null }
})

/** The tenant picked in the Quick Switcher, falling back to the oldest one. null when there are none. */
export const getActiveTenant = cache(async (): Promise<TenantRow | null> => {
  const { tenants } = await getTenants()
  const picked = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value
  return tenants.find((t) => t.id === picked) ?? tenants[0] ?? null
})

/** The signed-in user's role in the active tenant, and whether they are a platform admin. */
export const getViewer = cache(async (): Promise<{ role: TenantRole | null; isPlatformAdmin: boolean }> => {
  const [actor, active] = await Promise.all([getActor(), getActiveTenant()])
  if (!actor) return { role: null, isPlatformAdmin: false }
  const isPlatformAdmin = actor.kind === 'internal' || actor.isPlatformAdmin
  return { role: await tenantRole(actor, active?.id ?? null), isPlatformAdmin }
})

/** The Facebook Page linked to a tenant, with its name and picture when the tenant's token works. */
export async function tenantPages(tenant: Pick<TenantRow, 'id' | 'page_id'> | null): Promise<PageProfile[]> {
  if (!tenant?.page_id) return []
  // the token is hidden from dashboard users, so read it with the service role
  const { data } = await supabaseAdmin().from('tenants').select('page_id, page_access_token').eq('id', tenant.id).maybeSingle()
  const profile = await getPageProfile(pageTokenFor(data ?? { page_id: tenant.page_id, page_access_token: null }))
  return [profile?.id === tenant.page_id ? profile : { id: tenant.page_id, name: `เพจ ${tenant.page_id}`, picture: null }]
}

/**
 * Before saving a new Page token: ask Meta which Page it belongs to (inspectPageToken).
 * The Page id is filled in from the token when none is set, a token of another Page is rejected,
 * and a pasted User token is replaced by its Page's token.
 * Returns Meta's reason on failure, or the non-blocking warnings (missing permissions, expiry).
 */
export async function checkPageToken(input: TenantInput, currentPageId: string | null): Promise<{ error: string } | { warnings: string[] }> {
  if (!input.page_access_token) return { warnings: [] }
  const pageId = input.page_id !== undefined ? input.page_id : currentPageId
  const check = await inspectPageToken(input.page_access_token, pageId)
  if (!check.ok) return { error: check.error }
  input.page_access_token = check.token
  input.page_id = check.pageId
  return { warnings: check.warnings }
}

/**
 * PostgREST filter for rows of the active tenant. Rows not yet assigned to any tenant
 * (e.g. a Page that isn't linked in Settings) are only visible to platform admins (RLS),
 * who see them under every tenant so they don't vanish.
 */
export const tenantFilter = (tenantId: string) => `tenant_id.eq.${tenantId},tenant_id.is.null`
