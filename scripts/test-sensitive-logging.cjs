const { test } = require('node:test'),
  assert = require('node:assert/strict')
const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const loadLogger = require('./helpers/load-safe-logging.cjs')
const { fixture, validSlip, req } = require('./test-payment-api.cjs')
const secret = 'TEST_ONLY_EAA_PRIVATE_TOKEN_9zc7',
  account = '9876543210987',
  customer = 'PRIVATE_CUSTOMER_NAME'
const poison = `${secret} bank=${account} ${customer}\nFAKE_LOG_ENTRY`
const keys = ['requestId', 'eventType', 'status', 'durationMs', 'errorCode']
function capture() {
  const calls = [],
    output = {}
  for (const level of ['log', 'info', 'warn', 'error', 'debug'])
    output[level] = (...args) => calls.push(args)
  return { calls, output, logger: loadLogger(output) }
}
function safeLogs(calls) {
  assert.ok(calls.length)
  const serialized = JSON.stringify(calls)
  for (const value of [
    secret,
    account,
    customer,
    'FAKE_LOG_ENTRY',
    'responseBody',
    'access_token',
    'Authorization',
    'transRef',
    'receiverAccount',
  ])
    assert.ok(!serialized.includes(value), value)
  return calls.map((args) => {
    assert.equal(args.length, 1)
    assert.equal(typeof args[0], 'string')
    const row = JSON.parse(args[0])
    assert.ok(Object.keys(row).every((key) => keys.includes(key)))
    assert.match(row.requestId, /^[a-f0-9-]{36}$/)
    assert.ok(Number.isFinite(row.durationMs) && row.durationMs >= 0)
    if (row.errorCode) assert.match(row.errorCode, /^[A-Z_]+\*\*\*$/)
    return row
  })
}
function facebook(fetch) {
  const log = capture(),
    context = {
      exports: {},
      console: log.output,
      URL,
      AbortSignal,
      process: {
        env: {
          NODE_ENV: 'production',
          FB_DEBUG: 'true',
          FB_APP_ID: 'fake-app',
          FB_APP_SECRET: secret,
        },
      },
      fetch,
      require(name) {
        assert.equal(name, '@/lib/safe-logging')
        return log.logger
      },
    }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('lib/integrations/facebook/client.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return { api: context.exports, ...log }
}

test('central logger drops unknown, nested, cyclic and attacker-controlled fields without serializing them', () => {
  const { logger, calls } = capture(),
    payload = {
      requestId: secret,
      eventType: poison,
      status: poison,
      durationMs: Infinity,
      errorCode: poison,
      token: secret,
      account,
      customer,
    }
  payload.responseBody = payload
  payload.toJSON = () => {
    throw Error('Must not serialize original payload')
  }
  logger.logSafeEvent(payload)
  const [record] = safeLogs(calls)
  assert.equal(record.eventType, 'system.safe_log')
  assert.equal(record.durationMs, 0)
  assert.equal(record.errorCode, 'UNKNOWN_***')
  assert.equal(logger.maskErrorCode('23505'), 'DB_CONFLICT_***')
  assert.equal(logger.maskErrorCode(190), 'AUTH_***')
  assert.equal(logger.maskErrorCode(poison), 'UNKNOWN_***')
  assert.doesNotThrow(() =>
    loadLogger({
      error() {
        throw Error(poison)
      },
    }).logSafeEvent({
      requestId: logger.createLogRequestId(),
      eventType: 'payment.verify_slip',
      status: 'failed',
      durationMs: 0,
    }),
  )
  assert.doesNotThrow(() =>
    logger.logSafeEvent(
      new Proxy(
        {},
        {
          get() {
            throw Error(poison)
          },
        },
      ),
    ),
  )
})

test('successful Facebook customer and Page lookups retain profiles but never log identities, image URLs or credentials even in debug mode', async () => {
  const f = facebook(async (url) => {
    if (url.includes('debug_token'))
      return Response.json({
        data: {
          is_valid: true,
          type: 'PAGE',
          profile_id: '12345',
          scopes: ['pages_messaging'],
          expires_at: 0,
          access_token: secret,
        },
      })
    if (url.includes('/picture?'))
      return Response.json({ data: { url: 'https://example.test/' + secret } })
    return Response.json({
      id: '12345',
      name: customer,
      first_name: customer,
      profile_pic: 'https://example.test/' + account,
      picture: { data: { url: 'https://example.test/' + secret } },
    })
  })
  const profile = await f.api.getCustomerProfile(secret, '56789')
  assert.equal(profile.display_name, customer)
  assert.equal(profile.avatar_url, 'https://example.test/' + account)
  assert.equal((await f.api.getPageProfile(secret)).name, customer)
  assert.equal(await f.api.getPagePicture('12345', secret), 'https://example.test/' + secret)
  assert.equal(await f.api.getPageTokenStatus(secret, '12345'), 'verified')
  safeLogs(f.calls)
})

test('Facebook refusal, malformed JSON and nested network errors cannot escape through logs or thrown Error objects', async () => {
  for (const scenario of ['refused', 'network', 'malformed']) {
    const f = facebook(async () => {
      if (scenario === 'network')
        throw Object.assign(Error(poison), {
          name: poison,
          cause: { request: { headers: { Authorization: secret } } },
        })
      if (scenario === 'malformed') return new Response(poison, { status: 502 })
      return Response.json(
        { error: { message: poison, code: 10, error_subcode: 2018278, error_data: { account } } },
        { status: 400 },
      )
    })
    assert.equal(Object.keys(await f.api.getCustomerProfile(secret, '56789')).length, 0)
    await f.api.getPageProfile(secret)
    await f.api.getPagePicture('12345', secret)
    await f.api.getPageTokenStatus(secret, '12345')
    for (const run of [
      () => f.api.sendMessageWithReceipt(secret, '56789', { text: poison }),
      () => f.api.replyToComment(secret, '12345', poison),
      () => f.api.privateReply(secret, '12345', { text: poison }),
    ]) {
      await assert.rejects(run(), (error) => {
        assert.ok(!String(error.stack).includes(secret))
        assert.ok(!JSON.stringify(error).includes(account))
        assert.equal(error.cause, undefined)
        if (error instanceof f.api.SendApiError && scenario === 'refused')
          assert.equal(f.api.isWindowOrTagError(error), true)
        return true
      })
    }
    const check = await f.api.inspectPageToken(secret, '12345')
    assert.ok(!JSON.stringify(check).includes(secret))
    safeLogs(f.calls)
  }
})

test('payment success uses a server-generated request ID and never logs raw proof, amount, bank details or customer identity', async () => {
  const slip = validSlip()
  Object.assign(slip.raw, { access_token: secret, apiKey: secret, privatePayload: poison })
  Object.assign(slip.raw.data, { sender: { name: customer, account }, privatePayload: poison })
  const f = fixture({ slip })
  const response = await f.verify(
    req({}, undefined, { 'x-request-id': secret, Authorization: 'Bearer ' + secret }),
  )
  assert.equal(response.status, 200)
  assert.equal(f.state.activations, 1)
  const rows = safeLogs(f.logs)
  assert.ok(rows.every((row) => row.requestId === response.headers['X-Request-ID']))
  assert.ok(
    rows.every(
      (row) =>
        !Object.hasOwn(row, 'amount') &&
        !Object.hasOwn(row, 'receivedAmount') &&
        !Object.hasOwn(row, 'balance'),
    ),
  )
  const repeat = await f.verify(req())
  assert.equal(repeat.status, 200)
  assert.equal(f.state.activations, 1)
  safeLogs(f.logs)
})

test('payment rejection, database errors and exceptions in auth/provider/billing log only safe metadata', async () => {
  for (const options of [
    { slip: { ...validSlip(), amount: 999 } },
    { proofSaveError: { code: poison, message: poison, details: { account } } },
    { activationFailures: 1 },
    { authError: Object.assign(Error(poison), { name: secret, cause: { account } }) },
    { providerError: Object.assign(Error(poison), { name: secret, cause: { account } }) },
    { billingError: Object.assign(Error(poison), { name: secret, cause: { account } }) },
  ]) {
    const f = fixture(options),
      response = await f.verify(req())
    assert.ok(response.status >= 400)
    safeLogs(f.logs)
    assert.ok(!JSON.stringify(response).includes(secret))
    assert.equal(response.headers['Cache-Control'], 'no-store')
  }
})

test('target files have no direct console or error tracking calls that bypass centralized redaction', () => {
  for (const file of [
    'lib/integrations/facebook/client.ts',
    'app/api/payments/verify-slip/route.ts',
  ]) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    )
    const inspect = (node) => {
      if (ts.isCallExpression(node))
        assert.ok(
          !/\bconsole\.|captureException|captureMessage/.test(node.expression.getText(source)),
          file,
        )
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
})
