import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect } from 'node:net'
import { Socket as DatagramSocket } from 'node:dgram'
import * as dns from 'node:dns'
import * as tls from 'node:tls'

test('test network guard immediately blocks external fetch, HTTP, HTTPS, and raw socket attempts', () => {
  const blocked = (cause: unknown) =>
    cause instanceof Error && 'code' in cause && cause.code === 'ERR_TEST_NETWORK_BLOCKED'

  assert.throws(() => fetch('https://example.invalid/blocked'), blocked)
  assert.throws(() => httpRequest({ hostname: 'example.invalid', port: 80 }), blocked)
  assert.throws(() => httpsRequest({ hostname: 'example.invalid', port: 443 }), blocked)
  assert.throws(() => connect({ host: 'example.invalid', port: 443 }), blocked)
  assert.throws(() => connect({ path: 'C:\\not-a-local-network-socket' }), blocked)
  assert.throws(() => tls.connect({ host: 'example.invalid', port: 443 }), blocked)
  assert.throws(() => dns.lookup('example.invalid', () => undefined), blocked)

  const socket = Object.create(DatagramSocket.prototype) as DatagramSocket
  assert.throws(() => socket.connect(53, 'example.invalid'), blocked)
  assert.throws(() => socket.send('x', 53, 'example.invalid'), blocked)
})

test('test network guard blocks test attempts to read or load .env files', () => {
  assert.throws(() => readFileSync('.env.local'), {
    code: 'ERR_TEST_ENV_FILE_ACCESS_BLOCKED',
  })
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile(path?: string): void }).loadEnvFile
  assert.throws(() => loadEnvFile('.env.local'), {
    code: 'ERR_TEST_ENV_FILE_ACCESS_BLOCKED',
  })
})
