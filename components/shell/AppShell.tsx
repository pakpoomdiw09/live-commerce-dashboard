'use client'

import type { FeatureAccess } from '@/lib/feature-access'
import { LockKeyhole } from 'lucide-react'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import {
  BarChart3,
  Bot,
  ChevronDown,
  CreditCard,
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
import { PageTransition } from '@/components/shell/PageTransition'
import Image from 'next/image'
import { cn } from '@/lib/utils'

type NavLink = { href: string; label: string }
type NavItem = NavLink & { icon: LucideIcon; children?: NavLink[] }

const NAV: NavItem[] = [
  { href: '/overview', label: 'หน้าหลัก', icon: House },
  { href: '/slips', label: 'ตรวจสอบสลิป', icon: CreditCard },
  {
    href: '/chatbot',
    label: 'แชทบอท / AI Agents',
    icon: Bot,
    children: [
      { href: '/chatbot/conversations', label: 'ผู้ช่วยตอบบทสนทนา' },
      { href: '/comment-replies', label: 'ตอบกลับคอมเมนต์' },
      { href: '/chatbot/images', label: 'ผู้ช่วยตอบรูปภาพ' },
      { href: '/chatbot/follow-ups', label: 'ผู้ช่วยติดตามลูกค้า' },
      { href: '/customers', label: 'รายชื่อลูกค้า' },
    ],
  },
  { href: '/broadcast', label: 'บรอดแคสต์', icon: Megaphone },
  { href: '/shop', label: 'ร้านค้า / เซลเพจ', icon: Store },
  { href: '/inbox', label: 'รวมแชท', icon: MessagesSquare },
  { href: '/analytics', label: 'วิเคราะห์', icon: BarChart3 },
  { href: '/billing', label: 'แพ็กเกจ & เครดิต', icon: CreditCard },
  { href: '/settings', label: 'ตั้งค่า', icon: Settings, children: [
    { href: '/settings', label: 'ตั้งค่า Facebook Page' },
  ] },
]

const isActive = (pathname: string, href: string) => pathname === href || (href !== '/settings' && pathname.startsWith(href + '/'))
const groupActive = (pathname: string, item: NavItem) => !!item.children?.some((c) => isActive(pathname, c.href))

/** Label of the current page for the mobile header. */
function currentLabel(pathname: string) {
  for (const item of NAV) {
    const child = item.children?.find((c) => isActive(pathname, c.href))
    if (child) return child.label
    if (!item.children && isActive(pathname, item.href)) return item.label
  }
  return 'SnapBot'
}

/**
 * Sidebar + content. The sidebar is static from lg up and a slide-over drawer below.
 * Server-rendered pieces (active Page) come in as slots so they keep their RSC data.
 */
export function AppShell({ page, email, children, isPlatformAdmin = false, access, accessExpiresAt, messagesRemaining }: { page: ReactNode; email: string; children: ReactNode; isPlatformAdmin?: boolean; access?: FeatureAccess; accessExpiresAt?: string | null; messagesRemaining?: number | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const lockedPaths = [
    ...(!access?.ai_agent ? ['/chatbot/conversations'] : []),
    ...(!access?.image_assistant ? ['/chatbot/images'] : []),
    ...(!access?.customer_management ? ['/customers','/inbox'] : []),
    ...(!access?.slip_auto_pilot ? ['/slips'] : []),
    ...(!access?.customer_follow_up ? ['/chatbot/follow-ups'] : []),
  ]
  useEffect(() => {
    if (!accessExpiresAt) return
    const remaining = Date.parse(accessExpiresAt) - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(() => router.refresh(), Math.min(remaining + 100, 2147483647))
    return () => clearTimeout(timer)
  }, [accessExpiresAt, router])
  const [drawer, setDrawer] = useState(false)

  // close the drawer after navigating
  useEffect(() => setDrawer(false), [pathname])

  const sidebar = (
    <div className="flex h-full flex-col gap-4 bg-linear-to-b from-orange-500 via-orange-500 to-pink-500 p-4 text-white">
      <div className="flex items-center gap-2 px-1">
        <Link href="/overview" className="flex min-w-0 items-center gap-3 rounded-xl transition hover:opacity-90">
          <Image
            src="/logo-icon.png"
            alt="SnapBot"
            width={48}
            height={48}
            sizes="48px"
            priority
            className="h-12 w-12 shrink-0 rounded-full object-contain drop-shadow-sm"
          />
          <span className="min-w-0 leading-tight">
            <span className="block text-base font-bold tracking-tight">SnapBot</span>
          </span>
        </Link>
        <button type="button" onClick={() => setDrawer(false)} aria-label="ปิดเมนู" className="ml-auto rounded-lg p-1.5 text-white/80 hover:bg-white/15 lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      {page}

      <nav aria-label="เมนูหลัก" className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
        <ul className="space-y-0.5">
          {NAV.map((item) => (item.children ? <NavGroup key={item.href} item={item} pathname={pathname} lockedPaths={lockedPaths} /> : <NavRow key={item.href} item={item} pathname={pathname} lockedPaths={lockedPaths} />))}
        </ul>
      </nav>

      {isPlatformAdmin && <Link href="/admin" className="rounded-xl bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25">ดูแลระบบ →</Link>}

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
        <main className={cn('flex min-h-0 flex-1 flex-col',pathname==='/inbox'?'overflow-hidden':'overflow-y-auto')}>
          {messagesRemaining === 0 && <Link href="/billing" className="m-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm font-medium text-orange-900">เครดิตข้อความหมดแล้ว กรุณาเติมเครดิตข้อความ Broadcast S/M/L ที่หน้าแพ็กเกจและเครดิต</Link>}
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}

const rowClass = (active: boolean) =>
  cn(
    'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
    active ? 'bg-white font-medium text-orange-600 shadow-sm' : 'text-white/90 hover:bg-white/15 hover:text-white',
  )

function NavRow({ item, pathname, lockedPaths }: { item: NavItem; pathname: string; lockedPaths: string[] }) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <li>
      <Link href={item.href === '/slips' ? '/slips?tab=banks' : item.href} aria-current={active ? 'page' : undefined} className={rowClass(active)}>
        <Icon className="h-4 w-4" aria-hidden />
        {item.label}{lockedPaths.includes(item.href) && <LockKeyhole className="ml-auto h-4 w-4" aria-label="Locked" />}
      </Link>
    </li>
  )
}

/** A menu entry with sub-pages: opens by itself while one of them is the current page. */
function NavGroup({ item, pathname, lockedPaths }: { item: NavItem; pathname: string; lockedPaths: string[] }) {
  const inside = groupActive(pathname, item)
  const [open, setOpen] = useState(inside)
  const Icon = item.icon

  useEffect(() => {
    if (inside) setOpen(true)
  }, [inside])

  return (
    <li>
      <div className="flex items-center">
      <Link href={item.href} className={rowClass(isActive(pathname, item.href))}>
        <Icon className="h-4 w-4" aria-hidden />
        <span className={cn('flex-1 text-left text-inherit', inside && 'font-medium')}>{item.label}</span>
      </Link>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`แสดงเมนูย่อย ${item.label}`} className="rounded-lg p-2 hover:bg-white/15"><ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden /></button>
      </div>
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
                  {c.label}{lockedPaths.includes(c.href) && <LockKeyhole className="ml-2 inline h-3.5 w-3.5" aria-label="Locked" />}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
