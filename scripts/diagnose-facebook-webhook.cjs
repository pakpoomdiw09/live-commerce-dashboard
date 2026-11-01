// Read-only: never enqueue events, claim jobs, send messages, or print secrets/payloads.
const { loadEnvConfig } = require('@next/env')
const { createClient } = require('@supabase/supabase-js')
loadEnvConfig(process.cwd())
const { redactFacebookDiagnostic } = require('./helpers/load-typescript.cjs')(
  'lib/integrations/facebook/diagnostics.ts',
  {},
  { process },
)

async function main() {
  const option = (name) => {
    const position = process.argv.indexOf(name)
    return position >= 0 ? process.argv[position + 1] : undefined
  }
  const requestedPageId = option('--page-id')
  if (requestedPageId !== undefined && !/^[1-9]\d{0,63}$/.test(requestedPageId))
    throw new Error('Invalid Page ID')
  for (const key of [
    'FB_VERIFY_TOKEN',
    'FB_APP_SECRET',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'CRON_SECRET',
  ]) {
    const present = Boolean(
      key === 'FB_VERIFY_TOKEN'
        ? process.env.FB_VERIFY_TOKEN?.trim() || process.env.FACEBOOK_VERIFY_TOKEN?.trim()
        : process.env[key]?.trim(),
    )
    console.log(`${key}: ${present ? 'set' : 'MISSING'}`)
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) {
    process.exitCode = 1
    return
  }
  console.log('supabase_project_host:', new URL(url).hostname)
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  })
  const checks = [
    [
      'latest_receipts',
      () =>
        db
          .from('facebook_webhook_payloads')
          .select('id,received_at,last_received_at,delivery_count')
          .order('last_received_at', { ascending: false })
          .limit(5),
    ],
    [
      'latest_events',
      () =>
        db
          .from('facebook_webhook_events')
          .select('id,page_id,kind,status,attempts,last_error,created_at,available_at,lease_until')
          .order('created_at', { ascending: false })
          .limit(10),
    ],
    [
      'unfinished_events',
      () =>
        db
          .from('facebook_webhook_events')
          .select('id,page_id,status,attempts,last_error,created_at,available_at,lease_until')
          .neq('status', 'completed')
          .order('created_at', { ascending: true })
          .limit(20),
    ],
    [
      'active_pages',
      () =>
        db
          .from('tenants')
          .select('id,page_id')
          .eq('is_active', true)
          .not('page_id', 'is', null)
          .limit(100),
    ],
    [
      'latest_facebook_customers',
      () =>
        db
          .from('customers')
          .select('id,tenant_id,last_message_at')
          .eq('platform', 'facebook')
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(5),
    ],
  ]
  await Promise.allSettled(
    checks.map(async ([name, read]) => {
      try {
        const result = await read()
        if (result.error) {
          // Error messages/details may contain private data; expose codes only.
          console.log(`${name}: FAILED code=${result.error.code || 'UNKNOWN'}`)
          process.exitCode = 1
        } else console.log(`${name}: ${JSON.stringify(result.data)}`)
      } catch {
        console.log(`${name}: FAILED (network/timeout)`)
        process.exitCode = 1
      }
    }),
  )
  const [changes, receipts] = await Promise.all([
    db
      .from('facebook_webhook_events')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'change'),
    db
      .from('facebook_webhook_payloads')
      .select('raw_payload,received_at')
      .order('received_at', { ascending: false })
      .limit(50),
  ])
  console.log('comment_change_event_count:', changes.error ? 'FAILED' : changes.count)
  if (!receipts.error)
    console.log(
      'recent_payload_shapes:',
      JSON.stringify(
        (receipts.data ?? []).slice(0, 10).map((row) => {
          try {
            const body = JSON.parse(row.raw_payload)
            return {
              receivedAt: row.received_at,
              entries: (body.entry ?? []).map((entry) => ({
                pageId: entry.id,
                messages: entry.messaging?.length ?? 0,
                changes: (entry.changes ?? []).map((change) => ({
                  field: change.field,
                  item: change.value?.item,
                  verb: change.value?.verb,
                  hasCommentId: !!(
                    change.value?.comment_id ||
                    change.value?.id ||
                    change.value?.comment?.id
                  ),
                  hasAuthor: !!(change.value?.from?.id || change.value?.sender_id),
                })),
              })),
            }
          } catch {
            return { receivedAt: row.received_at, invalidJson: true }
          }
        }),
      ),
    )
  // Meta dashboard test events commonly use page_id=0. Never let that
  // placeholder suppress inspection of the shop's actual Page/token.
  const latest = await db
    .from('facebook_webhook_events')
    .select('page_id')
    .neq('page_id', '0')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const targetPageId = requestedPageId ?? latest.data?.page_id
  const page = targetPageId
    ? await db
        .from('tenants')
        .select('id,page_id,page_access_token')
        .eq('page_id', targetPageId)
        .eq('is_active', true)
        .maybeSingle()
    : null
  console.log(
    'target_page:',
    JSON.stringify({
      pageId: targetPageId ?? null,
      activeTenantFound: Boolean(page?.data),
      selectedBy: requestedPageId ? 'explicit_page_id' : 'latest_non_placeholder_event',
      configuredPageMatches: process.env.FB_PAGE_ID
        ? String(targetPageId) === process.env.FB_PAGE_ID.trim()
        : null,
      note: 'FB_PAGE_ID is only a shared-token fallback; tenant Page IDs control routing',
    }),
  )
  let rulesForPage = []
  if (page?.data) {
    const rules = await db
      .from('comment_rules')
      .select(
        'id,keywords,match_type,is_active,live_product_id,live_variant_id,live_post_id,live_stock_limit,live_deduct_stock,inbox_enabled,reply_enabled',
      )
      .eq('tenant_id', page.data.id)
      .eq('mode', 'live_cf')
      .contains('page_ids', [targetPageId])
      .limit(20)
    if (rules.error) console.log('live_rule_diagnostics: FAILED code=' + rules.error.code)
    else {
      rulesForPage = rules.data ?? []
      const productIds = [
        ...new Set((rules.data ?? []).map((rule) => rule.live_product_id).filter(Boolean)),
      ]
      const products = productIds.length
        ? await db
            .from('products')
            .select('id,code,stock,is_active,commerce_archived')
            .eq('tenant_id', page.data.id)
            .in('id', productIds)
        : { data: [] }
      const variants = productIds.length
        ? await db
            .from('commerce_variants')
            .select('id,product_id,stock,is_active')
            .eq('tenant_id', page.data.id)
            .in('product_id', productIds)
            .eq('is_active', true)
            .limit(1000)
        : { data: [] }
      if (products.error || variants.error)
        console.log(
          'live_catalog_diagnostics: FAILED code=' + (products.error?.code ?? variants.error?.code),
        )
      else
        console.log(
          'live_rule_diagnostics:',
          JSON.stringify(
            (rules.data ?? []).map((rule) => {
              const product = products.data.find((product) => product.id === rule.live_product_id)
              const choices = variants.data.filter(
                (variant) => variant.product_id === rule.live_product_id,
              )
              const selected = choices.find((variant) => variant.id === rule.live_variant_id)
              return {
                ruleId: rule.id,
                active: rule.is_active,
                keywords: rule.keywords,
                matchType: rule.match_type,
                postId: rule.live_post_id,
                privateEnabled: rule.inbox_enabled,
                publicEnabled: rule.reply_enabled,
                stockLimit: rule.live_stock_limit,
                deductStock: rule.live_deduct_stock,
                productFound: Boolean(product),
                productActive: product?.is_active,
                productArchived: product?.commerce_archived,
                productCode: product?.code,
                productStock: product?.stock,
                activeVariantCount: choices.length,
                selectedVariantFound: rule.live_variant_id ? Boolean(selected) : null,
                selectedVariantStock: selected?.stock,
              }
            }),
          ),
        )
    }
  }
  if (process.argv.includes('--meta')) {
    const appId = (process.env.FB_APP_ID || process.env.NEXT_PUBLIC_FB_APP_ID || '').trim()
    const appSecret = (process.env.FB_APP_SECRET || '').trim()
    const version = process.env.FB_GRAPH_VERSION || 'v24.0'
    async function readGraph(path, authorization) {
      const response = await fetch('https://graph.facebook.com/' + version + '/' + path, {
        headers: { Authorization: 'Bearer ' + authorization },
        signal: AbortSignal.timeout(10000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || body?.error) {
        console.log(
          'meta_read_failed:',
          JSON.stringify({
            edge: path.split('?')[0],
            status: response.status,
            code: body?.error?.code,
            subcode: body?.error?.error_subcode,
            type: body?.error?.type,
            responseData: redactFacebookDiagnostic(body?.error, [authorization, appSecret]),
          }),
        )
        return null
      }
      return body
    }
    if (appId && appSecret) {
      const subscriptions = await readGraph(appId + '/subscriptions', appId + '|' + appSecret)
      if (subscriptions)
        console.log(
          'app_subscriptions:',
          JSON.stringify(
            (subscriptions.data ?? []).map((row) => ({
              object: row.object,
              active: row.active,
              callback:
                typeof row.callback_url === 'string' ? row.callback_url.split('?')[0] : null,
              fields: (row.fields ?? []).map((field) => field.name),
            })),
          ),
        )
    }
    if (page?.data?.page_access_token) {
      if (appId && appSecret) {
        const inspected = await readGraph(
          'debug_token?input_token=' + encodeURIComponent(page.data.page_access_token),
          appId + '|' + appSecret,
        )
        if (inspected)
          console.log(
            'latest_page_token:',
            JSON.stringify({
              type: inspected.data?.type,
              valid: inspected.data?.is_valid,
              pageMatches: String(inspected.data?.profile_id) === page.data.page_id,
              scopes: inspected.data?.scopes,
              missingLivePermissions: [
                'pages_read_engagement',
                'pages_read_user_content',
                'pages_manage_engagement',
                'pages_manage_metadata',
                'pages_messaging',
              ].filter((scope) => !inspected.data?.scopes?.includes(scope)),
              expiresAt: inspected.data?.expires_at,
            }),
          )
      }
      const linked = await readGraph(
        page.data.page_id + '/subscribed_apps?fields=id,subscribed_fields',
        page.data.page_access_token,
      )
      if (linked)
        console.log(
          'latest_page_subscriptions:',
          JSON.stringify({
            pageId: page.data.page_id,
            apps: (linked.data ?? []).map((row) => ({
              isCurrentApp: row.id === appId,
              fields: row.subscribed_fields,
            })),
          }),
        )
      const scopedVideos = [
        ...new Set(
          rulesForPage.map((rule) => rule.live_post_id).filter((id) => /^\d+$/.test(id ?? '')),
        ),
      ].slice(0, 3)
      for (const videoId of scopedVideos) {
        const video = await readGraph(
          videoId + '?fields=id,live_status',
          page.data.page_access_token,
        )
        if (video)
          console.log(
            'configured_live_video:',
            JSON.stringify({ videoId, liveStatus: video.live_status ?? null }),
          )
      }
      const liveList = await readGraph(
        page.data.page_id + '/live_videos?fields=id,status,creation_time,video{id}&limit=10',
        page.data.page_access_token,
      )
      if (liveList)
        console.log(
          'page_live_videos:',
          JSON.stringify({
            pageId: page.data.page_id,
            videos: (liveList.data ?? []).map((video) => ({
              id: video.id,
              videoId: video.video?.id ?? null,
              status: video.status,
              createdAt: video.creation_time,
              matchesConfiguredScope:
                scopedVideos.includes(video.id) || scopedVideos.includes(video.video?.id),
            })),
          }),
        )
    }
  }
}
main().catch(() => {
  console.error('Diagnostics failed; check configuration/network.')
  process.exitCode = 1
})
