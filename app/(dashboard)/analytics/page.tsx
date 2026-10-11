import { BarChart3 } from 'lucide-react'
import { ComingSoon } from '@/components/ComingSoon'

export const metadata = { title: 'วิเคราะห์' }

export default function Page() {
  return <ComingSoon title="วิเคราะห์" description="สถิติแชท ยอดขาย และการทำงานของบอท" icon={BarChart3} />
}
