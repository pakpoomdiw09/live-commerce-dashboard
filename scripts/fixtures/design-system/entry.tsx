import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { AppShell } from '@/components/shell/AppShell'
import { PageStatus } from '@/components/shell/PageStatus'
import { PremiumOverview } from '@/components/overview/PremiumOverview'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field, inputClass } from '@/components/ui/field'
import { Switch } from '@/components/ui/Switch'
import { Badge } from '@/components/ui/badge'
import { emptyPremiumOverview, overviewFilters } from '@/lib/features/overview/premium-overview-core'

// An isolated visual fixture. No environment files, real accounts or API calls.
window.fetch = async () => { throw new Error('Network requests are disabled in the design fixture') }
const timestamp = '2026-10-18T08:00:00Z'
const data = emptyPremiumOverview({ id: 'design-fixture', name: 'ร้านบ้านละมุน' }, overviewFilters({ range: '7' }, new Date(timestamp)), '')
data.updatedAt = timestamp
data.metrics = { reconciledRevenue: null, messages: 842, incomingMessages: 842, uniqueCustomers: 128, approved: 46, totalSlips: 51, pending: 2, slipCredits: 920, verifiedSlipAmount: 28450 }
data.results = { passed: 46, pending: 2, rejected: 2, error: 1 }
data.customerGenders = { male: 39, female: 67, unspecified: 22 }
data.health = [
  { name: 'การเชื่อมต่อเพจ', status: 'active', detail: 'รับข้อความจากลูกค้าได้ตามปกติ', setupHref: '/settings' },
  { name: 'ผู้ช่วยตอบข้อความ', status: 'active', detail: 'ตอบจากกฎและข้อมูลของร้าน', setupHref: '/chatbot/conversations' },
  { name: 'บัญชีรับเงิน', status: 'setup', detail: 'เพิ่มบัญชีเพื่อเริ่มตรวจสอบสลิป', setupHref: '/slips' },
]
data.activity = [42, 76, 53, 120, 98, 156, 131].map((messages, index) => ({ key: `2026-10-${12 + index}`, label: `${12 + index} ต.ค.`, messages, customers: Math.round(messages / 4) }))
data.hourActivity = ['00:00–03:00', '03:00–06:00', '06:00–09:00', '09:00–12:00', '12:00–15:00', '15:00–18:00', '18:00–21:00', '21:00–24:00'].map((label, index) => ({ label, messages: [12, 4, 30, 86, 74, 112, 148, 91][index] }))
data.chats = [
  { id: 'customer-a', name: 'พิมพ์ชนก', avatar_url: null, body: 'สนใจสินค้าค่ะ มีสีอื่นให้เลือกไหมคะ', last_message_at: timestamp, unread_count: 2, owner: 'ผู้ช่วยอัตโนมัติ' },
  { id: 'customer-b', name: 'ธนกร', avatar_url: null, body: 'ส่งที่อยู่จัดส่งให้เรียบร้อยแล้วครับ', last_message_at: timestamp, unread_count: 0, owner: 'แอดมินรับแชท' },
]
data.chatMatches = data.chats.length

function Controls() {
  const [enabled, setEnabled] = useState(true)
  return <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 md:px-8">
    <Card><CardHeader title="ตรวจสอบรูปแบบส่วนควบคุม" description="ข้อมูลตัวอย่างสำหรับตรวจงานออกแบบเท่านั้น" action={<Badge tone="info">ตัวอย่าง</Badge>}/>
      <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-6">
        <Field label="ชื่อร้าน" hint="ตัวอย่างช่องกรอกที่รองรับภาษาไทย"><input aria-label="ชื่อร้านตัวอย่าง" className={inputClass} defaultValue="ร้านบ้านละมุน"/></Field>
        <div className="flex flex-wrap items-center gap-3"><Button>บันทึกการเปลี่ยนแปลง</Button><Button variant="secondary">ยกเลิก</Button><Button disabled>กำลังบันทึก</Button><Switch checked={enabled} onChange={setEnabled} label="สถานะตัวอย่าง"/></div>
      </div>
    </Card>
  </div>
}

createRoot(document.getElementById('root')!).render(
  <AppShell email="design@example.invalid" access={{ ai_agent: true, image_assistant: true, customer_management: true, slip_auto_pilot: true, customer_follow_up: true }} page={<PageStatus page={{ tenantId: 'design-fixture', name: 'ร้านบ้านละมุน', picture: null, pageLinked: true, autoReply: true, creditsLeft: 920 }}/> }>
    <PremiumOverview data={data} shopCount={1} userName="ผู้ดูแลร้าน" profileImageUrl={null}/>
    <Controls/>
  </AppShell>,
)
