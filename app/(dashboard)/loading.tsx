import { BrandLoader } from '@/components/ui/BrandLoader'

/** Pages without their own skeleton (chatbot, broadcast, billing...) show the brand loader. */
export default function DashboardLoading() {
  return <BrandLoader className="flex-1" />
}
