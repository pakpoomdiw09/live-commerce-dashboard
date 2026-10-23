import React, { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SlipsDashboard } from '../../../components/slips/SlipsDashboard'
import type { PaymentChannelTab } from '../../../components/slips/PaymentChannelsGuide'
import { installFetch, metrics } from './mocks'
installFetch()
Object.assign(window, { paymentTest: { metrics } })
function App() {
  const [tab, setTab] = useState<PaymentChannelTab>('qr')
  useEffect(() => {
    const change = (event: Event) => setTab((event as CustomEvent).detail)
    window.addEventListener('payment-tab', change)
    return () => window.removeEventListener('payment-tab', change)
  }, [])
  return (
    <SlipsDashboard
      activeTab={tab}
      receivingEnabled
      designerEnabled={location.hash === '#designer'}
      proEnabled={false}
      initial={[]}
      tenant={
        {
          id: 'offline-test',
          name: 'ร้านทดสอบ QR ออฟไลน์',
          slip_quota: 100,
          slip_quota_credits: 0,
          slip_used: 0,
          auto_reply_enabled: false,
          auto_verify_enabled: false,
        } as never
      }
      billing={{ plan: 'starter' } as never}
      role="owner"
    />
  )
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
