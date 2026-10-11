import { redirect } from 'next/navigation'

// old entry point (bot selector), now the Page picker
export default function LegacyDashboard() {
  redirect('/select-page')
}
