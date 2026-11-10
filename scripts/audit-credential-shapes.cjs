const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = process.cwd()
const patterns = [
  ['META_ACCESS_TOKEN', /\bEA[A-Za-z0-9]{50,}\b/g],
  ['SUPABASE_SECRET_KEY', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ['APP_OR_CLIENT_SECRET', /\b(?:app|client)[_-]?secret\s*[:=]\s*["']?([a-f0-9]{32})/gi],
  [
    'CREDENTIAL_ASSIGNMENT_LITERAL',
    /\b(access[_-]?token|refresh[_-]?token|api[_-]?key|service[_-]?role[_-]?key|password|private[_-]?key|secret)\s*[:=]\s*(["'])([A-Za-z0-9_./+=-]{20,})\2/gi,
  ],
  [
    'ENV_CREDENTIAL_ASSIGNMENT',
    /^\s*([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|PRIVATE_KEY))\s*=\s*([^\s#]{20,})/i,
  ],
]
const findings = []

function isFixture(relativePath, line) {
  return (
    /\/(?:tests?|fixtures?|mocks?|examples?)\//i.test(`/${relativePath}`) ||
    /(?:^|\/)test-[^/]+\.(?:cjs|mjs|js|ts)$/i.test(relativePath) ||
    /\.env\.example$/i.test(relativePath) ||
    /dummy|placeholder|replace[_ -]?me|your[_ -]?(?:key|token|secret)|example[_ -]?(?:key|token|secret)/i.test(line)
  )
}

const trackedAndUnignored = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean)
const environmentFiles = fs
  .readdirSync(root)
  .filter((name) => name === '.env' || name.startsWith('.env.'))
const files = new Set([...trackedAndUnignored, ...environmentFiles])

for (const relativePath of files) {
  const absolutePath = path.join(root, relativePath)
  let content
  try {
    if (fs.statSync(absolutePath).size > 5_000_000) continue
    content = fs.readFileSync(absolutePath, 'utf8')
  } catch {
    continue
  }
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    for (const [category, pattern] of patterns) {
      if (category === 'ENV_CREDENTIAL_ASSIGNMENT' && !/^\.env(?:\.|$)/i.test(path.basename(relativePath)))
        continue
      pattern.lastIndex = 0
      const match = pattern.exec(lines[index])
      if (!match) continue
      findings.push({
        path: relativePath.replaceAll('\\', '/'),
        line: index + 1,
        category,
        key:
          category === 'ENV_CREDENTIAL_ASSIGNMENT'
            ? match[1]
            : category === 'CREDENTIAL_ASSIGNMENT_LITERAL'
              ? match[1]
              : undefined,
        classification: isFixture(relativePath, lines[index])
          ? 'fixture-or-placeholder'
          : 'real-like-unverified',
      })
    }
  }
}

console.log(`Sanitized credential-shape scan: ${findings.length} matches`)
for (const finding of findings)
  console.log(
    `${finding.path}:${finding.line} ${finding.category}${finding.key ? ` key=${finding.key}` : ''} ${finding.classification} (value suppressed)`,
  )
