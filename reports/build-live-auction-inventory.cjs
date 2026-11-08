// Reproducible source inventory; does not read credentials or contact external services.
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process')
const { build } = require('../scripts/build-full-database-setup.cjs')
const root = path.resolve(__dirname, '..')
const paths = cp
  .execFileSync(
    'rg',
    [
      '--files',
      '--hidden',
      '-g',
      '!node_modules/**',
      '-g',
      '!.git/**',
      '-g',
      '!.next*/**',
      '-g',
      '!.vercel/**',
      '-g',
      '!.env*',
      '-g',
      '!.agents/**',
      '-g',
      '!.codex/**',
      '-g',
      '!.aws/**',
      '-g',
      '!reports/**',
      '-g',
      '!package-lock.json',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  .trim()
  .split(/\r?\n/)
  .map((p) => p.replaceAll('\\', '/'))
const roles = {
  'auction-server.ts':
    'Routes comments to rounds and orchestrates durable public/private winner-notification deliveries.',
  'auction-comment-parser.ts':
    'Normalizes comment text and classifies host controls, opening bids, confirmation keywords and numeric bids.',
  'auction-parser.ts': 'Compatibility re-export of the auction comment parser.',
  'auction-api.ts':
    'Owner/tenant authorization, feature gating, same-origin writes and API error mapping.',
  'auction-hosts.ts':
    'Resolves trusted personal Facebook host IDs from verified user/Page credentials.',
  'auction-types.ts': 'TypeScript round, bid and processing-result contracts.',
  'auction-templates.ts':
    'Winner/bid/close message defaults, variable validation and financial-footer composition.',
  'session-automation.ts':
    'Session keyword/reply settings, legacy winner-flow compatibility and cumulative invoice message plans.',
  'comment-config.ts':
    'Shared normalization, defaults and session-over-round tag/template precedence.',
  'live-comment-routing.ts':
    'Canonical post/video aliases and precedence for auction versus product-CF rule routing.',
  'live-products.ts': 'Associates configured live products with comment rules.',
  'comment-rules.ts': 'Rule types, keyword matching and live-product rule helpers.',
  'cf-code.ts': 'Normalizes product codes and extracts Thai/English CF purchase-intent prefixes.',
  'live-cf-codes.ts': 'Validates and allocates live-product codes.',
  'live-cf-setup.ts':
    'Validates setup input, reply templates, variant choices and Facebook live URLs/IDs.',
  'live-cf-comment.ts':
    'Handles product-code purchase comments and composes comment-scoped payment replies.',
  'live-cf-payment-link.ts':
    'Signs and verifies expiring order payment links using an HMAC secret.',
  'customer-tabs-server.ts':
    'Loads order/tab ledgers, banking details, cumulative invoice text and signed payment links.',
  'customer-tab-types.ts':
    'Customer-tab item/payment types and deterministic financial text formatting.',
  'customer-tab-reminders.ts':
    'Claims reminder jobs, rechecks balances/policy and dispatches durable message parts.',
  'customer-tab-slip.ts':
    'Claims customer-tab slip processing and applies verified payments through ledger RPCs.',
  'live-session-types.ts':
    'Session dashboard, finance, invoice and follow-up view/input contracts.',
  'session-customer-rows.ts': 'Builds customer/session row models for auction workspace tables.',
  'live-source.ts': 'Resolves live-source selections and URL/ID metadata.',
  'orders.ts': 'Creates catalog/comment orders and reads unpaid orders for billing.',
  'webhook-http.ts':
    'Verifies Meta GET challenges/HMAC POST bodies, durably enqueues and schedules a deferred worker.',
  'webhook-envelope.ts':
    'Validates/normalizes payloads and derives canonical event and ordering keys.',
  'webhook-worker.ts':
    'Claims fenced DB leases, heartbeats, checkpoints external steps and handles retry/review outcomes.',
  'webhook-handler.ts':
    'Resolves Page tenants, routes messages/comments, auction/CF orders, slips and receipts.',
  'live-cf-adapter.ts':
    'Injectable public/private comment text sender with an isolated mock implementation.',
  'live-videos.ts':
    'Server-side Meta live-video discovery, Page filtering and provider error diagnostics.',
  'LiveCommentPoller.tsx':
    'Browser comment-fallback loop: 2.5-second cadence, retries, cancellation and a 30-comment feed.',
  'LiveAuctionPanel.tsx':
    'Round/bid status polling, seller host-control buttons and delivery status display.',
  'LiveAuctionWorkspace.tsx': 'Composes the auction session, setup and active-round workspace.',
  'LiveSessionDashboard.tsx':
    'Polls session metrics, customer ledgers, invoices and finance controls.',
  'LiveCfWorkspace.tsx': 'Composes live product/CF tools and session selection.',
  'LiveCfSetup.tsx':
    'Merchant editor for live-product rules, codes, options and public/private replies.',
  'LiveCfVariantPayment.tsx': 'Customer-side required product-variant selection before payment.',
  'CustomerTabPayment.tsx':
    'Customer-facing cumulative bill, balances, QR/payment and slip submission.',
  'AuctionUnifiedForm.tsx':
    'Unified seller form for round, automation, finance and source configuration.',
  'AuctionRoundForm.tsx':
    'Creates, replaces or cancels a round with price, step, shipping and payment settings.',
  'AuctionSessionStart.tsx': 'Starts/selects a live auction session.',
  'AuctionSessionSections.tsx': 'Groups session configuration form sections.',
  'AuctionSessionCustomers.tsx':
    'Displays/imports/edits auction-session customers and their bill rows.',
  'AuctionSessionAutomation.tsx':
    'Merchant controls for confirmation/closing tags and notification templates.',
  'AuctionKeywordEditor.tsx': 'Reusable confirmation and closing keyword editor.',
  'AuctionSlipUpload.tsx': 'Auction payment-proof upload and submission UI.',
  'SessionWinnerModal.tsx': 'Seller manual winner/order selection workflow.',
  'SessionProofModal.tsx': 'Seller slip review and payment allocation dialog.',
  'SessionFollowupModal.tsx': 'Selects unpaid customers and queues customized invoice reminders.',
  'SessionFinance.tsx': 'Edits session costs, ads, shipping, fees and finance totals.',
  'SessionDialog.tsx': 'Shared session dialog container and interaction controls.',
  'session-ui.ts': 'Shared styling tokens for session controls.',
  'LiveSourcePicker.tsx': 'Selects and verifies the Page/live video source.',
  'LiveVideoSelect.tsx': 'Searchable list of discovered live videos.',
  'QuickProductModal.tsx': 'Creates/edits live products, stock and variant options.',
  'useAuctionStatuses.ts': 'Fetches auction/order status badges for Inbox customer rows.',
  'CommentsFeed.tsx': 'Displays recent Page comments alongside Inbox activity.',
  'LiveReplyControls.tsx':
    'Shared live-reply toggles, template editing and receiving-bank selection controls.',
  'CustomerTabsPanel.tsx':
    'Inbox customer bill summaries, transactional invoice sends and queued reminders.',
  'ChatList.tsx': 'Inbox conversation list with auction status/payment badges.',
  'RulesTable.tsx': 'Lists and edits Page comment/CF automation rules.',
  'AppShell.tsx': 'Dashboard navigation and feature-access shell with live-commerce entrypoints.',
  'commerce-core.ts':
    'Shared product, money, storefront-design and commerce input validation/contracts.',
  'commerce-server.ts': 'Tenant-scoped server reads and mutations shared by commerce setup.',
  'messenger-product-server.ts':
    'Routes inbound Messenger product-code requests into product/payment replies.',
  'messenger-product.ts':
    'Extracts product codes from Messenger text and builds deterministic catalog responses.',
  'product-options.ts': 'Builds valid option combinations and variant overrides for live products.',
  'stock-subscription.ts':
    'Supabase Realtime product/variant stock subscription and visibility cleanup.',
  'quick-product.ts': 'Validates quick-product creation/editing and related option/variant inputs.',
  'diagnostics.ts':
    'Redacts credentials and sensitive payload fields in Facebook diagnostic output.',
  'message-window.ts':
    'Separately validates genuine inbound messages and outgoing echoes; protects service-window evidence.',
  'sync-pagination.ts':
    'Validates Graph continuation URLs/cursors, partial-history sync and scoped bearer-token transport.',
}
const routeRoles = {
  'supabase/schema.sql':
    'Base customer, message, comment and slip tables plus initial Realtime publication entries.',
  'supabase/tenants.sql':
    'Tenant ownership columns and Page/token configuration underlying live commerce.',
  'supabase/platform.sql': 'Platform user/tenant/member tables and shared access primitives.',
  'supabase/security.sql':
    'Tenant-membership RLS and browser table permissions supporting the live-commerce authorization boundary.',
  'supabase/commerce-v2.sql':
    'Product variants, inventory/order primitives and shared commerce rate-limit support.',
  'supabase/bank-accounts.sql':
    'Tenant receiving-bank records and order/payment bank associations.',
  'supabase/facebook-webhook-nonblocking.sql':
    'Queue recovery policy that avoids permanently blocking later events behind dead/review work.',
  'supabase/facebook-webhook-comment-ordering.sql':
    'Canonical per-Page comment queue ordering and enqueue validation across bidders/host commands.',
  'supabase/facebook-message-window.sql':
    'Verified inbound-time rules and transactional message persistence; auction comments cannot renew messaging windows.',
  'supabase/facebook-message-echoes.sql':
    'Outgoing echo correlation, monotonic receipt status and Inbox publication repair for transactional messages.',
  'supabase/broadcast-policy.sql':
    'Signed inbound message evidence and shared Messenger eligibility policy tables/functions.',
  'lib/auth.ts':
    'Verified dashboard actors and tenant membership/role checks used by auction APIs.',
  'lib/supabase/server.ts':
    'Server-side service-role database client and authenticated cookie session client.',
  'middleware.ts': 'Browser-session middleware and public webhook exclusions.',
  'lib/message-quota.ts':
    'Message-credit accounting used by shared bot billing/notification delivery.',
  'lib/features/inbox/inbox-policy-server.ts':
    'Server Messenger-window/token checks reused by live customer-tab reminders.',
  'lib/features/inbox/inbox-automation-window.ts':
    'Automation dispatch gate preventing unverified/out-of-window bot sends.',
  'lib/features/inbox/standard-message-window.ts':
    'Standard-window timestamp eligibility helpers shared by messaging flows.',
  'app/api/live-cf/auction/poll-comments/route.ts':
    'Authenticated rate-limited latest-50 comment polling; normalizes Graph results into the webhook queue and drains worker/outbox.',
  'app/(dashboard)/live-auction/page.tsx':
    'Active-tenant auction entry page loading Page profiles/banks and mounting LiveSessionDashboard.',
  'app/(dashboard)/live-cf/page.tsx':
    'Active-tenant product-CF/live-commerce dashboard entry page.',
  'app/(dashboard)/comment-replies/page.tsx':
    'Dashboard listing Page comment auto-reply and CF product rules.',
  'app/(dashboard)/comment-replies/[id]/page.tsx':
    'Dashboard editor for an existing Page comment/CF reply rule.',
  'app/api/shipping/route.ts':
    'Tenant-scoped fulfillment actions for paid orders/customer-tab shipments.',
  'app/api/slips/[id]/approve/route.ts':
    'Authorized manual slip approval, including linked auction/tab payment evidence.',
  'app/api/live-cf/auction/host-action/route.ts':
    'Posts Page count/close comments and durably enqueues the confirmed provider comment.',
  'app/api/live-cf/auction/close/route.ts':
    'Owner close/cancel endpoint calling finalize_live_auction, then tries the notification outbox.',
  'app/api/live-cf/auction/route.ts':
    'Reads rounds/bids and creates validated tenant/Page/bank-scoped rounds.',
  'app/api/live-auction/workspace/route.ts':
    'Reads current session/round and performs idempotent unified workspace mutations.',
  'app/api/live-auction/session/route.ts':
    'Configures session automation, imports customers and loads the Thai auction dashboard RPC.',
  'app/api/live-cf/sessions/route.ts':
    'Reads session read models and manages winners, costs, proof corrections and reminder batches.',
  'app/api/live-cf/setup/route.ts': 'Persists validated CF products/rules and session setup.',
  'app/api/live-cf/products/route.ts':
    'Lists/manages products and options available to live commerce.',
  'app/api/live-cf/payment-variant/route.ts':
    'Validates signed order access and persists required variant choices.',
  'app/api/facebook/live-videos/route.ts':
    'Authorizes Page access before server-side live-video discovery.',
  'app/api/customer-tabs/route.ts':
    'Reads customer invoices and queues manual/all-customer reminder operations.',
  'app/api/customer-tabs/invoice/route.ts':
    'Sends a server-rendered owned transactional invoice using a durable request/message key.',
  'app/api/inbox/auction-status/route.ts': 'Returns tenant-scoped auction status for Inbox rows.',
  'app/api/cron/facebook-webhooks/route.ts':
    'Secret-authenticated recovery worker; also drains auction, shipping and tab-reminder outboxes.',
  'app/api/cron/customer-tabs/route.ts':
    'Authenticated recovery runner for queued customer-tab reminders.',
  'app/pay/live/[token]/page.tsx':
    'Verifies the signed payment token and renders the appropriate order/tab payment experience.',
  'app/pay/live/[token]/slip/route.ts':
    'Validates payment-token ownership and handles proof/slip upload for the linked order/tab.',
  'lib/integrations/facebook/client.ts':
    'Shared Graph transport, Page token selection and transactional/direct/private Messenger delivery with safe diagnostics.',
  'lib/integrations/facebook/oauth.ts':
    'Page discovery, token verification and Page webhook field subscriptions.',
  'app/auth/callback/route.ts':
    'Facebook sign-in callback; verifies/saves tenant Pages and subscribes their webhook fields.',
  'app/api/auth/facebook/callback/route.ts':
    'Existing-user Page connection callback, Page-token storage and webhook subscription.',
  'lib/tenant.ts':
    'Authenticated active-tenant selection and server-only Page-profile/token-backed connection reads.',
  'lib/features/slips/process.ts':
    'Slip verification orchestration shared with live invoice payments.',
  'lib/features/slips/notify.ts':
    'Durable bot transcript/message claims, policy checks and external delivery used by billing automation.',
  'lib/features/slips/image.ts':
    'Downloads and validates candidate receipt images before verification.',
  'app/webhook/route.ts':
    'Root webhook URL alias for the shared Meta challenge/signature/queue receiver.',
  'app/api/webhook/route.ts': 'Webhook URL alias for the shared Meta ingress receiver.',
  'app/api/webhooks/route.ts': 'Plural webhook URL alias for the shared Meta ingress receiver.',
  'app/api/webhook/facebook/route.ts':
    'Facebook webhook URL alias for the shared Meta ingress receiver.',
  'app/api/webhooks/facebook/route.ts':
    'Plural Facebook webhook URL alias for the shared Meta ingress receiver.',
  'lib/feature-flags.ts':
    'Controls live_cf availability; the current implementation enables it by default unless explicitly disabled.',
  'vercel.json': 'Vercel deployment configuration; currently declares no cron schedules.',
  'scripts/build-full-database-setup.cjs':
    'Defines canonical migration order/dependencies and generates schema bundles; use this order to resolve SQL overrides.',
  'package.json':
    'Lists auction/live/session test and browser-check entrypoints and application dependencies.',
  'README.md': 'Project setup and feature entrypoint documentation.',
}
const domain =
  /auction|live[_-]cf|live[_-]session|customer[_-]tab|live[_-]stream|handleLiveCf|placeCf|poll-comments/i
const generated = new Set([
  'supabase/complete_schema.sql',
  'supabase/full_database_setup.sql',
  'supabase/full_database_setup-manifest.md',
])
const records = []
for (const file of paths) {
  if (!/\.(?:tsx?|[cm]?js|sql|md|txt|json|ya?ml|css|html|svg|ps1|sh|toml)$/.test(file)) continue
  const body = fs.readFileSync(path.join(root, file), 'utf8')
  const terms = [
    ...new Set(
      (body + '\n' + file)
        .match(/auction|bidding|poller|comments|winner|live_stream|bid/gi)
        ?.map((w) => w.toLowerCase()),
    ),
  ]
  const dependency =
    /^(components\/live-cf\/|lib\/features\/(?:commerce|comments)\/|lib\/integrations\/facebook\/)/.test(
      file,
    ) ||
    !!roles[path.basename(file)] ||
    !!routeRoles[file] ||
    domain.test(file)
  if (!terms.length && !dependency) continue
  const relevant = dependency || domain.test(body + '\n' + file) || generated.has(file)
  let category = !relevant
    ? 'Incidental keyword hit'
    : generated.has(file)
      ? 'Generated schema'
      : file.startsWith('supabase/')
        ? 'Database migrations and operations'
        : file.startsWith('scripts/') || file.startsWith('tests/')
          ? 'Tests, fixtures and tooling'
          : file.endsWith('.md') || file.endsWith('.txt')
            ? 'Documentation'
            : file.startsWith('app/')
              ? 'Application routes'
              : file.startsWith('components/')
                ? 'Components'
                : file.startsWith('lib/')
                  ? 'Libraries'
                  : 'Supporting configuration'
  let summary = routeRoles[file] || roles[path.basename(file)]
  const functions = [
    ...body.matchAll(/create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)/gi),
  ].map((x) => x[1])
  const exports = [
    ...body.matchAll(
      /export\s+(?:(?:async|default)\s+)?(?:function|class|const|type|interface)\s+(\w+)/g,
    ),
  ].map((x) => x[1])
  const tests = [...body.matchAll(/(?:test|it)\(\s*['"`]([^'"`\n]+)/g)].map((x) => x[1])
  if (!summary && generated.has(file))
    summary =
      'Generated from the migration registry; includes repeated/overridden historical definitions. Do not infer final runtime behavior from the first definition.'
  if (!summary && file.endsWith('.sql')) {
    const tables = [
      ...new Set(
        [
          ...body.matchAll(
            /(?:create\s+table\s+(?:if\s+not\s+exists\s+)?|alter\s+table\s+)(?:public\.)?(\w+)/gi,
          ),
        ].map((x) => x[1]),
      ),
    ]
    summary =
      (tables.length ? 'Schema/ledger changes: ' + tables.slice(0, 5).join(', ') + '. ' : '') +
      (functions.length
        ? 'Defines/replaces RPCs: ' + [...new Set(functions)].slice(0, 5).join(', ') + '.'
        : 'SQL policies, permissions, seeds or operational diagnostics supporting the engine.')
  }
  if (!summary && tests.length) summary = 'Coverage: ' + tests.slice(0, 2).join('; ') + '.'
  if (!summary && file.includes('/fixtures/'))
    summary =
      'Isolated browser fixture/mocks for ' +
      path.basename(path.dirname(file)) +
      '; no production engine ownership.'
  if (!summary && /\.(md|txt)$/.test(file))
    summary =
      'Documentation: ' +
      (body
        .split(/\r?\n/)
        .find((line) => line.startsWith('# '))
        ?.slice(2) || path.basename(file)) +
      '. Treat historical winner-flow descriptions as version-specific.'
  if (!summary && exports.length)
    summary = 'Supporting module exposing ' + exports.slice(0, 6).join(', ') + '.'
  if (!summary)
    summary = relevant
      ? 'Supporting source/tool referenced by live commerce or its database/tests.'
      : 'Generic comment/bid/winner text match; not an auction-engine implementation.'
  records.push({
    path: file,
    category,
    relevant,
    keywords: terms.join(';'),
    summary,
    exports: [...new Set(exports)],
    sqlFunctions: [...new Set(functions)],
  })
}
records.sort((a, b) => a.category.localeCompare(b.category) || a.path.localeCompare(b.path))
const sources = build().sources
const effective = {}
for (const source of sources) {
  const name = typeof source === 'string' ? source : (source.file ?? source.name)
  if (!name) continue
  const filename = name.startsWith('supabase/') ? name : 'supabase/' + name
  const body = fs.readFileSync(path.join(root, filename), 'utf8')
  for (const match of body.matchAll(
    /create\s+or\s+replace\s+function\s+public\.((?:process_live_auction\w*|finalize_live_auction\w*|claim_auction\w*|auction_numeric_price|configure_auction_session|save_auction_workspace|manage_live_session|queue_live_session_reminders))\s*\(/gi,
  ))
    effective[match[1]] = { file: filename, line: body.slice(0, match.index).split('\n').length }
}
const meta = {
  scope:
    'Source files; excludes dependencies/build/git/provider caches, credentials and reports themselves.',
  scannedPaths: paths.length,
  keywordHits: records.filter((r) => r.keywords).length,
  additionalDependencyFiles: records.filter((r) => !r.keywords).length,
  relevantFiles: records.filter((r) => r.relevant).length,
  incidentalHits: records.filter((r) => !r.relevant).length,
  hooksKeywordHits: records.filter((r) => r.path.startsWith('hooks/')).map((r) => r.path),
  effectiveSqlDefinitions: effective,
  files: records,
}
fs.writeFileSync(
  path.join(__dirname, 'live-auction-index.json'),
  JSON.stringify(meta, null, 2) + '\n',
)
const csv = (value) => '"' + String(value).replaceAll('"', '""') + '"'
fs.writeFileSync(
  path.join(__dirname, 'live-auction-keyword-hits.csv'),
  [
    'path,category,relevant,keywords,responsibility',
    ...records.map((r) =>
      [r.path, r.category, r.relevant, r.keywords, r.summary].map(csv).join(','),
    ),
  ].join('\n') + '\n',
)
const lines = [
  '# Live streaming and auction file inventory',
  '',
  `${meta.scannedPaths} source paths enumerated; ${meta.keywordHits} filename/content keyword hits plus ${meta.additionalDependencyFiles} explicitly included dependency files; ${meta.relevantFiles} relevant/supporting files; ${meta.incidentalHits} incidental hits.`,
  '',
  meta.scope,
  '',
  'All relevant files are listed below. The CSV/JSON also retain incidental broad matches (for example general comments/security wording). Responsibilities for supporting files are derived from exported symbols, SQL objects and test names; the architecture report contains manually traced behavior.',
  '',
  'No keyword hits were found under hooks/. Auction polling effects live in components; components/inbox/useAuctionStatuses.ts is the dedicated auction status hook.',
  '',
]
for (const category of [...new Set(records.filter((r) => r.relevant).map((r) => r.category))]) {
  lines.push('## ' + category, '', '| File | Responsibility |', '|---|---|')
  for (const record of records.filter((r) => r.relevant && r.category === category))
    lines.push(
      `| [${record.path}](../${encodeURI(record.path)}) | ${record.summary.replaceAll('|', '/').replaceAll('\n', ' ')} |`,
    )
  lines.push('')
}
lines.push(
  '## Effective SQL entrypoints',
  '',
  'These are the last explicit definitions in the registered migration order. The isolated reproduction additionally inspects installed pg_get_functiondef results, because older migrations also contain dynamic definition rewrites.',
  '',
  '| Function | Last explicit source |',
  '|---|---|',
)
for (const [name, source] of Object.entries(effective))
  lines.push(`| ${name} | [${source.file}:${source.line}](../${source.file}#L${source.line}) |`)
fs.writeFileSync(path.join(__dirname, 'live-auction-files.md'), lines.join('\n') + '\n')
console.log(
  JSON.stringify(
    {
      scannedPaths: meta.scannedPaths,
      keywordHits: meta.keywordHits,
      relevantFiles: meta.relevantFiles,
      incidentalHits: meta.incidentalHits,
      effectiveSqlDefinitions: effective,
    },
    null,
    2,
  ),
)
