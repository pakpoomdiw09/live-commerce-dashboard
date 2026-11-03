import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPageTokenUserId } from '@/lib/integrations/facebook/client'

/** Called only after owner authorization. Supabase UUIDs are not Facebook author IDs. */
export async function auctionHostIds(db: SupabaseClient, actorId: string, pageId: string) {
  const { data, error } = await db.auth.admin.getUserById(actorId)
  if (error) throw error
  if (!data.user || data.user.id !== actorId) throw new Error('AUCTION_HOST_USER_UNAVAILABLE')
  const ids = (data.user.identities ?? [])
    .filter((identity) => identity.provider === 'facebook')
    .map((identity) => identity.id)
    .filter((id) => /^\d{1,64}$/.test(id))

  // Email/password users can connect Facebook separately. Use only their own saved
  // Page connection, never the tenant's shared token (which may belong to another admin).
  if (!ids.length) {
    const connection = await db
      .from('facebook_pages')
      .select('access_token')
      .eq('user_id', actorId)
      .eq('page_id', pageId)
      .maybeSingle()
    if (connection.error) throw connection.error
    if (connection.data?.access_token) {
      const id = await getPageTokenUserId(connection.data.access_token, pageId)
      if (id) ids.push(id)
    }
  }
  if (!ids.length) throw new Error('AUCTION_HOST_FACEBOOK_REQUIRED')
  return [...new Set([pageId, ...ids])]
}
