'use client'

import {useRef} from 'react'
import Link from 'next/link'
import type {AgentFlags} from '@/lib/agent-control-core'

export const agentTabs = [
  ['ภาพรวม', 'ตรวจสถานะระบบ เครดิต AI และผลการทำงานล่าสุดก่อนเริ่มดูแลร้าน'],
  ['ตั้งค่าผู้ช่วย AI', 'เพิ่มคำสั่งและข้อมูลจริงของร้าน แล้วบันทึกก่อนทดลองคำตอบ'],
  ['กฎตอบกลับอัตโนมัติ', 'ตั้งคำตอบสำหรับคำถามที่พบบ่อย รวมถึงคำกระตุ้นส่งต่อให้แอดมิน'],
  ['ระบบติดตามอัตโนมัติ', 'ตรวจงานตอบข้อความ และเปิดหน้าจัดการการติดตามลูกค้า'],
  ['ทดลองตอบด้วย AI', 'จำลองแนวทางคำตอบจากกฎและข้อมูลร้าน โดยไม่ส่งข้อความหาลูกค้า'],
  ['ส่งต่อให้แอดมิน', 'รับแชท พักบอท หรือคืนบทสนทนาให้บอทเมื่อพร้อม'],
  ['สถิติและรายงาน', 'ดูผลการทำงานในช่วง 30 วันและการใช้เครดิต AI'],
  ['ความปลอดภัยและตั้งค่า', 'ตรวจสถานะฟีเจอร์และประวัติการเปลี่ยนแปลง การแก้สวิตช์และโควตาต้องให้ผู้ดูแลระบบดำเนินการ'],
] as const

