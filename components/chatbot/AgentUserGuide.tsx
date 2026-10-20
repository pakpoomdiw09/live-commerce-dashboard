'use client'

import {useRef} from 'react'
import Link from 'next/link'
import type {AgentFlags} from '@/lib/features/agents/agent-control-core'

export const agentTabs = [
  ['ภาพรวม', 'ตรวจสถานะระบบ เครดิต AI และผลการทำงานล่าสุดก่อนเริ่มดูแลร้าน'],
  ['กฎของทางร้าน', 'จัดการประเภท รายละเอียด และสถานะกฎในตาราง เพื่อให้ผู้ช่วยใช้ตอบลูกค้า'],
  ['ตั้งค่าคำตอบอัตโนมัติ', 'ตั้งคำตอบและการส่งต่อแอดมิน พร้อมทดลองแชทในการ์ดด้านล่าง'],
  ['ส่งต่อให้แอดมิน', 'รับแชท พักบอท หรือคืนบทสนทนาให้บอทเมื่อพร้อม'],
] as const

export const flagLabels: Record<Exclude<keyof AgentFlags, 'agent_analytics_enabled' | 'agent_knowledge_base_enabled'>, string> = {
  agent_control_center_enabled: 'ศูนย์ควบคุมผู้ช่วย AI',
  agent_orchestrator_enabled: 'ระบบจัดลำดับการตอบข้อความ',
  agent_playground_enabled: 'การจำลองคำตอบ',
  agent_advanced_guardrails_enabled: 'การตรวจความปลอดภัยขั้นสูง',
}

