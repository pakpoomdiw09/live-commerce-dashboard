const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')

const token = 'EAA_TEST_PAGE_SECRET'
const recipientId = '123456789012345'
const messageText = 'private customer message'
const prefix = '[facebook/send] Graph API request failed '

function fixture(fetch) {
  const logs = []
  const context = {
    exports: {},
    process: { env: {} },
    AbortSignal,
    fetch,
    console: { error: (...args) => logs.push(args) },
    require: (name) => {
      assert.equal(name, '@/lib/safe-logging')
      return { createLogRequestId: () => 'test-request', logSafeEvent() {}, maskErrorCode() {} }
    },
  }
  vm.runInNewContext(
    ts.transpileModule(readFileSync('lib/integrations/facebook/client.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  )
  return { api: context.exports, logs }
}

function diagnostic(logs) {
  assert.equal(logs.length, 1)
  assert.equal(logs[0].length, 1)
  assert.ok(logs[0][0].startsWith(prefix))
  for (const secret of [token, recipientId, messageText])
    assert.ok(!logs[0][0].includes(secret), secret)
  return JSON.parse(logs[0][0].slice(prefix.length))
}

test('ordinary text replies POST RESPONSE, recipient and message to /me/messages', async () => {
  const f = fixture(async (url, options) => {
    assert.match(url, /\/me\/messages$/)
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, `Bearer ${token}`)
    assert.deepEqual(JSON.parse(options.body), {
      messaging_type: 'RESPONSE',
      recipient: { id: recipientId },
      message: { text: messageText },
    })
    return Response.json({ message_id: 'mid-test' })
  })
  assert.equal(
    await f.api.sendMessageWithReceipt(token, recipientId, { text: messageText }),
    'mid-test',
  )
  assert.equal(f.logs.length, 0)
})

test('HTTP 400 logs the complete provider response, trace ID and message beyond 8000 characters', async () => {
  const explanation = 'Permission detail '.repeat(600) + ' END_OF_PROVIDER_MESSAGE'
  const f = fixture(async () =>
    Response.json(
      {
        error: {
          message: `${explanation} ${token} ${recipientId} ${messageText}`,
          type: 'OAuthException',
          code: 100,
          error_subcode: 2018001,
          fbtrace_id: 'trace-test',
          error_data: { reason: 'recipient unavailable', access_token: token },
        },
      },
      { status: 400 },
    ),
  )
  await assert.rejects(
    f.api.sendMessageWithReceipt(token, recipientId, { text: messageText }),
    (error) => error instanceof f.api.SendApiError && error.code === 100,
  )
  const details = diagnostic(f.logs)
  assert.equal(details.httpStatus, 400)
  assert.ok(details.message.includes(explanation))
  const response = JSON.parse(details.responseData)
  assert.equal(response.error.fbtrace_id, 'trace-test')
  assert.equal(response.error.error_data.reason, 'recipient unavailable')
  assert.equal(response.error.error_data.access_token, '[REDACTED]')
})

test('non-JSON errors retain their full response text', async () => {
  const responseText = 'upstream failure '.repeat(600) + ' END_OF_RESPONSE'
  const f = fixture(async () => new Response(responseText, { status: 502 }))
  await assert.rejects(f.api.sendMessageWithReceipt(token, recipientId, { text: messageText }))
  assert.equal(diagnostic(f.logs).responseData, responseText)
})

test('network errors log the original complete message before returning the generic error', async () => {
  const explanation = 'connection detail '.repeat(600) + ' END_OF_NETWORK_ERROR'
  const f = fixture(async () => {
    throw new Error(`${explanation} Bearer ${token}`)
  })
  await assert.rejects(
    f.api.sendMessageWithReceipt(token, recipientId, { text: messageText }),
    /Facebook request could not be completed/,
  )
  assert.ok(diagnostic(f.logs).message.includes(explanation))
})

test('Axios-style failures log response.data without logging request headers', async () => {
  const f = fixture(async () => {
    throw Object.assign(new Error('Request failed with status code 400'), {
      response: {
        status: 400,
        data: { error: { message: 'Invalid recipient', fbtrace_id: 'trace-axios' } },
      },
      config: { headers: { Authorization: `Bearer ${token}` } },
    })
  })
  await assert.rejects(f.api.sendMessageWithReceipt(token, recipientId, { text: messageText }))
  const details = diagnostic(f.logs)
  assert.equal(details.httpStatus, 400)
  assert.equal(JSON.parse(details.responseData).error.fbtrace_id, 'trace-axios')
})

test('private comment replies retain their comment recipient and log rejected response details', async () => {
  const f = fixture(async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), {
      recipient: { comment_id: recipientId },
      message: { text: messageText },
    })
    return Response.json(
      { error: { message: 'Private reply is no longer available' } },
      { status: 400 },
    )
  })
  await assert.rejects(f.api.privateReply(token, recipientId, { text: messageText }))
  assert.equal(
    JSON.parse(diagnostic(f.logs).responseData).error.message,
    'Private reply is no longer available',
  )
})
