const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, dependencies = {}) {
  const context = {
    exports: {},
    process: { env: { GEMINI_API_KEY: 'mock-key-never-used' } },
    console,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name === '@/lib/features/follow-ups/availability') return availability
      if (name === 'server-only') return {}
      if (name.startsWith('node:')) return require(name)
      throw new Error('Unexpected dependency: ' + name)
    },
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    context,
  )
  return context.exports
}
const availability = load('lib/features/follow-ups/availability.ts')
const forbidden = () => {
  assert.fail('Paused follow-ups must not access the database, queue, provider or tenant loader')
}
const db = { rpc: forbidden, from: forbidden }
class InboxError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
const next = {
  NextResponse: {
    json: (body, options = {}) => ({
      body,
      status: options.status ?? 200,
      headers: options.headers,
    }),
  },
}

test('the shared project flag defaults to paused', () => {
  assert.equal(availability.SMART_FOLLOW_UP_ENABLED, false)
})

test('direct worker calls leave queued jobs untouched and cannot send even with the legacy bypass', async () => {
  const api = load('lib/features/follow-ups/follow-ups.ts', {
    '@/lib/integrations/facebook/client': {
      pageTokenFor: forbidden,
      sendMessageWithReceipt: forbidden,
    },
  })
  for (const bypass of [false, true]) {
    const result = await api.runFollowUps(db, 'tenant', Date.now() + 45_000, bypass)
    assert.equal(result.sendEnabled, false)
    assert.equal(result.sent, 0)
    assert.equal(result.jobs.length, 0)
    assert.equal(result.remaining, false)
  }
})

test('webhook observers and AI analysis stop before feature checks, queries or provider work', async () => {
  const api = load('lib/features/follow-ups/followup-ai.ts', {
    '@google/genai': { GoogleGenAI: forbidden },
    '@/lib/features/agents/ai-agent': { aiModel: forbidden },
    '@/lib/feature-access': { hasFeature: forbidden },
  })
  assert.equal(await api.analyzeFollowUp(db, 'tenant', 'customer', 'message'), null)
  await api.observeFollowUpMessage(db, 'tenant', 'customer', 'message')
})

test('all follow-up management endpoints share a guard that rejects before database access', async () => {
  const api = load('lib/features/follow-ups/smart-followup-server.ts', {
    '@/lib/features/inbox/inbox-server': { InboxError, inboxTenant: forbidden },
    '@/lib/feature-access': { hasFeature: forbidden },
    '@/lib/features/follow-ups/smart-followup-types': {},
    '@/lib/utils': {},
    '@/lib/features/billing/billing': { getBilling: forbidden },
  })
  await assert.rejects(api.followUpTenant({}, 'tenant'), (error) => {
    assert.equal(error.status, 503)
    assert.equal(error.code, 'FOLLOW_UPS_PAUSED')
    return true
  })
})

test('manual run endpoint returns paused without initializing the worker or database', async () => {
  const api = load('app/api/follow-ups/run/route.ts', {
    'next/server': next,
    '@/lib/feature-access': { hasFeature: forbidden, featureLockedResponse: forbidden },
    '@/lib/supabase/server': { supabaseAdmin: forbidden },
    '@/lib/auth': { getActor: forbidden, canAccessTenant: forbidden },
    '@/lib/features/follow-ups/follow-ups': { runFollowUps: forbidden },
    '@/lib/utils': {},
    '@/lib/features/billing/billing': { getBilling: forbidden },
    '@/lib/features/billing/plans': { canUseFollowUps: forbidden },
  })
  const response = await api.POST({ json: forbidden })
  assert.equal(response.status, 503)
  assert.equal(response.body.code, 'FOLLOW_UPS_PAUSED')
  assert.equal(response.headers['Cache-Control'], 'no-store')
})

