import { NextRequest, NextResponse } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { inboxTenant, inboxError, InboxError } from '@/lib/features/inbox/inbox-server'
import { UUID } from '@/lib/utils'
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') throw new InboxError('กรุณาเข้าสู่ระบบ', 401)
    const { id } = await params
    if (!UUID.test(id)) throw new InboxError('ไม่พบไฟล์', 404)
    const db = supabaseAdmin()
    const media = await db.from('inbox_media').select('tenant_id,path').eq('id', id).maybeSingle()
    if (media.error) throw media.error
    if (!media.data || !(await canAccessTenant(actor, media.data.tenant_id)))
      throw new InboxError('ไม่พบไฟล์', 404)
    await inboxTenant(req, media.data.tenant_id)
    const signed = await db.storage.from('inbox-media').createSignedUrl(media.data.path, 60)
    if (signed.error) throw signed.error
    return NextResponse.redirect(signed.data.signedUrl, {
      status: 307,
      headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (error) {
    return inboxError(error)
  }
}
