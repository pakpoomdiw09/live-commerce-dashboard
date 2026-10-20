import Link from 'next/link'
import type {TenantRow} from '@/lib/types'
import {PLANS,type Billing} from '@/lib/features/billing/plans'
export async function PaymentChannelStatus({tenant,billing,security,canManage}:{tenant:TenantRow;billing:Billing;security:boolean;canManage:boolean}){
 const configured=!!process.env.SLIPOK_API_KEY?.trim()&&!!process.env.SLIPOK_BRANCH_ID?.trim()
 const fields=[['บริการตรวจสลิป',configured?'ตั้งค่าไว้แล้ว':'ยังตั้งค่าไม่ครบ'],['แพ็กเกจปัจจุบัน',PLANS[billing.plan].name],['เครดิตตรวจสลิปคงเหลือ',Math.max(0,tenant.slip_quota+tenant.slip_quota_credits-tenant.slip_used).toLocaleString('th-TH')],['ผู้ที่จัดการบัญชีและ QR ได้',canManage?'เจ้าของร้าน / แอดมินที่มีสิทธิ์':'ดูสถานะได้ แต่ดูเลขบัญชีเต็มหรือแก้ QR ไม่ได้']]
 return <div className="grid min-w-0 gap-5 lg:grid-cols-2">
  <section className="space-y-4 rounded-2xl border border-orange-100 bg-white p-5"><h2 className="font-bold">{security?'ความปลอดภัยของร้าน':'การเชื่อมต่อและเครดิต'}</h2><dl className="space-y-3 text-sm">{fields.map(([label,value])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>)}</dl><Link href="/billing" className="inline-block text-sm text-orange-700 underline">ดูแพ็กเกจและเติมเครดิต</Link></section>
  <section className="space-y-3 rounded-2xl border border-orange-100 bg-orange-50/40 p-5"><h2 className="font-bold">เงื่อนไขการตรวจสลิป</h2><ul className="list-disc space-y-3 pl-5 text-sm"><li>ระบบตรวจสอบข้อมูลการโอนอัตโนมัติ ผ่านการเชื่อมต่อกับระบบธนาคาร เพื่อตรวจสอบและยืนยันว่าได้รับเงินจริง</li><li>ช่วยตรวจจับสลิปปลอมและสลิปซ้ำ โดยเช็กยอดเงิน, บัญชีที่รับโอน, และเลขอ้างอิงธนาคาร</li><li>ถ้ามียอดเงินไม่ตรง โอนผิดบัญชี หรือยังยืนยันผลไม่ได้ ให้แอดมินตรวจสอบก่อนยืนยันรับเงิน</li><li>ข้อมูลเชื่อมต่อระบบถูกซ่อนไว้ในหน้านี้ ผู้ดูแลระบบเป็นผู้จัดการ ส่วนบัญชีรับเงินและ QR จัดการได้โดยเจ้าของร้านหรือแอดมินที่มีสิทธิ์</li><li>QR ใช้ให้ลูกค้าสแกนจ่ายเท่านั้น ต้องตรวจสลิปก่อนยืนยันว่าเงินเข้าร้านแล้ว</li></ul><p className="text-xs text-slate-500">หมายเหตุ: หมั่นเช็กเครดิตตรวจสลิปและโควตาของผู้ให้บริการ เพื่อให้ตรวจสลิปได้ต่อเนื่อง การตั้งค่าครบไม่ได้แปลว่าเชื่อมต่อได้แล้ว</p></section>
 </div>
}
