'use client'

import type { FeatureAccess } from '@/lib/feature-access'
import { LockKeyhole } from 'lucide-react'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  ShieldCheck,
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
  {
    href: '/settings',
    label: 'ตั้งค่า',
    icon: Settings,
    children: [{ href: '/settings', label: 'ตั้งค่า Facebook Page' }],
  },
]

const isActive = (pathname: string, href: string) =>
  pathname === href || (href !== '/settings' && pathname.startsWith(href + '/'))
const groupActive = (pathname: string, item: NavItem) =>
  !!item.children?.some((c) => isActive(pathname, c.href))

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
 * Inbox uses a desktop icon rail; smaller screens use a drawer.
 * Server-rendered pieces (active Page) come in as slots so they keep their RSC data.
 */
export function AppShell({
  page,
  email,
  children,
  isPlatformAdmin = false,
  access,
  accessExpiresAt,
  messagesRemaining,
}: {
  page: ReactNode
  email: string
  children: ReactNode
  isPlatformAdmin?: boolean
  access?: FeatureAccess
  accessExpiresAt?: string | null
  messagesRemaining?: number | null
}) {
  const pathname = usePathname()
  const router = useRouter()
  const lockedPaths = [
    ...(!access?.ai_agent ? ['/chatbot/conversations'] : []),
    ...(!access?.image_assistant ? ['/chatbot/images'] : []),
    ...(!access?.customer_management ? ['/customers', '/inbox'] : []),
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
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [sidebarFocused, setSidebarFocused] = useState(false)
  const inboxRail = pathname === '/inbox'
  const sidebarCollapsed = inboxRail && !sidebarHovered && !sidebarFocused
  const drawerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!drawer) return
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const desktop = window.matchMedia('(min-width: 1024px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setDrawer(false)
    }
    const focusable = () =>
      Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0)
    focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setDrawer(false)
      }
      if (event.key !== 'Tab') return
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1)
      if (!first || !last) {
        event.preventDefault()
        return
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    desktop.addEventListener('change', closeOnDesktop)
    closeOnDesktop()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      desktop.removeEventListener('change', closeOnDesktop)
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [drawer])

  useEffect(() => {
    setDrawer(false)
    setSidebarHovered(false)
    setSidebarFocused(false)
  }, [pathname])

  const sidebar = (collapsed: boolean) => (
    <div
      className={cn(
        'flex h-full flex-col gap-4 overflow-hidden bg-linear-to-b from-orange-500 via-orange-500 to-pink-500 text-white',
        collapsed ? 'p-3' : 'p-4',
      )}
    >
      <div className={cn('flex items-center gap-2', !collapsed && 'px-1')}>
        <Link
          href="/overview"
          title="SnapBot · หน้าหลัก"
          className="flex min-w-0 items-center gap-3 rounded-xl transition hover:opacity-90"
        >
          <Image
            src="/logo-icon.png"
            alt="SnapBot"
            width={48}
            height={48}
            sizes="48px"
            priority
            className="h-12 w-12 shrink-0 rounded-full object-contain drop-shadow-sm"
          />
          <span className={cn('min-w-0 whitespace-nowrap leading-tight', collapsed && 'sr-only')}>
            <span className="block text-base font-bold tracking-tight">SnapBot</span>
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setDrawer(false)}
          aria-label="ปิดเมนู"
          className="ml-auto rounded-lg p-1.5 text-white/80 hover:bg-white/15 lg:hidden"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className={collapsed ? 'hidden' : undefined}>{page}</div>

      <nav aria-label="เมนูหลัก" className="scrollbar-thin -mx-1 flex-1 overflow-y-auto px-1">
        <ul className="space-y-1">
          {NAV.map((item) =>
            item.children ? (
              <NavGroup
                key={item.href}
                item={item}
                pathname={pathname}
                lockedPaths={lockedPaths}
                collapsed={collapsed}
              />
            ) : (
              <NavRow
                key={item.href}
                item={item}
                pathname={pathname}
                lockedPaths={lockedPaths}
                collapsed={collapsed}
              />
            ),
          )}
        </ul>
      </nav>

      {isPlatformAdmin && (
        <Link
          href="/admin"
          title="ดูแลระบบ"
          className="flex items-center gap-2 rounded-xl bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25"
        >
          <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
          <span className={cn('whitespace-nowrap', collapsed && 'sr-only')}>ดูแลระบบ →</span>
        </Link>
      )}

      <div
        className={cn(
          'flex items-center gap-2 border-t border-white/20 pt-3',
          collapsed && 'justify-center',
        )}
      >
        <span
          className={cn(
            'h-8 w-8 shrink-0 place-items-center rounded-full bg-white/20 text-xs font-semibold',
            collapsed ? 'hidden' : 'grid',
          )}
        >
          {email.charAt(0).toUpperCase()}
        </span>
        <span
          className={cn('min-w-0 flex-1 truncate text-xs text-white/85', collapsed && 'hidden')}
          title={email}
        >
          {email}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            aria-label="ออกจากระบบ"
            title="ออกจากระบบ"
            className="rounded-lg p-2 text-white/80 hover:bg-white/15 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )

  return (
    <div className="snap-dashboard fixed inset-x-0 top-0 flex h-dvh w-full overflow-hidden bg-slate-50 text-slate-900">
      <a href="#main-content" className="skip-link">
        ข้ามไปเนื้อหาหลัก
      </a>
      <aside
        aria-label="แถบเมนู"
        inert={drawer || undefined}
        data-sidebar-state={sidebarCollapsed ? 'collapsed' : 'expanded'}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') setSidebarHovered(true)
        }}
        onPointerLeave={() => setSidebarHovered(false)}
        onFocusCapture={(event) => {
          if (event.target.matches(':focus-visible')) setSidebarFocused(true)
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setSidebarFocused(false)
        }}
        onKeyDownCapture={(event) => {
          if (!inboxRail || event.key !== 'Escape') return
          event.preventDefault()
          event.currentTarget.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.focus()
          setSidebarHovered(false)
          setSidebarFocused(false)
        }}
        className={cn(
          'relative z-30 hidden shrink-0 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block',
          inboxRail ? 'w-18' : 'w-64',
        )}
      >
        <div
          id="desktop-navigation"
          inert={drawer || undefined}
          className={cn(
            'absolute inset-y-0 left-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none',
            sidebarCollapsed ? 'w-18' : 'w-64',
            inboxRail && !sidebarCollapsed && 'shadow-2xl shadow-slate-900/20',
          )}
        >
          {sidebar(sidebarCollapsed)}
        </div>
      </aside>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm"
            onClick={() => setDrawer(false)}
          />
          <aside
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="เมนูนำทาง"
            className="drawer-enter absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl"
          >
            {sidebar(false)}
          </aside>
        </div>
      )}

      <div inert={drawer || undefined} className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 bg-linear-to-r from-orange-500 to-pink-500 px-4 text-white lg:hidden">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            aria-label="เปิดเมนู"
            aria-expanded={drawer}
            className="rounded-lg p-1.5 hover:bg-white/15"
          >
            <Menu className="h-5 w-5" />
          </button>
          <span className="text-sm font-semibold">{currentLabel(pathname)}</span>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            'flex min-h-0 flex-1 flex-col',
            pathname === '/inbox' ? 'overflow-hidden' : 'overflow-y-auto',
          )}
        >
          {messagesRemaining === 0 && (
            <Link
              href="/billing"
              className="m-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm font-medium text-orange-900"
            >
              เครดิตข้อความหมดแล้ว กรุณาเติมเครดิตข้อความ Broadcast S/M/L ที่หน้าแพ็กเกจและเครดิต
            </Link>
          )}
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  )
}

