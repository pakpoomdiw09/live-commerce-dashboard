import Link from 'next/link'
import { Plus } from 'lucide-react'
import { getActiveTenant, getTenants, getViewer, tenantPages } from '@/lib/tenant'
import { InlineError } from '@/components/ErrorState'
import { PageCard, type PageCardData } from '@/components/select-page/PageCard'

export const metadata = { title: 'เลือกเพจ' }

/** "เลือกบอทในการใช้งาน": every Page (tenant) the user can work on, as cards. */
export default async function SelectPage() {
  const [{ tenants, error }, active, viewer] = await Promise.all([getTenants(), getActiveTenant(), getViewer()])
  const profiles = await Promise.all(tenants.map((t) => tenantPages(t).catch(() => [])))

  const cards: PageCardData[] = tenants.map((t, i) => {
    const profile = profiles[i][0]
    // Meta answered with the Page's real name: the token (own or the shared .env one) works
    const connected = !!profile && profile.name !== `เพจ ${profile.id}`
    return {
      tenantId: t.id,
      name: connected ? profile.name : t.name,
      shopName: t.name,
      picture: profile?.picture ?? null,
      connected,
      autoReply: t.auto_reply_enabled,
      creditsLeft: Math.max(t.slip_quota - t.slip_used, 0),
      active: t.id === active?.id,
    }
  })

  return (
    <div className="min-h-dvh bg-linear-to-br from-orange-500 via-rose-400 to-pink-500 p-4 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-3 text-white">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">เลือกบอทในการใช้งาน</h1>
            <p className="mt-1 text-sm text-white/85">เลือกเพจที่ต้องการจัดการ ทุกเมนูในแดชบอร์ดจะทำงานกับเพจนี้</p>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="rounded-lg px-3 py-1.5 text-sm text-white/90 ring-1 ring-white/40 hover:bg-white/15">
              ออกจากระบบ
            </button>
          </form>
        </header>

        {error && (
          <div className="mt-6">
            <InlineError title="โหลดรายชื่อเพจไม่ได้" message={error} />
          </div>
        )}

        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <li key={c.tenantId}>
              <PageCard page={c} />
            </li>
          ))}
          {viewer.isPlatformAdmin && (
            <li>
              <Link
                href="/settings?new=1"
                className="flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/60 text-white transition hover:bg-white/10"
              >
                <span className="grid h-14 w-14 place-items-center rounded-full bg-white/20">
                  <Plus className="h-7 w-7" aria-hidden />
                </span>
                <span className="text-sm font-medium">เพิ่มเพจใหม่</span>
              </Link>
            </li>
          )}
        </ul>

        {cards.length === 0 && !viewer.isPlatformAdmin && !error && (
          <p className="mt-8 rounded-2xl bg-white/15 p-6 text-center text-sm text-white">ยังไม่มีเพจที่คุณเข้าถึงได้ ติดต่อเจ้าของร้านให้เพิ่มคุณเป็นทีมงาน</p>
        )}
      </div>
    </div>
  )
}