export const flagLabels: Record<keyof AgentFlags, string> = {
  agent_control_center_enabled: 'ศูนย์ควบคุมผู้ช่วย AI',
  agent_orchestrator_enabled: 'ระบบจัดลำดับการตอบข้อความ',
  agent_knowledge_base_enabled: 'ฐานความรู้ของร้าน',
  agent_playground_enabled: 'การจำลองคำตอบ',
  agent_analytics_enabled: 'สถิติการทำงาน',
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
      <h3 className="mt-6 font-semibold">เริ่มต้นใช้งาน 5 ขั้นตอน</h3>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-sm leading-relaxed">
        <li>เชื่อมต่อและเลือก Facebook Page ใน<Link href="/select-page" className="text-orange-700 underline">หน้าเลือกเพจ</Link> ตรวจว่าเลือกเพจของร้านถูกต้อง</li>
        <li>ใน “ตั้งค่าผู้ช่วย AI” ใส่คำสั่ง ข้อมูลร้าน เวลาเปิดร้าน ค่าส่ง และนโยบาย ใช้เมนูสินค้าสำหรับราคาและสต็อกจริง</li>
        <li>ใน “กฎตอบกลับอัตโนมัติ” เพิ่มคำถามที่พบบ่อย คำตอบ และลำดับความสำคัญ แล้วบันทึก</li>
        <li>ใน “ทดลองตอบด้วย AI” พิมพ์คำถามและตรวจแนวทางคำตอบ โหมดนี้ไม่เรียกผู้ให้บริการ AI ไม่หักเครดิต และไม่ส่ง Messenger จึงยังไม่ใช่คำตอบจากโมเดลจริง</li>
        <li>เมื่อพร้อม ตรวจโหมดตอบใน “กฎตอบกลับอัตโนมัติ” และสวิตช์บอทที่แถบเมนูหรือหน้าตั้งค่า แล้วติดตามงานในภาพรวมและรายการส่งต่อแอดมิน</li>
      </ol>
      <h3 className="mt-6 font-semibold">แต่ละเมนูใช้ทำอะไร</h3>
      <dl className="mt-3 space-y-3 text-sm">{agentTabs.map(([name,description]) => <div key={name}><dt className="font-semibold">{name}</dt><dd className="mt-1 text-slate-600">{description}</dd></div>)}</dl>
      <div className="mt-6 space-y-4 text-sm leading-relaxed">
        <section><h3 className="font-semibold">เพิ่มข้อมูลให้ AI</h3><p>บันทึกคำสั่งก่อน จากนั้นเลือกประเภทฐานความรู้ ใส่หัวข้อและเนื้อหา เปิดใช้งานแหล่งข้อมูล แล้วกดเพิ่มฐานความรู้ ข้อมูลตัวอย่างในช่องกรอกไม่ใช่ข้อมูลร้านจริง ห้ามใส่คีย์หรือโทเค็น สามารถแก้ไขข้อมูลหรือคืนค่าคำสั่งจากประวัติเวอร์ชันได้ตามสิทธิ์</p></section>
        <section><h3 className="font-semibold">สร้างกฎตอบกลับและส่งต่อแอดมิน</h3><p>เปิด “กฎตอบกลับอัตโนมัติ” เลือกการตอบตามคีย์เวิร์ดเพื่อจัดการกฎ ระบุคำค้น เช่น “ค่าส่ง” และคำตอบจริง กฎที่ตรงเงื่อนไขมีลำดับก่อน AI ตั้งคำส่งต่อ เช่น “ขอคุยกับเจ้าหน้าที่” ในส่วนส่งต่อแอดมินของหน้าเดียวกัน เมื่อรับแชทในเมนู “ส่งต่อให้แอดมิน” ระบบจะหยุด AI และการติดตามสำหรับแชทนั้น ใช้ “คืนให้บอท” เมื่อพร้อม โดยคืนไม่ได้หากลูกค้าปฏิเสธการตอบอัตโนมัติ</p></section>
        <section><h3 className="font-semibold">ติดตามลูกค้าและดูสถิติ</h3><p>ใช้ลิงก์จัดการการติดตามลูกค้าในเมนู “ระบบติดตามอัตโนมัติ” เพื่อตรวจเวลา เงื่อนไขหยุด และสิทธิ์ช่องทางก่อนเปิดใช้ ดูจำนวนงาน ส่งแล้ว รอตรวจสอบ ส่งต่อแอดมิน และเครดิตใน “สถิติและรายงาน” รายงานคำถามยอดนิยมและค่าใช้จ่ายจากใบเรียกเก็บจริงยังไม่เปิดใช้งาน</p></section>
        <section><h3 className="font-semibold">เปิดหรือปิดอย่างปลอดภัย</h3><p>พักเฉพาะบทสนทนาด้วย “พักบอท” หรือ “รับแชท” หากต้องหยุดทั้งเพจ ให้ใช้สวิตช์บอทที่แถบเมนูหรือหน้าตั้งค่า สถานะฟีเจอร์และโควตาใน “ความปลอดภัยและตั้งค่า” เป็นข้อมูลสำหรับดูเท่านั้น การปรับโควตา สิทธิ์ และสวิตช์หยุด AI ฉุกเฉินต้องให้ผู้ดูแลระบบดำเนินการ การหยุด AI ฉุกเฉินยังคงให้กฎคีย์เวิร์ดเดิมทำงานได้</p></section>
      </div>
      <h3 className="mt-6 font-semibold">ความพร้อมของฟีเจอร์ในร้านนี้</h3>
      {flags ? <ul className="mt-3 space-y-2 text-sm">{Object.entries(flagLabels).map(([key,label]) => <li key={key}>{label}: <strong>{flags[key as keyof AgentFlags] ? 'เปิดใช้งาน' : 'ยังไม่เปิดใช้งาน'}</strong></li>)}</ul> : <p className="mt-2 text-sm">กำลังโหลดสถานะ หากโหลดไม่สำเร็จจะยังยืนยันความพร้อมไม่ได้</p>}
      <p className="mt-4 text-sm text-slate-600">สถานะฟีเจอร์ไม่ได้ยืนยันว่าการส่งจริงพร้อมใช้งาน ต้องมีสิทธิ์เพจ โควตา และการอนุญาตส่งจากระบบครบถ้วน เจ้าของร้านหรือผู้ดูแลที่มีสิทธิ์เท่านั้นจึงบันทึกคำสั่งและฐานความรู้ได้</p>
    </dialog>
  </>
}
