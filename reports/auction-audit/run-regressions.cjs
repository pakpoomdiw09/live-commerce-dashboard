// Run identical final tests against either source root, without editing that worktree.
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const root = path.resolve(process.argv[2])
process.env.AUCTION_AUDIT_ROOT = root
const current = path.resolve(__dirname, '../..')
process.chdir(root)
for (const file of [
  'test-auction-audit-lifecycle.cjs',
  'test-auction-host-actions.cjs',
  'test-auction-background.cjs',
  'test-auction-poller-hardening.cjs',
  'test-auction-server.cjs',
]) {
  const filename = path.join(current, 'scripts', file)
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const originalRequire = instance.require.bind(instance)
  instance.require = (name) =>
    name === './helpers/load-typescript.cjs'
      ? require(path.join(root, 'scripts/helpers/load-typescript.cjs'))
      : originalRequire(name)
  instance._compile(fs.readFileSync(filename, 'utf8'), filename)
}