const rowClass = (active: boolean, collapsed = false) =>
  cn(
    'flex w-full items-center gap-3 rounded-lg py-2 text-sm transition-colors',
    collapsed ? 'justify-center px-0' : 'px-3',
    active
      ? 'bg-white font-medium text-orange-600 shadow-sm'
      : 'text-white/90 hover:bg-white/15 hover:text-white',
  )

function NavRow({
  item,
  pathname,
  lockedPaths,
  collapsed = false,
}: {
  item: NavItem
  pathname: string
  lockedPaths: string[]
  collapsed?: boolean
}) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <li>
      <Link
        href={item.href === '/slips' ? '/slips?tab=banks' : item.href}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={rowClass(active, collapsed)}
      >
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className={cn('whitespace-nowrap', collapsed && 'sr-only')}>{item.label}</span>
        {lockedPaths.includes(item.href) && (
          <LockKeyhole
            className={cn('ml-auto h-4 w-4 shrink-0', collapsed && 'sr-only')}
            aria-label="Locked"
          />
        )}
      </Link>
    </li>
  )
}

/** A menu entry with sub-pages: opens by itself while one of them is the current page. */
function NavGroup({
  item,
  pathname,
  lockedPaths,
  collapsed = false,
}: {
  item: NavItem
  pathname: string
  lockedPaths: string[]
  collapsed?: boolean
}) {
  const inside = groupActive(pathname, item)
  const [open, setOpen] = useState(inside)
  const Icon = item.icon

  useEffect(() => {
    if (inside) setOpen(true)
  }, [inside])

  return (
    <li>
      <div className="flex items-center">
        <Link
          href={item.href}
          title={item.label}
          className={rowClass(isActive(pathname, item.href), collapsed)}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span
            className={cn(
              'flex-1 whitespace-nowrap text-left text-inherit',
              inside && 'font-medium',
              collapsed && 'sr-only',
            )}
          >
            {item.label}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`แสดงเมนูย่อย ${item.label}`}
          className={cn('rounded-lg p-2 hover:bg-white/15', collapsed && 'hidden')}
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </div>
      {open && !collapsed && (
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
                    active
                      ? 'bg-white font-medium text-orange-600 shadow-sm'
                      : 'text-white/85 hover:bg-white/15 hover:text-white',
                  )}
                >
                  {c.label}
                  {lockedPaths.includes(c.href) && (
                    <LockKeyhole className="ml-2 inline h-3.5 w-3.5" aria-label="Locked" />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}