test('manual follow-up AI drafts cannot consume AI quota while paused', async () => {
  const { AiAgentError } = load('lib/features/agents/ai-errors.ts')
  const api = load('lib/features/follow-ups/manual-followup-ai.ts', {
    '@google/genai': { GoogleGenAI: forbidden },
    '@/lib/features/agents/ai-agent': { AiAgentError, aiModel: forbidden },
    '@/lib/features/inbox/inbox-automation-window': { assertAutomationWindow: forbidden },
    '@/lib/features/follow-ups/manual-followup-context': { followUpChatDraft: forbidden },
  })
  await assert.rejects(
    api.draftManualFollowUp(db, 'tenant', 'customer', 'payment'),
    (error) => error.code === 'FOLLOW_UPS_PAUSED' && error.status === 503,
  )
})

test('the shared AI overview cannot change follow-up settings through direct API calls', async () => {
  const api = load('app/api/agent-control/overview/route.ts', {
    'next/server': next,
    '@/lib/full-access': {},
    '@/lib/features/agents/agent-control-server': {
      agentControlTenant: async () => ({ db, tenantId: 'tenant', actor: { id: 'owner' } }),
    },
    '@/lib/auth': { canAccessTenant: forbidden },
    '@/lib/features/agents/agent-overview-server': { loadAgentOverview: forbidden },
    '@/lib/features/agents/agent-overview-core': { CAPABILITY_KEYS: ['followup'] },
    '@/lib/features/inbox/inbox-server': {
      InboxError,
      checkRpc: forbidden,
      inboxError: (error) => next.NextResponse.json({ code: error.code }, { status: error.status }),
    },
    '@/lib/features/banking/banks': {},
  })
  for (const enabled of [true, false]) {
    const response = await api.PATCH({
      headers: new Headers({ origin: 'https://example.test' }),
      nextUrl: new URL('https://example.test/api/agent-control/overview?tenantId=tenant'),
      json: async () => ({ capability: 'followup', enabled }),
    })
    assert.equal(response.status, 503)
    assert.equal(response.body.code, 'FOLLOW_UPS_PAUSED')
  }
})

test('the inbox follow-up control renders nothing and makes no API requests while paused', () => {
  const api = load('components/inbox/FollowUpContactControl.tsx', {
    react: {
      useState: (initial) => [initial, forbidden],
      useEffect: (effect) => effect(),
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    '@/lib/utils': { apiError: forbidden },
  })
  assert.equal(api.FollowUpContactControl({ tenantId: 'tenant', customerId: 'customer' }), null)
})

test('the follow-up page redirects to the main overview before loading tenant data', async () => {
  const api = load('app/(dashboard)/chatbot/follow-ups/page.tsx', {
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      redirect: (target) => {
        assert.equal(target, '/overview')
        throw new Error('EXPECTED_REDIRECT')
      },
    },
    '@/lib/feature-access': { hasFeature: forbidden },
    '@/components/shared/FeatureLocked': {},
    '@/lib/supabase/server': { supabaseAdmin: forbidden, supabaseServer: forbidden },
    '@/lib/tenant': { getActiveTenant: forbidden },
    '@/lib/features/follow-ups/smart-followup-server': { followUpDashboard: forbidden },
    '@/components/shared/SetupNotice': {},
    '@/components/chatbot/FollowUpsClient': {},
  })
  await assert.rejects(api.default(), /EXPECTED_REDIRECT/)
})

test('rendered navigation hides follow-ups while retaining chat and image assistant links', () => {
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const api = load('components/shell/AppShell.tsx', {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    'next/image': { default: () => null },
    'next/navigation': {
      usePathname: () => '/chatbot/conversations',
      useRouter: () => ({ refresh() {} }),
    },
    'lucide-react': require('lucide-react'),
    '@/components/shell/PageTransition': { PageTransition: ({ children }) => children },
    '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  })
  const html = renderToStaticMarkup(
    React.createElement(api.AppShell, { page: null, email: 'test@example.test', children: null }),
  )
  assert.doesNotMatch(html, /href="\/chatbot\/follow-ups"/)
  assert.match(html, /href="\/chatbot\/conversations"/)
  assert.match(html, /href="\/chatbot\/images"/)
})
