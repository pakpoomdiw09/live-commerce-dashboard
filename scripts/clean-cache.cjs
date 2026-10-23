const fs = require('node:fs/promises')
const path = require('node:path')

// No user-supplied paths or globs. Keep production build output and dependencies intact.
const TARGETS = Object.freeze([
  '.tmp',
  '.npm-audit-cache',
  '.next/cache',
  '.next-dev/cache',
  'tsconfig.tsbuildinfo',
])

function within(root, filename) {
  const relative = path.relative(root, filename)
  return (
    relative !== '' &&
    !relative.startsWith('..' + path.sep) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  )
}

async function projectRoot(directory) {
  const root = await fs.realpath(directory)
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'chat-dashboard') throw new Error('Not the chat-dashboard project root')
  return root
}

async function checkedStat(root, filename) {
  if (!within(root, filename)) throw new Error('Target is outside the project: ' + filename)
  // Inspect every ancestor too: .next itself could be a junction to another directory.
  let current = root
  for (const part of path.relative(root, filename).split(path.sep)) {
    current = path.join(current, part)
    let stat
    try {
      stat = await fs.lstat(current)
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    if (stat.isSymbolicLink()) throw new Error('Refusing symbolic link/junction: ' + current)
    const real = await fs.realpath(current)
    if (!within(root, real)) throw new Error('Resolved target is outside the project: ' + current)
  }
  const stat = await fs.lstat(filename)
  if (!stat.isFile() && !stat.isDirectory())
    throw new Error('Unsupported filesystem entry: ' + filename)
  return stat
}

async function measure(root, filename) {
  const stat = await checkedStat(root, filename)
  if (!stat) return { bytes: 0, files: 0, exists: false }
  if (stat.isFile()) return { bytes: stat.size, files: 1, exists: true }
  let bytes = 0,
    files = 0
  for (const name of await fs.readdir(filename)) {
    const child = await measure(root, path.join(filename, name))
    bytes += child.bytes
    files += child.files
  }
  return { bytes, files, exists: true }
}

async function planCleanup(directory) {
  const root = await projectRoot(directory),
    entries = []
  // Complete preflight for every target before any deletion.
  for (const name of TARGETS) {
    const filename = path.resolve(root, name)
    entries.push({ name, filename, ...(await measure(root, filename)) })
  }
  return { root, entries }
}

async function removeChecked(root, filename) {
  const stat = await checkedStat(root, filename)
  if (!stat) return
  if (stat.isFile()) {
    await fs.unlink(filename)
    return
  }
  for (const name of await fs.readdir(filename))
    await removeChecked(root, path.join(filename, name))
  // Never use recursive rm: a replaced directory or new file causes failure, not a wider delete.
  await checkedStat(root, filename)
  await fs.rmdir(filename)
}

async function cleanCache(directory, apply = false, log = console.log) {
  const plan = await planCleanup(directory)
  log('Project: ' + plan.root)
  log(
    apply
      ? 'APPLY: stop dev/build/test processes before running this command.'
      : 'DRY RUN: no files will be deleted.',
  )
  for (const item of plan.entries) {
    log(
      `${item.name}: ${item.exists ? `${item.files} files, ${(item.bytes / 1024 ** 2).toFixed(1)} MiB` : 'not present'}`,
    )
  }
  const bytes = plan.entries.reduce((sum, entry) => sum + entry.bytes, 0)
  log(`Total file size: ${(bytes / 1024 ** 2).toFixed(1)} MiB (actual disk space may differ).`)
  if (apply) {
    for (const item of plan.entries) {
      // A fixed allowlist check prevents accidental expansion during future refactoring.
      if (!TARGETS.includes(item.name) || item.filename !== path.resolve(plan.root, item.name))
        throw new Error('Invalid cleanup target')
      await measure(plan.root, item.filename)
      await removeChecked(plan.root, item.filename)
    }
    log('Cleanup complete. Removed only the listed cache/temp targets.')
  }
  return plan
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(
      'Usage: node scripts/clean-cache.cjs [--dry-run | --apply]\nDefault: dry run. Stop project processes before --apply. No custom paths are accepted.',
    )
    return
  }
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  )
    throw new Error('Use --dry-run or --apply; custom paths are not accepted')
  await cleanCache(path.resolve(__dirname, '..'), args.includes('--apply'))
}

module.exports = { cleanCache, planCleanup, TARGETS }
if (require.main === module)
  main().catch((error) => {
    console.error('Cleanup stopped: ' + error.message)
    console.error(
      'If applying, some earlier targets may already have been removed. Close project processes and preview again.',
    )
    process.exitCode = 1
  })
