// Read-only diagnosis of live auction comment ingestion. Never writes, claims jobs or calls RPCs.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')
loadEnvConfig(process.cwd())

const TENANT = '9c3ad559-138b-446f-b9a5-2e2550f97fa4'
const PAGE = '122099866472012045'
const minutes = Number(process.argv[2] || 60)

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY.trim(),
  { auth: { persistSession: false, autoRefreshToken: false } },
)
const ok = (r, label) => {
  if (r.error) {
    console.log(`${label}: ERROR ${r.error.code} ${r.error.message}`)
    return null
  }
  return r.data
}
const bare = (id) => (typeof id === 'string' ? id.split('_').at(-1) : id)

async function main() {
  const since = new Date(Date.now() - minutes * 60_000).toISOString()
  console.log(`== tenant ${TENANT} page ${PAGE}; window ${minutes} min (since ${since})`)

  const tenant = ok(
    await db.from('tenants').select('id,page_id,is_active').eq('id', TENANT).maybeSingle(),
    'tenant',
  )
  console.log('tenant row:', tenant)

  const payloads = ok(
    await db.from('facebook_webhook_payloads').select('*').order('created_at', { ascending: false }).limit(1),
    'payloads',
  )
  console.log('latest raw payload receipt (any page):', payloads?.[0]?.created_at ?? 'none')

  const events =
    ok(
      await db
        .from('facebook_webhook_events')
        .select('id,page_id,kind,status,attempts,last_error,created_at,completed_at,payload')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(40),
      'events',
    ) ?? []
  console.log(`\n== events in window (all pages): ${events.length}`)
  const mine = events.filter((e) => e.page_id === PAGE)
  console.log(`   for page ${PAGE}: ${mine.length}`)
  const byStatus = {}
  for (const e of events) byStatus[`${e.page_id}:${e.status}`] = (byStatus[`${e.page_id}:${e.status}`] ?? 0) + 1
  console.log('   by page:status', byStatus)
  for (const e of events.slice(0, 15)) {
    const p = e.payload ?? {}
    const v = p.value ?? {}
    console.log({
      at: e.created_at,
      page: e.page_id,
      kind: e.kind,
      status: e.status,
      attempts: e.attempts,
      field: p.field,
      item: v.item,
      verb: v.verb,
      post_id: v.post_id,
      video_id: v.video_id,
      live_video_id: v.live_video_id,
      has_from: !!v.from?.id,
      last_error: e.last_error,
    })
  }
  const bad = events.filter((e) => ['dead', 'requires_review'].includes(e.status) || e.last_error)
  console.log(`\n== failed/review/with error: ${bad.length}`)
  for (const e of bad.slice(0, 10)) console.log(e.id, e.page_id, e.status, e.last_error)

  const auctions = ok(
    await db
      .from('auctions')
      .select('id,live_post_id,live_post_aliases,status,current_price,start_price,leading_bidder_id,created_at,closed_at,winner_locked_at,session_automation')
      .eq('tenant_id', TENANT)
      .eq('page_id', PAGE)
      .order('created_at', { ascending: false })
      .limit(5),
    'auctions',
  )
  console.log('\n== latest auctions')
  for (const a of auctions ?? [])
    console.log({
      id: a.id,
      status: a.status,
      live_post_id: a.live_post_id,
      live_post_aliases: a.live_post_aliases,
      current_price: a.current_price,
      created_at: a.created_at,
      mode: a.session_automation?.mode ?? null,
      keywords: a.session_automation?.keywords ?? null,
      closeKeywords: a.session_automation?.closeKeywords ?? null,
    })
  const sessions = ok(
    await db
      .from('live_sessions')
      .select('id,live_post_id,mode,status,created_at')
      .eq('tenant_id', TENANT)
      .eq('page_id', PAGE)
      .order('created_at', { ascending: false })
      .limit(3),
    'live_sessions',
  )
  console.log('latest live_sessions:', sessions)

  // Same predicate as process_live_auction_comment / postFilter, evaluated read-only.
  const active = (auctions ?? []).find((a) => a.status === 'active')
  console.log(`\n== active round: ${active ? active.id : 'NONE'}`)
  const comments = mine.filter((e) => e.payload?.value?.item === 'comment').slice(0, 8)
  for (const e of comments) {
    const v = e.payload.value
    const ids = [v.post_id, v.video_id, v.live_video_id].filter(Boolean)
    const wanted = new Set(ids.flatMap((id) => [id, bare(id)]))
    for (const a of auctions ?? []) {
      const match =
        wanted.has(a.live_post_id) || (a.live_post_aliases ?? []).some((x) => wanted.has(x))
      console.log(
        `event ${e.created_at} ids=[${ids}] vs auction ${a.id.slice(0, 8)} (${a.status}) live_post_id=${a.live_post_id} aliases=[${a.live_post_aliases}] => ${match ? 'MATCH' : 'MISMATCH'}${a.created_at > e.created_at ? ' (round created after event)' : ''}`,
      )
    }
  }
}
main().catch((e) => {
  console.error('diagnostic failed:', e.message)
  process.exitCode = 1
})
