import { InlineError } from '@/components/shared/ErrorState'

/** Page body when there is no tenant yet, or a table from a migration is missing. */
export function SetupNotice({
  kind,
  message,
}: {
  kind: 'no-tenant' | 'migration'
  message?: string
}) {
  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-8">
      {kind === 'no-tenant' ? (
        <InlineError title="ยังไม่มีร้านค้า" message="สร้างหรือเลือกร้านค้าก่อนใช้งานเมนูนี้" />
      ) : (
        <InlineError
          title="โหลดข้อมูลไม่ได้: ถ้ายังไม่ได้สร้างตาราง ให้รัน supabase/automation.sql แล้วรัน security.sql อีกครั้งใน Supabase SQL editor"
          message={message}
        />
      )}
    </div>
  )
}
