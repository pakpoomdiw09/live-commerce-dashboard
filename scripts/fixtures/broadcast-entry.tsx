import { createRoot } from 'react-dom/client'
import { BroadcastWorkspace } from '@/components/broadcast/BroadcastWorkspace'

const tenantId = '11111111-1111-4111-8111-111111111111'
const fixture = {
  eligible: false,
  calls: [] as { url: string; body: any }[],
  drafts: new Map<string, any>(),
}
;(window as any).broadcastFixture = fixture
window.fetch = async (input, init) => {
  const url = String(input),
    body = JSON.parse(String(init?.body ?? '{}'))
  fixture.calls.push({ url, body })
  let result: unknown
  if (url === '/api/broadcasts') {
    const row = {
      ...body,
      status: 'draft',
      audience_window: 'within_24h',
      message_tag: null,
      created_at: new Date().toISOString(),
      sent: 0,
      failed: 0,
      skipped: 0,
      total: 0,
    }
    fixture.drafts.set(body.id, row)
    result = { broadcast: row }
  } else if (url === '/api/broadcasts/preview') {
    const row = fixture.drafts.get(body.id)
    result = {
      total: 3,
      within: 2,
      outside: 1,
      missing: 0,
      reachable: fixture.eligible ? 2 : 0,
      skipped: fixture.eligible ? 1 : 3,
      reasons: fixture.eligible
        ? { eligible: 2, outside_window: 1 }
        : { policy_unverified: 2, outside_window: 1 },
      members: [
        {
          id: 'one',
          name: 'ลูกค้าทดสอบ',
          reason: fixture.eligible ? 'eligible' : 'policy_unverified',
          detail: fixture.eligible ? 'ส่งได้' : 'ยังไม่ยืนยันนโยบาย',
        },
      ],
      checkedAt: new Date().toISOString(),
      fingerprint: 'offline-only',
      draft: row,
      page: { id: 'page-test', name: 'เพจทดสอบออฟไลน์', status: 'verified' },
      policyVerified: fixture.eligible,
      evidenceReady: true,
      credits: 100,
      estimatedCredits: fixture.eligible ? 2 : 0,
      outsideEnabled: false,
    }
  } else if (/^\/api\/broadcasts\/[^/]+\?tenantId=/.test(url)) {
    const id = new URL(url, location.origin).pathname.split('/').pop()!
    if (init?.method === 'DELETE') {
      fixture.drafts.delete(id)
      result = { deleted: id }
    } else result = { broadcast: fixture.drafts.get(id) }
  } else if (url === '/api/tenants/active') result = { ok: true }
  else if (/^\/api\/broadcasts\/.+\/send$/.test(url))
    result = {
      done: true,
      sent: 2,
      delivered: 0,
      read: 0,
      failed: 0,
      unknown: 0,
      skipped: 1,
      remaining: 0,
      total: 3,
    }
  else throw new Error('Blocked unexpected network request: ' + url)
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-slate-50 p-4 sm:p-8">
    <p className="mb-4 rounded-xl bg-amber-100 p-3 text-sm">
      ข้อมูลทดสอบออฟไลน์ · ไม่มีการส่งข้อความจริง
    </p>
    <BroadcastWorkspace
      tenantId={tenantId}
      pageName="เพจทดสอบออฟไลน์"
      pageStatus="verified"
      canSend
      tags={['ลูกค้าประจำ', 'สนใจสินค้า']}
      billing={{ monthly: 100, topup: 0 } as any}
      broadcasts={[]}
    />
  </main>,
)
