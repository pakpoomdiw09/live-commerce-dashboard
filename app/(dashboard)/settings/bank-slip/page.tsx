import { redirect } from 'next/navigation'

/** Keep existing bookmarks working after moving settings into the slip dashboard. */
export default function BankSlipSettingsPage() {
  redirect('/slips?tab=settings')
}
