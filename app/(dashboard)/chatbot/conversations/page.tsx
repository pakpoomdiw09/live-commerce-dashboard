import { MessageCircleReply } from 'lucide-react'
import { ComingSoon } from '@/components/ComingSoon'

export const metadata = { title: 'ผู้ช่วยตอบบทสนทนา' }

export default function Page() {
  return <ComingSoon title="ผู้ช่วยตอบบทสนทนา" description="ตั้งคีย์เวิร์ดและคำตอบอัตโนมัติสำหรับแชทและคอมเมนต์" icon={MessageCircleReply} />
}
