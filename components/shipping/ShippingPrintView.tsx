'use client'
import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { ShippingLabel } from './ShippingLabel'
import type { ShippingPrintBatch } from '@/lib/features/shipping/shipping-types'

export function ShippingPrintView({ batch }: { batch: ShippingPrintBatch }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [overflow, setOverflow] = useState(false),
    [authorized, setAuthorized] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const request = useRef(crypto.randomUUID())
  useEffect(() => {
    const reset = () => setAuthorized(false)
    window.addEventListener('afterprint', reset)
    const measure = () =>
      setOverflow(
        [...(container.current?.querySelectorAll<HTMLElement>('.shipping-label') ?? [])].some(
          (label) => label.scrollHeight > label.clientHeight + 2,
        ),
      )
    const observer = new ResizeObserver(measure)
    if (container.current) observer.observe(container.current)
    void document.fonts.ready.then(measure)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('afterprint', reset)
    }
  }, [])
  async function print() {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: batch.tenant_id,
          requestId: request.current,
          action: 'mark_print',
          batchId: batch.id,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'เปิดหน้าพิมพ์ไม่สำเร็จ')
      flushSync(() => setAuthorized(true))
      window.print()
      request.current = crypto.randomUUID()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'เปิดหน้าพิมพ์ไม่สำเร็จ')
    } finally {
      setBusy(false)
    }
  }
  const pages =
    batch.format === 'a4'
      ? Array.from({ length: Math.ceil(batch.shipments.length / 4) }, (_, index) =>
          batch.shipments.slice(index * 4, index * 4 + 4),
        )
      : batch.shipments.map((shipment) => [shipment])
  return (
    <div className={`shipping-print-root ${batch.format} ${authorized ? 'print-authorized' : ''}`}>
      <div className="shipping-print-toolbar">
        <h1>
          พิมพ์ใบปะหน้าพัสดุ •{' '}
          {batch.format === 'a4' ? 'A4 / 4 รายการต่อหน้า' : 'สติกเกอร์ 100 × 150 mm'}
        </h1>
        <p>
          เลือกขนาดกระดาษให้ตรง ตั้ง Scale 100% และปิด Headers / Footers ในหน้าพิมพ์
          ฉลากนี้ใช้จัดส่งและจัดของ ยังไม่ใช่การจองขนส่ง
        </p>
        <p>
          เวลา “พิมพ์ใบปะหน้าแล้ว” บันทึกเมื่อกดเปิดหน้าต่างพิมพ์
          ไม่ยืนยันว่างานออกจากเครื่องพิมพ์แล้ว
        </p>
        <div>
          <button type="button" disabled={busy || overflow} onClick={() => void print()}>
            {busy ? 'กำลังตรวจรายการ…' : 'พิมพ์ / บันทึก PDF'}
          </button>{' '}
          <a href="/shipping">กลับหน้าจัดส่ง</a>
        </div>
        {overflow && (
          <p role="alert">
            ข้อความยาวเกินพื้นที่ฉลาก
            กรุณาปรับที่อยู่หรือหมายเหตุในหน้าจัดส่งและเตรียมฉลากใหม่ก่อนพิมพ์
          </p>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
      <div ref={container} className="shipping-print-pages">
        {pages.map((shipments, index) => (
          <section className="shipping-sheet" key={index}>
            {shipments.map((shipment) => (
              <ShippingLabel key={shipment.id} shipment={shipment} sender={batch.sender} />
            ))}
          </section>
        ))}
      </div>
      <p className="shipping-print-warning">
        กรุณาใช้ปุ่ม “พิมพ์ / บันทึก PDF” บนหน้าเว็บ เพื่อตรวจยอดและที่อยู่ล่าสุดก่อนพิมพ์ฉลาก
      </p>
      <style>{`
      @page { size: ${batch.format === 'a4' ? 'A4' : '100mm 150mm'}; margin: ${batch.format === 'a4' ? '8mm' : '0'}; }
      .shipping-print-root { background:#edf1f5; color:#000; min-height:100vh; font-family:Tahoma,Arial,sans-serif; }
      .shipping-print-toolbar { max-width:900px; padding:24px; margin:auto; font-size:14px; }
      .shipping-print-toolbar h1 { font-size:22px; font-weight:700; margin-bottom:10px; }
      .shipping-print-toolbar p { margin:8px 0; }.shipping-print-toolbar [role=alert] { color:#b91c1c; }
      .shipping-print-toolbar button { padding:10px 20px; background:#f97316; color:white; border-radius:10px; font-weight:bold; }.shipping-print-toolbar button:disabled { opacity:.5; }
      .shipping-print-toolbar a { margin-left:16px; text-decoration:underline; }.shipping-print-warning { display:none; }
      .shipping-sheet { margin:16px auto; background:white; box-sizing:border-box; }
      .thermal .shipping-sheet { width:100mm; height:150mm; }
      .a4 .shipping-sheet { width:194mm; height:281mm; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); gap:4mm; }
      .shipping-label { box-sizing:border-box; width:100%; height:100%; padding:4mm; display:flex; flex-direction:column; overflow:hidden; border:1px dashed #a0a0a0; font-size:11px; line-height:1.35; break-inside:avoid; }
      .label-brand { display:flex; justify-content:space-between; gap:6px; align-items:center; border-bottom:2px solid black; padding-bottom:2mm; }.label-brand strong { font-size:17px; }.label-brand span { font-size:9px; }
      .label-sender { font-size:9px; padding:2mm 0; border-bottom:1px solid black; overflow-wrap:anywhere; }
      .label-recipient { padding:2mm 0; overflow-wrap:anywhere; }.label-recipient >span { font-size:10px; }.label-recipient h2 { font-size:17px; font-weight:bold; margin:1mm 0; }.label-phone { display:block; font-size:21px; letter-spacing:.4px; }.label-recipient p { white-space:pre-wrap; font-size:13px; margin:2mm 0; line-height:1.5; }.label-recipient p.long-address { font-size:10px; }.label-recipient >b { font-size:11px; }
      .label-pick { border-top:1px dashed black; padding:2mm 0; font-size:9px; overflow-wrap:anywhere; }.label-pick div { line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }.label-pick span { white-space:nowrap; }
      .label-footer { margin-top:auto; border-top:1px solid black; padding-top:2mm; display:flex; align-items:center; gap:3mm; }.label-footer svg { width:20mm; height:20mm; flex-shrink:0; }.label-footer div { min-width:0; overflow-wrap:anywhere; }.label-footer span,.label-footer small { display:block; margin-top:2px; }.label-footer small { font-size:7px; }
      @media print { html,body { padding:0!important; margin:0!important; background:white!important; }.shipping-print-root { background:white; min-height:0; }.shipping-print-toolbar { display:none!important; }.shipping-print-pages { display:none; padding:0; }.print-authorized .shipping-print-pages { display:block; }.shipping-print-warning { display:block; }.print-authorized .shipping-print-warning { display:none; }.shipping-sheet { margin:0; break-after:page; page-break-after:always; }.shipping-sheet:last-child { break-after:auto; page-break-after:auto; }.thermal .shipping-label { border:0; }.shipping-label { -webkit-print-color-adjust:exact; print-color-adjust:exact; } }
      @media screen and (max-width:800px) { .shipping-print-pages { overflow-x:auto; padding:0 10px 20px; }.shipping-sheet { flex-shrink:0; } }
    `}</style>
    </div>
  )
}