export function AgentUserGuide({flags}: {flags?: AgentFlags}) {
  const dialog = useRef<HTMLDialogElement>(null)
  return <>
    <button type="button" className="mt-4 rounded-xl border border-white/60 px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4" onClick={() => dialog.current?.showModal()}>คู่มือการใช้งาน</button>
    <dialog ref={dialog} aria-labelledby="agent-guide-title" className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 text-slate-800 shadow-xl backdrop:bg-black/50 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <h2 id="agent-guide-title" className="text-xl font-bold">คู่มือสำหรับเจ้าของร้านและแอดมิน</h2>
        <button type="button" autoFocus aria-label="ปิดคู่มือการใช้งาน" className="shrink-0 rounded-lg border px-3 py-2 text-sm" onClick={() => dialog.current?.close()}>ปิดคู่มือ</button>
      </div>
      <h3 className="mt-6 font-semibold">เริ่มต้นใช้งาน 6 ขั้นตอน</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-relaxed">
        <li>เชื่อมต่อและเลือกเพจเฟซบุ๊กใน<Link href="/select-page" className="text-orange-700 underline">หน้าเลือกเพจ</Link> ตรวจว่าเลือกเพจของร้านถูกต้อง</li>
        <li>ใน “กฎของทางร้าน” กด “เพิ่มกฎข้อใหม่” ใส่เงื่อนไข รอบส่ง ค่าบริการ หรือน้ำเสียงที่ต้องการ แล้วกด “บันทึกกฎข้อนี้” ใช้เมนูสินค้าเพื่ออ้างอิงราคาและสต็อกจริง</li>
        <li>ใน “ตั้งค่าคำตอบอัตโนมัติ” เพิ่มคำถามที่พบบ่อย คำตอบ และลำดับความสำคัญ แล้วบันทึก</li>
        <li>ในหน้า “ตั้งค่าคำตอบอัตโนมัติ” เลื่อนลงไปที่การ์ด “ทดลองตอบด้วย AI” ใต้การ์ดตั้งค่าด้านซ้าย พิมพ์คำถามจำลองเพื่อดูคำตอบ โดยไม่ส่งให้ลูกค้าจริงหรือบันทึกลงกล่องข้อความเพจ</li>
        <li>การทดลอง AI จริงต้องมีสิทธิ์แพ็กเกจและตั้งค่าบริการ AI บนเซิร์ฟเวอร์ โดยอาจมีค่าใช้จ่ายจากผู้ให้บริการ</li>
        <li>เมื่อพร้อม ตรวจโหมดตอบและสวิตช์บอทที่แถบเมนูหรือหน้าตั้งค่า แล้วติดตามงานในภาพรวมและรายการส่งต่อแอดมิน</li>
      </ol>
      <h3 className="mt-6 font-semibold">แต่ละเมนูใช้ทำอะไร</h3>
      <dl className="mt-3 space-y-3 text-sm">{agentTabs.map(([name,description]) => <div key={name}><dt className="font-semibold">{name}</dt><dd className="mt-1 text-slate-600">{description}</dd></div>)}</dl>
      <div className="mt-6 space-y-4 text-sm leading-relaxed">
        <section><h3 className="font-semibold">เพิ่มข้อมูลให้ AI</h3><p>เพิ่ม “กฎของทางร้าน” ได้ทีละข้อ สูงสุด 200 ข้อ และไม่เกิน 50,000 ตัวอักษรรวมข้อมูลจัดเก็บ แก้ไขหรือลบแต่ละข้อได้ ผู้ช่วยอ่านเฉพาะกฎที่เปิดใช้งานล่าสุดของร้านก่อนตอบ ไม่ต้องกรอกคำถามและคำตอบเป็นคู่ ข้อมูลตัวอย่างไม่ใช่นโยบายจริง ห้ามใส่รหัสลับหรือโทเค็น</p></section>
        <section><h3 className="font-semibold">สร้างคำตอบและส่งต่อให้แอดมิน</h3><p>เปิด “ตั้งค่าคำตอบอัตโนมัติ” เพื่อจัดการคำตอบ ระบุคำค้น เช่น “ค่าส่ง” และคำตอบจริง กฎที่ตรงเงื่อนไขมีลำดับก่อน AI ตั้งคำส่งต่อ เช่น “ขอคุยกับเจ้าหน้าที่” ในส่วนส่งต่อแอดมินของหน้าเดียวกัน เมื่อรับแชท ระบบจะหยุด AI สำหรับแชทนั้น ใช้ “คืนให้บอท” เมื่อพร้อม โดยคืนไม่ได้หากลูกค้าปฏิเสธการตอบอัตโนมัติ</p></section>
        <section><h3 className="font-semibold">ติดตามงานและจัดการการตอบ</h3><p>ติดตามสถานะผู้ช่วย AI และโควตาคงเหลือได้ใน “ภาพรวม” หากต้องการพักบทสนทนาให้ใช้ “พักบอท” หรือ “รับแชท” และใช้สวิตช์บอทที่แถบเมนูหรือหน้าตั้งค่าเพื่อปิดการตอบอัตโนมัติทั้งเพจ</p></section>
      </div>
      <h3 className="mt-6 font-semibold">ความพร้อมของฟีเจอร์ในร้านนี้</h3>
      {flags ? <ul className="mt-3 space-y-2 text-sm">{Object.entries(flagLabels).map(([key,label]) => <li key={key}>{label}: <strong>{flags[key as keyof AgentFlags] ? 'เปิดใช้งาน' : 'ยังไม่เปิดใช้งาน'}</strong></li>)}</ul> : <p className="mt-2 text-sm">กำลังโหลดสถานะ หากโหลดไม่สำเร็จจะยังยืนยันความพร้อมไม่ได้</p>}
      <p className="mt-4 text-sm text-slate-600">สถานะฟีเจอร์ไม่ได้ยืนยันว่าการส่งจริงพร้อมใช้งาน ต้องมีสิทธิ์เพจ โควตา และการอนุญาตส่งจากระบบครบถ้วน เจ้าของร้านหรือผู้ดูแลที่มีสิทธิ์เท่านั้นจึงบันทึกคำสั่งและฐานความรู้ได้</p>
    </dialog>
  </>
}
