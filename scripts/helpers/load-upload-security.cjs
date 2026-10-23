const loadTypeScript = require('./load-typescript.cjs')
module.exports = function loadUploadSecurity(overrides = {}) {
  return loadTypeScript(
    'lib/upload-security.ts',
    {
      'server-only': {},
      sharp: require('sharp'),
      '@/lib/image-signature': loadTypeScript('lib/image-signature.ts'),
    },
    { Buffer, Request, File, Error, Uint8Array, setTimeout, clearTimeout, console, ...overrides },
  )
}
