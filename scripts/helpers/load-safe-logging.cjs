const loadTypeScript = require('./load-typescript.cjs')
module.exports = function loadSafeLogging(consoleOutput = { info() {}, warn() {}, error() {} }) {
  return loadTypeScript(
    'lib/safe-logging.ts',
    { 'node:crypto': require('node:crypto') },
    { console: consoleOutput },
  )
}
