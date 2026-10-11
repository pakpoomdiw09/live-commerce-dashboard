import { Megaphone } from 'lucide-react'
import { ComingSoon } from '@/components/ComingSoon'

export const metadata = { title: 'บรอดแคสต์' }

export default function Page() {
  return <ComingSoon title="บรอดแคสต์" description="ส่งข้อความถึงลูกค้าหลายคนพร้อมกัน" icon={Megaphone} />
}
