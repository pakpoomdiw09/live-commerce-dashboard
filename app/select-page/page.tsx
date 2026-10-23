import Link from 'next/link'
import { CheckCircle2, Plus, TriangleAlert } from 'lucide-react'
import { getActor } from '@/lib/auth'
import { isSupabaseConfigured } from '@/lib/supabase/env'
import { ConnectFacebookButton } from '@/components/select-page/ConnectFacebookButton'
import {
  getActiveTenant,
  getTenants,
  getViewer,
  tenantPageConnections,
  tenantPages,
  unlinkedFacebookPages,
} from '@/lib/tenant'
import { InlineError } from '@/components/shared/ErrorState'
import { FacebookIcon } from '@/components/ui/FacebookIcon'
import { PageCard, type PageCardData } from '@/components/select-page/PageCard'

export const metadata = { title: 'เลือกเพจ' }

type Search = { fb?: string; fb_error?: string; pages?: string; updated?: string }

/** "เลือกบอทในการใช้งาน": every Page (tenant) the user can work on, as cards, plus connecting new ones. */
export default async function SelectPage({ searchParams }: { searchParams: Promise<Search> }) {
  const [{ tenants, error }, active, viewer, actor, search] = await Promise.all([
    getTenants(),
    getActiveTenant(),
    getViewer(),
    getActor(),
    searchParams,
  ])
  const [profiles, unlinked, connections] = await Promise.all([
    Promise.all(tenants.map((t) => tenantPages(t).catch(() => []))),
    actor?.kind === 'user' ? unlinkedFacebookPages(actor.id) : Promise.resolve([]),
    tenantPageConnections(tenants),
  ])
  const canConnect = isSupabaseConfigured()

  const cards: PageCardData[] = tenants.map((t, i) => {
    const profile = profiles[i][0]
    return {
      tenantId: t.id,
      name: t.page_name ?? profile?.name ?? t.name,
      shopName: t.name,
      picture: profile?.picture ?? null,
      connectionStatus: connections.get(t.id) ?? 'unverified',
      autoReply: t.auto_reply_enabled,
      creditsLeft: Math.max(t.slip_quota + t.slip_quota_credits - t.slip_used, 0),
      active: t.id === active?.id,
    }
  })

  return (
    <div className="min-h-dvh bg-linear-to-br from-orange-500 via-rose-400 to-pink-500 p-4 sm:p-8">
      <div className="mx-0 w-full min-w-0 max-w-none ">
        <header className="flex flex-wrap items-center justify-between gap-3 text-white">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">เลือกบอทในการใช้งาน</h1>
            <p className="mt-1 text-sm text-white/85">
              เลือกเพจที่ต้องการจัดการ ทุกเมนูในแดชบอร์ดจะทำงานกับเพจนี้
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm text-white/90 ring-1 ring-white/40 hover:bg-white/15"
            >
              ออกจากระบบ
            </button>
          </form>
        </header>

        {search.fb === 'connected' && (
          <p
            role="status"
            className="mt-6 flex items-start gap-2 rounded-2xl bg-white p-4 text-sm text-emerald-800 shadow"
          >
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            เชื่อมต่อ Facebook แล้ว: พบ {search.pages ?? 0} เพจ บันทึกหรืออัปเดต{' '}
            {search.updated ?? 0} ร้าน
          </p>
        )}
        {search.fb_error && (
          <p
            role="alert"
            className="mt-6 flex items-start gap-2 rounded-2xl bg-white p-4 text-sm text-rose-700 shadow"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {search.fb_error}
          </p>
        )}
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
          {canConnect && (
            <li>
              <ConnectFacebookButton />
            </li>
          )}
          {!canConnect && viewer.isPlatformAdmin && (
            <li>
              <Link
                href="/settings?new=1"
                className="flex min-h-48 items-center justify-center rounded-2xl border-2 border-dashed border-white/60 text-white"
              >
                <Plus className="mr-2 h-5 w-5" />
                เพิ่มเพจใหม่
              </Link>
            </li>
          )}
        </ul>

        {canConnect && viewer.isPlatformAdmin && (
          <p className="mt-3 text-center text-xs text-white/85">
            หรือ{' '}
            <Link href="/settings?new=1" className="font-medium underline">
              เพิ่มร้านโดยวาง Page Access Token เอง
            </Link>
          </p>
        )}

        {unlinked.length > 0 && (
          <section className="mt-10">
            <h2 className="text-sm font-semibold text-white">
              เพจจาก Facebook ที่ยังไม่ได้เปิดร้าน
            </h2>
            <p className="mt-1 text-xs text-white/85">
              {viewer.isPlatformAdmin
                ? 'กดเปิดร้านแล้วใส่บัญชีรับเงิน ระบบจะใช้ token ของเพจให้อัตโนมัติ'
                : 'ให้ผู้ดูแลแพลตฟอร์มเปิดร้านให้ แล้วเพิ่มคุณเป็นเจ้าของร้าน'}
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {unlinked.map((p) => (
                <li
                  key={p.page_id}
                  className="flex items-center gap-3 rounded-2xl bg-white/95 p-3 shadow"
                >
                  {p.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.picture}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1877f2]/10 text-[#1877f2]">
                      <FacebookIcon className="h-5 w-5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {p.name}
                    </span>
                    <span className="block font-mono text-[11px] text-slate-500">{p.page_id}</span>
                  </span>
                  {viewer.isPlatformAdmin && (
                    <Link
                      href={`/settings?new=1&page=${p.page_id}`}
                      className="shrink-0 rounded-lg bg-linear-to-r from-orange-500 to-pink-500 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      เปิดร้าน
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {cards.length === 0 &&
          unlinked.length === 0 &&
          !canConnect &&
          !viewer.isPlatformAdmin &&
          !error && (
            <p className="mt-8 rounded-2xl bg-white/15 p-6 text-center text-sm text-white">
              ยังไม่มีเพจที่คุณเข้าถึงได้ ติดต่อเจ้าของร้านให้เพิ่มคุณเป็นทีมงาน
            </p>
          )}
      </div>
    </div>
  )
}
