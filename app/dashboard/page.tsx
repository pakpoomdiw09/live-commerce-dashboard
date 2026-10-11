import { redirect } from 'next/navigation'

// old entry point (bot selector), replaced by the Quick Switcher in the sidebar
export default function LegacyDashboard() {
  redirect('/overview')
}
