const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

module.exports = function loadTypeScript(file, dependencies = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../..', file)
  const context = {
    exports: {},
    require(name) {
      if (name === '@/lib/single-flight') return module.exports('lib/single-flight.ts', {}, globals)
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name === '@/lib/features/inbox/inbox-diagnostics') return { logInboxError() {} }
      if (name === '@/lib/features/overview/overview-diagnostics') return { logOverviewError() {} }
      // Legacy entitlement tests exercise enforcement with the temporary mode OFF.
      // Full Access tests explicitly inject the actual flag value instead.
      if (name === '@/lib/full-access') return { temporaryFullAccess: false }
      throw new Error(`Unexpected dependency in ${file}: ${name}`)
    },
    ...globals,
  }
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText
  vm.runInNewContext(source, context, { filename })
  return context.exports
}
