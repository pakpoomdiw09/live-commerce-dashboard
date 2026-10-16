'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BarChart3, Receipt, Store, Wallet } from 'lucide-react'
import { FallbackImg } from '@/components/ui/FallbackImg'
import { cn } from '@/lib/utils'

const links = [
  { href: '/admin', label: 'สรุปภาพรวม', icon: BarChart3 },
  { href: '/admin/approvals', label: 'อนุมัติการชำระเงิน', icon: Receipt },
  { href: '/admin/provider', label: 'โทเค็นระบบ', icon: Wallet },
  { href: '/admin/tenants', label: 'จัดการร้านค้า', icon: Store },
]

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="bg-slate-950 p-5 text-white lg:fixed lg:inset-y-0 lg:w-64">
        <Link href="/admin" className="flex items-center gap-3"><FallbackImg src="/logo-icon.png" alt="SnapBot" size={40} className="h-10 w-10 shrink-0 rounded-xl object-contain" fallback={<span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500 text-sm font-bold text-white">SB</span>} /><span><span className="block font-semibold">SnapBot Admin</span><span className="text-xs text-slate-400">สำหรับเจ้าของระบบ</span></span></Link>
        <nav aria-label="เมนูผู้ดูแลระบบ" className="mt-6 flex flex-wrap gap-2 lg:flex-col">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === '/admin' ? pathname === href : pathname.startsWith(href)
            return <Link key={href} href={href} aria-current={active ? 'page' : undefined} className={cn('flex items-center gap-2 rounded-xl px-3 py-3 text-sm', active ? 'bg-orange-500 text-white' : 'text-slate-300 hover:bg-slate-800')}><Icon className="h-4 w-4" />{label}</Link>
          })}
        </nav>
        <Link href="/dashboard" className="mt-6 inline-block text-sm text-slate-400 hover:text-white">กลับหน้าร้านค้า →</Link>
      </aside>
      <main className="min-w-0 flex-1 lg:ml-64"><div className="mx-auto max-w-7xl space-y-6 p-4 md:p-8">{children}</div></main>
    </div>
  )
}
