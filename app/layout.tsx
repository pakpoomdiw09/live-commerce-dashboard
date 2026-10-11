import './globals.css'

export const metadata = { title: 'แดชบอร์ดร้าน' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
