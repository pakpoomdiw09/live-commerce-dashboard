const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { cleanCache, planCleanup } = require('./clean-cache.cjs')

async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-dashboard-clean-test-'))
  const root = path.join(base, 'project')
  await fs.mkdir(root)
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'chat-dashboard' }))
  return {
    root,
    base,
    async write(name, content = 'keep') {
      const target = path.join(root, name)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, content)
    },
    async close() {
      const tempRoot = await fs.realpath(os.tmpdir()),
        resolved = await fs.realpath(base)
      const relative = path.relative(tempRoot, resolved)
      assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
      assert.ok(path.basename(resolved).startsWith('chat-dashboard-clean-test-'))
      await fs.rm(resolved, { recursive: true, force: true })
    },
  }
}

test('preview preserves everything; apply deletes only approved targets and keeps build/source/fixtures', async () => {
  const f = await fixture()
  try {
    const removable = [
      '.tmp/nested/log',
      '.npm-audit-cache/cache',
      '.next/cache/webpack/a',
      '.next-dev/cache/a',
      'tsconfig.tsbuildinfo',
    ]
    const protectedFiles = [
      'app/page.tsx',
      'lib/auth.ts',
      '.env.local',
      'tests/fixtures/a',
      'scripts/fixtures/a',
      'node_modules/a',
      '.git/config',
      '.next/server/a',
      '.next/BUILD_ID',
      '.next-dev/server/a',
    ]
    for (const name of [...removable, ...protectedFiles]) await f.write(name)
    const plan = await cleanCache(f.root, false, () => {})
    assert.equal(
      plan.entries.reduce((sum, entry) => sum + entry.files, 0),
      removable.length,
    )
    for (const name of removable)
      assert.equal(await fs.readFile(path.join(f.root, name), 'utf8'), 'keep')
    await cleanCache(f.root, true, () => {})
    for (const name of removable)
      await assert.rejects(fs.stat(path.join(f.root, name)), { code: 'ENOENT' })
    for (const name of protectedFiles)
      assert.equal(await fs.readFile(path.join(f.root, name), 'utf8'), 'keep')
    await cleanCache(f.root, true, () => {}) // Safe to repeat with missing targets.
  } finally {
    await f.close()
  }
})

test('junctions in targets or ancestors abort all deletion, including earlier safe targets', async () => {
  for (const link of ['.tmp', '.next']) {
    const f = await fixture()
    try {
      const outside = path.join(f.base, 'outside')
      await fs.mkdir(outside)
      await fs.writeFile(path.join(outside, 'proof'), 'keep')
      await f.write('.npm-audit-cache/proof')
      if (link !== '.tmp') await f.write('.tmp/proof')
      await fs.symlink(
        outside,
        path.join(f.root, link),
        process.platform === 'win32' ? 'junction' : 'dir',
      )
      await assert.rejects(
        cleanCache(f.root, true, () => {}),
        /symbolic link\/junction/,
      )
      assert.equal(await fs.readFile(path.join(outside, 'proof'), 'utf8'), 'keep')
      assert.equal(await fs.readFile(path.join(f.root, '.npm-audit-cache/proof'), 'utf8'), 'keep')
    } finally {
      await f.close()
    }
  }
})

test('nested links abort preflight and an unrelated directory is rejected', async () => {
  const f = await fixture()
  try {
    const outside = path.join(f.base, 'outside')
    await fs.mkdir(outside)
    await f.write('.tmp/proof')
    await fs.symlink(
      outside,
      path.join(f.root, '.tmp/link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await assert.rejects(planCleanup(f.root), /symbolic link\/junction/)
    await fs.writeFile(path.join(f.root, 'package.json'), '{}')
    await assert.rejects(planCleanup(f.root), /project root/)
  } finally {
    await f.close()
  }
})
