import { NextRequest, NextResponse } from 'next/server'
import { getActor, canAccessTenant } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/server'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { pageTokenFor } from '@/lib/integrations/facebook/client'
import { fetchPageLiveVideos, LiveVideosError } from '@/lib/integrations/facebook/live-videos'

const headers = { 'Cache-Control': 'private, no-store' }
const failure = (error: string, status: number) =>
  NextResponse.json(
    { error },
    {
      status,
      headers: { ...headers, ...(status === 429 ? { 'Retry-After': '30' } : {}) },
    },
  )

export async function GET(req: NextRequest) {
  try {
    if (!isFeatureEnabled('live_cf')) return failure('ไม่พบหน้านี้', 404)
    const actor = await getActor(req)
    if (!actor || actor.kind !== 'user') return failure('กรุณาเข้าสู่ระบบ', 401)
    const pageId = req.nextUrl.searchParams.get('page_id') ?? ''
    if (!/^\d{1,40}$/.test(pageId)) return failure('รหัสเพจไม่ถูกต้อง', 400)
    const db = supabaseAdmin({ timeoutMs: 10_000 })
    // Resolve permission before reading any Page credential with the service role.
    const tenant = await db.from('tenants').select('id').eq('page_id', pageId).maybeSingle()
    if (tenant.error) throw tenant.error
    if (!tenant.data || !(await canAccessTenant(actor, tenant.data.id, 'owner')))
      return failure('ไม่มีสิทธิ์จัดการเพจนี้', 403)
    const rate = await db.rpc('commerce_rate_limit', {
      p_bucket: `facebook-live:${tenant.data.id}:${actor.id}`,
      p_max: 12,
    })
    if (rate.error) throw rate.error
    if (rate.data !== true) return failure('รีเฟรชรายการถี่เกินไป กรุณารอสักครู่', 429)
    const saved = await db
      .from('tenants')
      .select('page_id,page_access_token')
      .eq('id', tenant.data.id)
      .eq('page_id', pageId)
      .maybeSingle()
    if (saved.error) throw saved.error
    if (!saved.data) return failure('การเชื่อมต่อเพจเปลี่ยนไป กรุณาโหลดหน้าใหม่', 409)
    const token = pageTokenFor(saved.data)
    if (!token) return failure('ยังไม่ได้เชื่อมต่อ Facebook กรุณาเชื่อมต่อเพจในตั้งค่าร้านค้า', 409)
    const videos = await fetchPageLiveVideos(pageId, token, req.signal)
    return NextResponse.json({ pageId, videos }, { headers })
  } catch (error) {
    if (error instanceof LiveVideosError) return failure(error.message, error.status)
    // Provider/database errors may contain credentials; never forward or log them.
    return failure('โหลดรายการไลฟ์สดไม่สำเร็จ กรุณาลองใหม่อีกครั้ง', 503)
  }
}
