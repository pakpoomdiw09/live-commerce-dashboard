import './globals.css'

export const metadata = {
  title: { default: 'SnapBot - Live Commerce & AI Chatbot', template: '%s | SnapBot' },
  applicationName: 'SnapBot',
  icons: { icon: '/logo-icon.png' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
