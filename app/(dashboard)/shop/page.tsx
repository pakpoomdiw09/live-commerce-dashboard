import { Store } from 'lucide-react'
import { ComingSoon } from '@/components/ComingSoon'

export const metadata = { title: 'ร้านค้า / เซลเพจ' }

export default function Page() {
  return <ComingSoon title="ร้านค้า / เซลเพจ" description="หน้าร้านและเซลเพจสำหรับปิดการขาย" icon={Store} />
}
