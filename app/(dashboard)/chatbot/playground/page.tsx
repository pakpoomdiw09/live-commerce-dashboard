import { redirect } from 'next/navigation'

export const metadata = { title: 'ทดลองใช้งาน AI' }

export default function AiPlaygroundPage() {
  redirect('/chatbot/conversations')
}
