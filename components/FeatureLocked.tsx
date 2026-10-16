import Link from 'next/link'
import { LockKeyhole } from 'lucide-react'

export function FeatureLocked() {
  return <div className="m-6 rounded-2xl border border-orange-100 bg-white p-8 text-center shadow-sm">
    <LockKeyhole className="mx-auto h-10 w-10 text-orange-500" aria-hidden />
    <h2 className="mt-4 text-xl font-semibold text-slate-900">ฟีเจอร์นี้สำหรับสมาชิกที่อัปเกรดแพ็กเกจ</h2>
    <p className="mx-auto mt-3 max-w-xl text-sm text-slate-600">อัปเกรดแพ็กเกจเพื่อปลดล็อก AI ผู้ช่วยตอบรูปภาพ และระบบจัดการลูกค้า เพิ่มประสิทธิภาพการขายของคุณ</p>
    <Link href="/billing" className="mt-6 inline-flex rounded-xl bg-linear-to-r from-orange-500 to-pink-500 px-5 py-3 font-medium text-white">อัปเกรดแพ็กเกจ</Link>
  </div>
}
