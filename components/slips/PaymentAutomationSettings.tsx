'use client'
import { useRef, useState } from 'react'
import { Switch } from '@/components/ui/Switch'
import { Button } from '@/components/ui/button'
import { ErrorMessage, SuccessToast } from '@/components/ui/feedback'
export function PaymentAutomationSettings({
  tenantId,
  autoVerify,
  autoReply,
}: {
  tenantId: string
  autoVerify: boolean
  autoReply: boolean
}) {
  const [verify, setVerify] = useState(autoVerify),
    [reply, setReply] = useState(autoReply),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('')
  const locked = useRef(false)
  async function save() {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const response = await fetch(`/api/tenants/${tenantId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ auto_verify_enabled: verify, auto_reply_enabled: reply }),
        }),
        value = await response.json()
      if (!response.ok) throw Error(value.error || 'บันทึกไม่ได้')
      setNotice('บันทึกสวิตช์ระบบแล้ว ไม่มีการส่งข้อความจากหน้านี้')
    } catch (error) {
      setError(error instanceof Error ? error.message : 'บันทึกไม่ได้')
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-5 rounded-2xl border border-orange-100 bg-white p-5">
        <h2 className="font-bold">ตั้งค่าระบบอัตโนมัติ</h2>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {notice && <SuccessToast>{notice}</SuccessToast>}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">ตรวจสลิปอัตโนมัติ</p>
            <p className="mt-1 text-xs text-slate-500">
              ใช้ ผู้ให้บริการตรวจสอบ เดิมและเครดิตจาก ระบบส่วนกลาง การเปิดใช้ต้องผ่านสิทธิ์แพ็กเกจ
            </p>
          </div>
          <Switch checked={verify} disabled={busy} onChange={setVerify} label="ตรวจสลิปอัตโนมัติ" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">ตอบกลับอัตโนมัติของร้าน</p>
            <p className="mt-1 text-xs text-slate-500">
              เป็นสวิตช์ตอบแชททั้งเพจ ไม่ใช่เฉพาะข้อความยืนยันสลิป และยังต้องผ่านสิทธิ์ส่ง สถานะแชท
              และโควตา
            </p>
          </div>
          <Switch
            checked={reply}
            disabled={busy}
            onChange={setReply}
            label="ตอบกลับอัตโนมัติของร้าน"
          />
        </div>
        <Button
          className="bg-orange-500 hover:bg-orange-600"
          loading={busy}
          onClick={() => void save()}
        >
          บันทึกสวิตช์ระบบ
        </Button>
      </section>
      <section className="space-y-3 rounded-2xl border border-orange-100 bg-orange-50/40 p-5">
        <h2 className="font-bold">หลังได้รับผลยืนยันจากผู้ให้บริการ</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm">
          <li>ตรวจสอบเลขอ้างอิงที่ซ้ำกัน ยอดเงิน และบัญชีที่รับเงินจริง</li>
          <li>
            ระบบตรวจสอบการชำระเงินจะตรวจสอบออเดอร์และเปลี่ยนสถานะการชำระเงินในรายการเดิมเมื่อผ่านเงื่อนไขทั้งหมด
          </li>
          <li>ยกเลิกงานติดตามยอดค้างชำระตามกลไกเดิม</li>
          <li>
            การส่งข้อความยืนยันต้องผ่านเงื่อนไขการส่งข้อความจริงของระบบและแพ็กเกจ
            รวมถึงสิทธิ์ของช่องทางและสถานะการรับแชทของแอดมิน
          </li>
        </ol>
        <p className="text-xs text-slate-500">
          การสร้าง QR และการเปิดหน้านี้จะไม่หักเครดิต ไม่เปลี่ยนสถานะออเดอร์ และไม่ส่งข้อความจริง
          ส่วนการกำหนดข้อความยืนยันแยกตามช่องทางยังไม่เปิดใช้งานในหน้านี้
        </p>
      </section>
    </div>
  )
}
