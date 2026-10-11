'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  BarChart3,
  Bot,
  ChevronDown,
  House,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  Settings,
  Store,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

type NavLink = { href: string; label: string }
type NavItem = NavLink & { icon: LucideIcon; children?: NavLink[] }

const NAV: NavItem[] = [
  { href: '/overview', label: 'หน้าหลัก', icon: House },
  {
    href: '/chatbot',
    label: 'แชทบอท / AI Agents',
    icon: Bot,
    children: [
      { href: '/chatbot/conversations', label: 'ผู้ช่วยตอบบทสนทนา' },
      { href: '/comment-replies', label: 'ตอบกลับคอมเมนต์' },
      { href: '/chatbot/images', label: 'ผู้ช่วยตอบรูปภาพ' },
      { href: '/customers', label: 'ผู้ช่วยติดตามลูกค้า' },
      { href: '/slips', label: 'ผู้ช่วยจัดการออเดอร์' },
    ],
  },
  { href: '/broadcast', label: 'บรอดแคสต์', icon: Megaphone },
  { href: '/shop', label: 'ร้านค้า / เซลเพจ', icon: Store },
  { href: '/inbox', label: 'รวมแชท', icon: MessagesSquare },
  { href: '/analytics', label: 'วิเคราะห์', icon: BarChart3 },
  { href: '/settings', label: 'ตั้งค่า', icon: Settings },
]

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/')
const groupActive = (pathname: string, item: NavItem) => !!item.children?.some((c) => isActive(pathname, c.href))

/** Label of the current page for the mobile header. */
function currentLabel(pathname: string) {
  for (const item of NAV) {
    const child = item.children?.find((c) => isActive(pathname, c.href))
    if (child) return child.label
    if (!item.children && isActive(pathname, item.href)) return item.label
  }
  return 'LiveCommerce'
}

/**
 * Sidebar + content. The sidebar is static from lg up and a slide-over drawer below.
 * Server-rendered pieces (active Page, credits) come in as slots so they keep their RSC data.
 */
export function AppShell({ page, credits, email, children }: { page: ReactNode; credits: ReactNode; email: string; children: ReactNode }) {
  const pathname = usePathname()
  const [drawer, setDrawer] = useState(false)

  // close the drawer after navigating
  useEffect(() => setDrawer(false), [pathname])

  const sidebar = (
    <div className="flex h-full flex-col gap-4 bg-linear-to-b from-orange-500 via-orange-500 to-pink-500 p-4 text-white">
      <div className="flex items-center gap-2.5 px-1">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-sm font-bold text-orange-600 shadow-sm">LC</span>
        <span className="min-w-0 leading-tight">
          <span className="block text-sm font-semibold">LiveCommerce</span>
          <span className="block text-[11px] text-white/75">Chatbot & Live Commerce</span>
        </span>
        <button type="button" onClick={() => setDrawer(false)} aria-label="ปิดเมนู" className="ml-auto rounded-lg p-1.5 text-white/80 hover:bg-white/15 lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      {page}

      <nav aria-label="เมนูหลัก" className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
        <ul className="space-y-0.5">
          {NAV.map((item) => (item.children ? <NavGroup key={item.href} item={item} pathname={pathname} /> : <NavRow key={item.href} item={item} pathname={pathname} />))}
        </ul>
      </nav>

      {credits}

      <div className="flex items-center gap-2 border-t border-white/20 pt-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-xs font-semibold">{email.charAt(0).toUpperCase()}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-white/85" title={email}>
          {email}
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" aria-label="ออกจากระบบ" title="ออกจากระบบ" className="rounded-lg p-2 text-white/80 hover:bg-white/15 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="flex h-dvh bg-slate-50 text-slate-900">
      <aside aria-label="แถบเมนู" className="hidden w-64 shrink-0 lg:block">
        {sidebar}
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div aria-hidden className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside aria-label="แถบเมนู" className="absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 bg-linear-to-r from-orange-500 to-pink-500 px-4 text-white lg:hidden">
          <button type="button" onClick={() => setDrawer(true)} aria-label="เปิดเมนู" className="rounded-lg p-1.5 hover:bg-white/15">
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{currentLabel(pathname)}</span>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}

const rowClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    active ? 'bg-white font-medium text-orange-600 shadow-sm' : 'text-white/90 hover:bg-white/15 hover:text-white',
  )

function NavRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <li>
      <Link href={item.href} aria-current={active ? 'page' : undefined} className={rowClass(active)}>
        <Icon className="h-4 w-4" aria-hidden />
        {item.label}
      </Link>
    </li>
  )
}

/** A menu entry with sub-pages: opens by itself while one of them is the current page. */
function NavGroup({ item, pathname }: { item: NavItem; pathname: string }) {
  const inside = groupActive(pathname, item)
  const [open, setOpen] = useState(inside)
  const Icon = item.icon

  useEffect(() => {
    if (inside) setOpen(true)
  }, [inside])

  return (
    <li>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={rowClass(false)}>
        <Icon className="h-4 w-4" aria-hidden />
        <span className={cn('flex-1 text-left', inside && 'font-medium text-white')}>{item.label}</span>
        <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="mt-0.5 ml-5 space-y-0.5 border-l border-white/25 pl-2">
          {item.children!.map((c) => {
            const active = isActive(pathname, c.href)
            return (
              <li key={c.href}>
                <Link
                  href={c.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block rounded-lg px-3 py-1.5 text-[13px] transition-colors',
                    active ? 'bg-white font-medium text-orange-600 shadow-sm' : 'text-white/85 hover:bg-white/15 hover:text-white',
                  )}
                >
                  {c.label}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
