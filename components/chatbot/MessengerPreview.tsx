/** How a bot message looks in Messenger: text and/or image bubble, quick reply chips underneath. */
export function MessengerPreview({ text, imageUrl, quickReplies = [] }: { text?: string | null; imageUrl?: string | null; quickReplies?: string[] }) {
  const t = text?.trim()
  if (!t && !imageUrl) return <p className="text-xs text-slate-400">ยังไม่มีข้อความตอบกลับ</p>
  return (
    <div className="space-y-1.5 rounded-xl bg-slate-50 p-3" aria-label="ตัวอย่างใน Messenger">
      {t && <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-sm whitespace-pre-wrap text-slate-800 shadow-sm ring-1 ring-slate-200">{t}</p>}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="max-h-40 max-w-[70%] rounded-2xl object-cover ring-1 ring-slate-200" />
      )}
      {quickReplies.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5 pt-1">
          {quickReplies.map((q) => (
            <span key={q} className="rounded-full border border-blue-500 bg-white px-3 py-1 text-xs font-medium text-blue-600">
              {q}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
