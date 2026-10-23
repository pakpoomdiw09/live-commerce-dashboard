import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { NextRequest } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin, supabaseServer } from '@/lib/supabase/server'
import type { TenantRole } from '@/lib/types'

/**
 * Who is calling: a server-to-server caller holding INTERNAL_API_SECRET (full access),
 * or a signed-in dashboard user. API routes use the service role, so every route must
 * check tenant access with the helpers below; RLS only protects the browser/session client.
 */
export type Actor = { kind: 'internal' } | { kind: 'user'; id: string; isPlatformAdmin: boolean }

// Layout and page guards share one verified session per RSC request.
// Keep this request-scoped: never persist authentication across users.
const verifiedSession = cache(async () => (await supabaseServer()).auth.getUser())

/** Page/data-layer guard: verify the session before any dashboard data is loaded. */
export const requireDashboardUser = cache(async () => {
  const { data, error } = await verifiedSession()
  if (error || !data.user) redirect('/login')
  return data.user
})

/** The signed-in user, once per request. */
const currentUser = cache(async (): Promise<{ id: string; isPlatformAdmin: boolean } | null> => {
  const { data, error: sessionError } = await verifiedSession()
  if (sessionError || !data.user) return null
  const { data: admin, error } = await supabaseAdmin()
    .from('platform_admins')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (error)
    console.error(
      '[auth] platform admin lookup failed (did you run supabase/security.sql?)',
      error.message,
    )
  return { id: data.user.id, isPlatformAdmin: !error && !!admin }
})

export async function getActor(req?: NextRequest): Promise<Actor | null> {
  const secret = process.env.INTERNAL_API_SECRET?.trim()
  if (req && secret && req.headers.get('authorization') === `Bearer ${secret}`)
    return { kind: 'internal' }
  const user = await currentUser()
  return user && { kind: 'user', ...user }
}

export const isPlatformAdmin = (actor: Actor) => actor.kind === 'internal' || actor.isPlatformAdmin

/** Background jobs have no signed-in actor: only an admin-owned tenant is exempt. */
export async function tenantHasFeatureBypass(
  db: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await db.rpc('tenant_has_feature_bypass', { p_tenant: tenantId })
  if (error) {
    console.error('[auth] feature bypass lookup unavailable', error.code)
    return false
  }
  return data === true
}

/**
 * The actor's role in a tenant, or null without access. Rows not linked to any tenant
 * (tenantId null) belong to the platform: only admins may touch them.
 */
export async function tenantRole(
  actor: Actor,
  tenantId: string | null,
): Promise<TenantRole | null> {
  if (isPlatformAdmin(actor)) return 'admin'
  if (!tenantId || actor.kind !== 'user') return null
  const { data: tenant, error: tenantError } = await supabaseAdmin()
    .from('tenants')
    .select('is_active')
    .eq('id', tenantId)
    .maybeSingle()
  if (tenantError || tenant?.is_active !== true) return null
  const { data, error } = await supabaseAdmin()
    .from('tenant_members')
    .select('role')
    .eq('tenant_id', tenantId)
    .eq('user_id', actor.id)
    .maybeSingle()
  if (error) {
    console.error('[auth] membership lookup failed', error.message)
    return null
  }
  return (data?.role as TenantRole | undefined) ?? null
}

const RANK: Record<TenantRole, number> = { staff: 1, owner: 2, admin: 3 }

/** Whether `role` is at least `need` (admin > owner > staff). */
export const roleAtLeast = (role: TenantRole | null, need: TenantRole) =>
  !!role && RANK[role] >= RANK[need]

/** Shortcut for routes: does the actor have at least `need` in this tenant? */
export async function canAccessTenant(
  actor: Actor,
  tenantId: string | null,
  need: TenantRole = 'staff',
) {
  return roleAtLeast(await tenantRole(actor, tenantId), need)
}

/** The signed-in staff member's user id, or null. For actions that record who did them. */
export async function staffUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null
}
