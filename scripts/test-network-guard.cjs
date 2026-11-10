// Loaded before automated test files. Tests may use loopback services only.
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const net = require('node:net')
const tls = require('node:tls')
const dgram = require('node:dgram')
const dns = require('node:dns')

const BLOCKED_NETWORK_CODE = 'ERR_TEST_NETWORK_BLOCKED'
const BLOCKED_ENV_CODE = 'ERR_TEST_ENV_FILE_ACCESS_BLOCKED'

function envPath(value) {
  if (value instanceof URL && value.protocol === 'file:') value = require('node:url').fileURLToPath(value)
  if (typeof value !== 'string' && !Buffer.isBuffer(value)) return false
  const name = String(value).replaceAll('\\', '/').split('/').at(-1) ?? ''
  return /^\.env(?:\.|$)/i.test(name)
}

function assertNotEnvFile(value, operation) {
  if (!envPath(value)) return
  const error = new Error(`Automated tests may not access .env files (${operation})`)
  error.code = BLOCKED_ENV_CODE
  throw error
}

for (const method of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
  const original = fs[method]
  if (typeof original !== 'function') continue
  fs[method] = function guardedEnvRead(file, ...args) {
    assertNotEnvFile(file, `fs.${method}`)
    return Reflect.apply(original, this, [file, ...args])
  }
}
for (const promiseFs of new Set([fs.promises, require('node:fs/promises')])) {
  for (const method of ['readFile', 'open']) {
    const original = promiseFs[method]
    if (typeof original !== 'function') continue
    promiseFs[method] = function guardedEnvPromiseRead(file, ...args) {
      assertNotEnvFile(file, `fs.promises.${method}`)
      return Reflect.apply(original, this, [file, ...args])
    }
  }
}
if (typeof process.loadEnvFile === 'function') {
  process.loadEnvFile = function blockedEnvLoad(file) {
    assertNotEnvFile(file ?? '.env', 'process.loadEnvFile')
    const error = new Error('Automated tests may not load .env files')
    error.code = BLOCKED_ENV_CODE
    throw error
  }
}

function hostFrom(value) {
  if (value instanceof URL) return value.hostname
  if (value && typeof value === 'object') {
    if (value.socketPath || (value.path && !value.host && !value.hostname)) return '__local_socket__'
    return value.hostname ?? value.host ?? value.servername ?? 'localhost'
  }
  if (typeof value === 'number' || value == null) return 'localhost'
  if (typeof value !== 'string') {
    if (typeof value.url === 'string') return hostFrom(value.url)
    return null
  }
  const address = value.trim()
  if (!address) return null
  try {
    return new URL(address).hostname
  } catch {
    if (address.startsWith('[') && address.includes(']')) return address.slice(1, address.indexOf(']'))
    if ((address.match(/:/g) ?? []).length === 1) return address.slice(0, address.lastIndexOf(':'))
    return address
  }
}

function assertLocal(host, mechanism) {
  const normalized = String(host ?? '').toLowerCase().replace(/^\[|\]$/g, '')
  if (normalized === 'localhost' || normalized === '127.0.0.1') return
  const error = new Error(`Blocked outbound ${mechanism} to non-localhost address: ${normalized || '(unknown)'}`)
  error.code = BLOCKED_NETWORK_CODE
  throw error
}

function requestTarget(input, options) {
  let host = hostFrom(input)
  if (options && typeof options === 'object' && (options.hostname || options.host))
    host = options.hostname ?? options.host
  if (input && typeof input === 'object' && input.socketPath) host = '__local_socket__'
  if (options?.socketPath) host = '__local_socket__'
  return host
}

for (const module of [http, https]) {
  for (const method of ['request', 'get']) {
    const original = module[method]
    module[method] = function guardedHttpRequest(input, options, ...args) {
      assertLocal(requestTarget(input, options), `${module === https ? 'https' : 'http'}.${method}`)
      return Reflect.apply(original, this, [input, options, ...args])
    }
  }
}

const originalFetch = globalThis.fetch
if (typeof originalFetch === 'function') {
  globalThis.fetch = function guardedFetch(input, ...args) {
    const target = input instanceof URL || typeof input === 'string' ? input : input?.url
    assertLocal(hostFrom(target), 'fetch')
    return Reflect.apply(originalFetch, this, [input, ...args])
  }
}

function socketHost(args) {
  const [target, host] = args
  if (target && typeof target === 'object') return hostFrom(target)
  if (typeof target === 'number') return typeof host === 'string' ? host : 'localhost'
  if (typeof target === 'string') return '__local_socket__'
  return 'localhost'
}

for (const method of ['connect', 'createConnection']) {
  const original = net[method]
  net[method] = function guardedSocket(...args) {
    assertLocal(socketHost(args), `net.${method}`)
    return Reflect.apply(original, this, args)
  }
}
const originalSocketConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedRawSocket(...args) {
  assertLocal(socketHost(args), 'net.Socket.connect')
  return Reflect.apply(originalSocketConnect, this, args)
}

const originalTlsConnect = tls.connect
tls.connect = function guardedTlsConnect(first, second, ...args) {
  const host =
    typeof first === 'number'
      ? typeof second === 'string'
        ? second
        : second && typeof second === 'object'
          ? hostFrom(second)
          : 'localhost'
      : hostFrom(first)
  assertLocal(host, 'tls.connect')
  return Reflect.apply(originalTlsConnect, this, [first, second, ...args])
}

const originalDgramConnect = dgram.Socket.prototype.connect
dgram.Socket.prototype.connect = function guardedDatagramConnect(port, address, ...args) {
  assertLocal(address, 'dgram.connect')
  return Reflect.apply(originalDgramConnect, this, [port, address, ...args])
}
const originalDgramSend = dgram.Socket.prototype.send
dgram.Socket.prototype.send = function guardedDatagramSend(...args) {
  const address = [args[2], args[3], args[4]].find((value) => typeof value === 'string')
  if (address) assertLocal(address, 'dgram.send')
  return Reflect.apply(originalDgramSend, this, args)
}

function guardDnsMethod(object, method, hostIndex = 0) {
  const original = object?.[method]
  if (typeof original !== 'function') return
  object[method] = function guardedDnsLookup(...args) {
    assertLocal(hostFrom(args[hostIndex]), `dns.${method}`)
    return Reflect.apply(original, this, args)
  }
}
for (const method of ['lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  guardDnsMethod(dns, method)
  guardDnsMethod(dns.promises, method)
  guardDnsMethod(dns.Resolver.prototype, method)
}
