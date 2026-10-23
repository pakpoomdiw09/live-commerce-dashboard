// Read-only audit of literal local fetch/navigation URLs. No server or database needed.
// Computed URLs, resource existence and authorization require runtime diagnostics.
const fs = require('node:fs'),
  path = require('node:path')
const root = path.resolve(__dirname, '..')
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
    )
}
const sourceFiles = ['app', 'components', 'lib']
  .flatMap((dir) => walk(path.join(root, dir)))
  .filter((file) => /\.[cm]?[jt]sx?$/.test(file))
const routeFiles = sourceFiles.filter(
  (file) =>
    file.startsWith(path.join(root, 'app') + path.sep) && /[\\/](page|route)\.[jt]sx?$/.test(file),
)
function routePath(file) {
  return (
    '/' +
    path
      .relative(path.join(root, 'app'), file)
      .replace(/\\/g, '/')
      .split('/')
      .slice(0, -1)
      .filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith('@'))
      .join('/')
  )
}
function pattern(route) {
  const segments = route.split('/').filter(Boolean)
  return new RegExp(
    '^' +
      segments
        .map((segment) => {
          if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '(?:/.*)?'
          if (/^\[\.\.\..+\]$/.test(segment)) return '/.+'
          if (/^\[.+\]$/.test(segment)) return '/[^/]+'
          return '/' + segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        })
        .join('') +
      '/?$',
  )
}
const pages = routeFiles
  .filter((file) => /[\\/]page\./.test(file))
  .map((file) => pattern(routePath(file)))
const endpoints = routeFiles
  .filter((file) => /[\\/]route\./.test(file))
  .map((file) => pattern(routePath(file)))
const failures = []
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8')
  const expression = /(fetch\(|href=|src=|router\.(?:push|replace)\()\s*\{?["'`]([^"'`\s]+)["'`]/g
  for (const match of source.matchAll(expression)) {
    const url = match[2],
      pathname = url.split(/[?#]/)[0]
    if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('${')) continue
    const routes = pathname.startsWith('/api/') ? endpoints : [...pages, ...endpoints]
    if (routes.some((route) => route.test(pathname))) continue
    if (fs.existsSync(path.join(root, 'public', pathname.slice(1)))) continue
    const line = source.slice(0, match.index).split('\n').length
    failures.push(`${path.relative(root, file)}:${line}: ${url}`)
  }
}
if (failures.length) {
  console.error('Local URLs without a matching route or public asset:\n' + failures.join('\n'))
  process.exitCode = 1
} else
  console.log(
    `PASS: literal local URLs match ${routeFiles.length} App Router routes/public assets (computed URLs and HTTP methods not audited).`,
  )
