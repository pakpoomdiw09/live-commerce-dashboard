const fs = require('node:fs'), path = require('node:path'), Module = require('node:module')
const root = path.resolve(process.argv[2])
const current = path.resolve(__dirname, '../../..')
process.chdir(root)
for (const file of ['test-customer-tabs.cjs', 'test-live-session-dashboard.cjs', 'test-shipping.cjs']) {
  const filename = path.join(current, 'scripts', file)
  const instance = new Module(filename, module)
  instance.filename = filename
  instance.paths = Module._nodeModulePaths(path.dirname(filename))
  const original = instance.require.bind(instance)
  instance.require = name => ['../scripts/build-full-database-setup.cjs', './build-full-database-setup.cjs', './helpers/load-typescript.cjs'].includes(name)
    ? require(path.join(root, 'scripts', name.replace(/^\.\//, ''))) : original(name)
  instance._compile(fs.readFileSync(filename, 'utf8'), filename)
}
