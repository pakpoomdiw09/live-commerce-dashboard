import { Landmark } from 'lucide-react'
import { findBank } from '@/lib/banks'
import { cn } from '@/lib/utils'
import {BankLogoImage} from './BankLogoImage'

/** Licensed local assets only; missing/unconfirmed logos use a generic bank icon. */
export function BankLogo({ code, size = 'md',className }: { code: string | null | undefined; size?: 'sm' | 'md' | 'lg';className?:string }) {
  const bank = findBank(code)
  const box = size === 'sm' ? 'h-6 w-6' : size === 'lg' ? 'h-14 w-14' : 'h-8 w-8'
  if (!bank) {
    return (
      <span className={cn('grid shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500', box,className)} title={code ?? undefined}>
        <Landmark className="h-1/2 w-1/2" role="img" aria-label="ไอคอนธนาคารสำรอง" />
      </span>
    )
  }
  return (
    <span
      title={bank.logoPath?bank.name:`${bank.name} · ใช้ไอคอนสำรองชั่วคราว`}
      data-bank-code={bank.code} data-bank-logo={bank.logoPath?'installed':'missing'}
      className={cn('grid shrink-0 place-items-center overflow-hidden rounded-xl shadow-sm',bank.logoPath?'text-white':'bg-slate-100 text-slate-500',box,className)}
      style={bank.logoPath?{ backgroundColor: bank.logoBackground??bank.color }:undefined}
    >
      {bank.logoPath?<BankLogoImage key={bank.logoPath} src={bank.logoPath} name={bank.name}/>:<Landmark className="h-1/2 w-1/2" role="img" aria-label={`ไอคอนสำรอง ${bank.name} · ยังไม่มีโลโก้ที่ยืนยันสิทธิ์และเวอร์ชัน`}/>}
    </span>
  )
}

export function bankName(code: string | null | undefined) {
  return findBank(code)?.name ?? code ?? 'ไม่ทราบธนาคาร'
}
