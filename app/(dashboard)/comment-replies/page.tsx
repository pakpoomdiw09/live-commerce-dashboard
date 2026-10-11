import { supabaseServer } from '@/lib/supabase/server'
import { getActiveTenant, tenantPages } from '@/lib/tenant'
import { RULE_COLUMNS } from '@/lib/comment-rules'
import { RulesTable, type RuleRow } from '@/components/comment-rules/RulesTable'
import { InlineError } from '@/components/ErrorState'

export const metadata = { title: 'ตอบกลับคอมเมนต์' }

export default async function CommentRepliesPage() {
  const [db, tenant] = await Promise.all([supabaseServer(), getActiveTenant()])
  if (!tenant) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <InlineError title="ยังไม่มีร้านค้า" message="กฎตอบกลับคอมเมนต์เป็นของแต่ละร้าน: สร้างหรือเลือกร้านค้าก่อน" />
      </div>
    )
  }
  const [{ data, error }, pages] = await Promise.all([
    db.from('comment_rules').select(`${RULE_COLUMNS}, comments(count)`).eq('tenant_id', tenant.id).order('created_at', { ascending: false }),
    tenantPages(tenant),
  ])
  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-2xl bg-amber-50 p-5 text-sm text-amber-800 ring-1 ring-amber-200">
          <p className="font-semibold">โหลดกฎตอบกลับคอมเมนต์ไม่ได้</p>
          <p className="mt-1">ถ้ายังไม่ได้สร้างตาราง ให้รันไฟล์ supabase/comment-rules.sql, platform.sql และ security.sql ใน Supabase SQL editor</p>
          <p className="mt-2 font-mono text-xs opacity-80">{error.message}</p>
        </div>
      </div>
    )
  }
  return <RulesTable initial={(data ?? []) as RuleRow[]} pages={pages} />
}
