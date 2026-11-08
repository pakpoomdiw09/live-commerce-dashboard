// Overlay the captured task-entry source in memory; never rewrite the working tree.
const fs = require('node:fs'), path = require('node:path')
const entry = JSON.parse(fs.readFileSync(path.join(__dirname, 'entry.json'), 'utf8'))
const root = path.resolve(__dirname, '../../..')
const original = fs.readFileSync
const sources = new Set(['app/api/live-auction/workspace/route.ts', 'app/api/cron/facebook-webhooks/route.ts'])
fs.readFileSync = function(file, options) {
  const relative = typeof file === 'string' ? path.relative(root, path.resolve(file)).replaceAll('\\', '/') : ''
  if (sources.has(relative)) return entry.files[relative] ?? original.call(this, path.join(process.env.AUCTION_ENTRY_ROOT, relative), options)
  return original.call(this, file, options)
}
for (const file of process.argv.slice(2)) require(path.join(root, 'scripts', file))
