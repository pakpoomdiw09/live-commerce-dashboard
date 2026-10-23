const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const options = ts.parseJsonConfigFileContent(
  ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile).config,
  ts.sys,
  root,
).options
const files = []
function walk(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(filename)
    else if (/\.tsx?$/.test(filename)) files.push(filename)
  }
}
for (const directory of ['app', 'components', 'hooks', 'lib']) walk(path.join(root, directory))
for (const file of ['middleware.ts', 'instrumentation.ts', 'instrumentation-client.ts'])
  if (fs.existsSync(path.join(root, file))) files.push(path.join(root, file))
const graph = new Map()
const unresolved = []
const relativeImports = []
const boundaryViolations = []
for (const filename of files) {
  const source = ts.createSourceFile(
    filename,
    fs.readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const dependencies = new Set()
  function add(specifier, typeOnly) {
    if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
    if (/\.(css|svg|png|jpg|jpeg|webp|woff2?)$/.test(specifier)) return
    const resolved = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule
      ?.resolvedFileName
    if (!resolved) unresolved.push({ file: path.relative(root, filename), specifier })
    else if (!resolved.includes('node_modules')) {
      const from = path.relative(root, filename).replaceAll('\\', '/')
      const to = path.relative(root, resolved).replaceAll('\\', '/')
      if (from.startsWith('lib/') && /^(app|components|hooks)\//.test(to)) {
        boundaryViolations.push({ from, to })
      }
      if (!typeOnly) dependencies.add(path.resolve(resolved))
    }
    if (specifier.startsWith('.'))
      relativeImports.push({ file: path.relative(root, filename), specifier })
  }
  function visitNode(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause,
        bindings = clause?.namedBindings
      const typeOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly))
      add(node.moduleSpecifier.text, typeOnly)
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const bindings = node.exportClause
      const typeOnly =
        node.isTypeOnly ||
        (bindings &&
          ts.isNamedExports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((item) => item.isTypeOnly))
      add(node.moduleSpecifier.text, typeOnly)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      add(node.arguments[0].text, false)
    }
    ts.forEachChild(node, visitNode)
  }
  visitNode(source)
  graph.set(filename, dependencies)
}

const done = new Set(),
  active = new Map(),
  stack = [],
  cycles = []
function visit(filename) {
  if (active.has(filename)) {
    cycles.push(
      [...stack.slice(active.get(filename)), filename].map((file) =>
        path.relative(root, file).replaceAll('\\', '/'),
      ),
    )
    return
  }
  if (done.has(filename)) return
  active.set(filename, stack.length)
  stack.push(filename)
  for (const dependency of graph.get(filename) ?? []) visit(dependency)
  stack.pop()
  active.delete(filename)
  done.add(filename)
}
for (const filename of files) visit(filename)
const report = { files: files.length, unresolved, cycles, relativeImports, boundaryViolations }
console.log(JSON.stringify(report, null, 2))
if (unresolved.length || cycles.length || relativeImports.length || boundaryViolations.length)
  process.exitCode = 1
