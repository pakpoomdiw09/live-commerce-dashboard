import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export function loadEnvLocal(
  envPath = path.resolve(process.cwd(), '.env.local'),
  logger = console,
) {
  if (!fs.existsSync(envPath)) {
    logger.warn('⚠️ ไม่พบไฟล์ .env.local ที่ root directory')
    return {}
  }
  const content = fs.readFileSync(envPath, 'utf8')
  const env = {}
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1)
    env[match[1]] = value
  }
  return env
}

function maskToken(token) {
  if (!token) return 'ไม่มี Token ระบุ'
  if (token.length <= 10) return '***'
  return `${token.slice(0, 6)}...${token.slice(-4)}`
}

function redact(value, env) {
  let text = value
  const secrets = Object.entries(env)
    .filter(([key, secret]) => /TOKEN|SECRET|API_KEY|SERVICE_ROLE_KEY/i.test(key) && secret)
    .map(([, secret]) => String(secret))
    .sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    text = text.split(secret).join('[REDACTED]')
    text = text.split(encodeURIComponent(secret)).join('[REDACTED]')
  }
  return text
    .replace(/Bearer\s+[^\s"'&,)]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:access_token|appsecret_proof|client_secret)=)[^\s&"',)]+/gi, '$1[REDACTED]')
}

// Running this script sends one real Messenger message. There are no automatic retries.
export async function testSend({
  env = process.env,
  localEnv = {},
  fetchImpl = fetch,
  logger = console,
} = {}) {
  const token = (env.PAGE_ACCESS_TOKEN || localEnv.PAGE_ACCESS_TOKEN || '').trim()
  const recipientId = (env.RECIPIENT_PSID || '').trim()
  const version = (env.FB_GRAPH_VERSION || localEnv.FB_GRAPH_VERSION || 'v20.0').trim()
  // Explicit diagnostic option, not an automatic retry after a window rejection.
  const tag = (env.TEST_MESSAGE_TAG || '').trim()
  const messagingType = tag ? 'MESSAGE_TAG' : 'RESPONSE'
  const diagnosticEnv = { ...localEnv, ...env, PAGE_ACCESS_TOKEN: token }
  logger.log('--- เริ่มการทดสอบส่งข้อความ (test-send.mjs) ---')
  logger.log(`Graph API Version : ${version}`)
  logger.log(`PAGE_ACCESS_TOKEN : ${maskToken(token)}`)
  logger.log(`Recipient PSID    : ${recipientId || 'ไม่ได้ระบุ'}`)
  logger.log(`Messaging Type    : ${messagingType}`)
  if (tag) logger.log(`Message Tag       : ${tag}`)
  if (!token) throw new Error('ไม่พบ PAGE_ACCESS_TOKEN ใน .env.local หรือสภาพแวดล้อมระบบ')
  if (!/^\d+$/.test(recipientId))
    throw new Error(
      'ตั้งค่า RECIPIENT_PSID เป็น Facebook PSID ของลูกค้า (ตัวเลข ไม่ใช่ customerId แบบ UUID)\n' +
        'ตัวอย่าง PowerShell:\n  $env:RECIPIENT_PSID="1234567890123456"\n  node .\\test-send.mjs',
    )
  if (!/^v\d+\.\d+$/.test(version)) throw new Error('FB_GRAPH_VERSION ต้องอยู่ในรูปแบบ v24.0')
  if (tag && !/^[A-Z][A-Z0-9_]*$/.test(tag))
    throw new Error('TEST_MESSAGE_TAG ต้องเป็นชื่อ tag ตัวพิมพ์ใหญ่ เช่น CONFIRMED_EVENT_UPDATE')

  try {
    const response = await fetchImpl(`https://graph.facebook.com/${version}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_type: messagingType,
        recipient: { id: recipientId },
        message: { text: env.TEST_MESSAGE_TEXT || 'ทดสอบส่งข้อความตรงผ่าน test-send.mjs' },
        ...(tag ? { tag } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    })
    const raw = await response.text()
    let data
    try {
      data = JSON.parse(raw)
    } catch {
      // Retain non-JSON error responses as well.
    }
    const success = response.ok && !data?.error
    logger.log(`HTTP Status: ${response.status} (${response.statusText})`)
    const result = `${success ? '✅ ส่งข้อความสำเร็จ!' : '❌ Meta Graph API ปฏิเสธการส่งข้อความ:'}\n${redact(
      data === undefined ? raw : JSON.stringify(data, null, 2),
      diagnosticEnv,
    )}`
    if (success) logger.log(result)
    else logger.error(result)
    return success
  } catch (error) {
    logger.error(
      '❌ ไม่สามารถเชื่อมต่อเครือข่ายไปยัง Meta Graph API: ' +
        redact(error instanceof Error ? error.message : String(error), diagnosticEnv),
    )
    return false
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  let localEnv = {}
  try {
    localEnv = loadEnvLocal()
    if (!(await testSend({ localEnv }))) process.exitCode = 1
  } catch (error) {
    console.error(
      redact(error instanceof Error ? error.message : String(error), {
        ...localEnv,
        ...process.env,
      }),
    )
    process.exitCode = 1
  }
}
