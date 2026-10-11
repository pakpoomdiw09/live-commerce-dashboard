'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { LayoutDashboard, LogOut, Menu, MessageSquareReply, MessagesSquare, ReceiptText, Settings, Users, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type NavItem = { href: string; label: string; icon: LucideIcon }

const MAIN_NAV: NavItem[] = [
  { href: '/overview', label: 'แดชบอร์ดสรุปยอด', icon: LayoutDashboard },
  { href: '/inbox', label: 'กล่องข้อความรวม', icon: MessagesSquare },
  { href: '/slips', label: 'ตรวจสอบสลิป', icon: ReceiptText },
  { href: '/customers', label: 'จัดการลูกค้า', icon: Users },
  { href: '/settings', label: 'ตั้งค่าร้านค้า & บัญชี', icon: Settings },
]
const MORE_NAV: NavItem[] = [{ href: '/comment-replies', label: 'ตอบกลับคอมเมนต์', icon: MessageSquareReply }]

/**
 * Sidebar + content. The sidebar is static from lg up and a slide-over drawer below.
 * Server-rendered pieces (switcher, credits) come in as slots so they keep their RSC data.
 */
export function AppShell({ switcher, credits, email, children }: { switcher: ReactNode; credits: ReactNode; email: string; children: ReactNode }) {
  const pathname = usePathname()
  const [drawer, setDrawer] = useState(false)

  // close the drawer after navigating
  useEffect(() => setDrawer(false), [pathname])

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2.5 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-linear-to-br from-emerald-500 to-teal-600 text-sm font-bold text-white shadow-sm">LC</span>
        <span className="min-w-0 leading-tight">
          <span className="block text-sm font-semibold text-slate-900">LiveCommerce</span>
          <span className="block text-[11px] text-slate-500">Slip Automation Platform</span>
        </span>
        <button type="button" onClick={() => setDrawer(false)} aria-label="ปิดเมนู" className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      {switcher}

      <nav aria-label="เมนูหลัก" className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
        <NavList items={MAIN_NAV} pathname={pathname} />
        <p className="mt-6 mb-2 px-3 text-[11px] font-medium tracking-wide text-slate-400 uppercase">เครื่องมือเพิ่มเติม</p>
        <NavList items={MORE_NAV} pathname={pathname} />
      </nav>

      {credits}

      <div className="flex items-center gap-2 border-t border-slate-200 pt-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">{email.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-600" title={email}>
          {email}
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" aria-label="ออกจากระบบ" title="ออกจากระบบ" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-rose-600">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh bg-slate-50 text-slate-900">
      <aside aria-label="แถบเมนู" className="hidden w-64 shrink-0 border-r border-slate-200 bg-slate-50/80 lg:block">
        {sidebar}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside aria-label="แถบเมนู" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-slate-50 shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="เปิดเมนู" className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{[...MAIN_NAV, ...MORE_NAV].find((n) => isActive(pathname, n.href))?.label ?? 'LiveCommerce'}</span>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/')

function NavList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href)
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                active ? 'bg-white font-medium text-emerald-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900',
              )}
            >
              <Icon className={cn('h-4 w-4', active ? 'text-emerald-600' : 'text-slate-400')} aria-hidden />
              {label}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
