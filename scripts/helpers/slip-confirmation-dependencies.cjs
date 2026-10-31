const load = require('./load-typescript.cjs')
module.exports = {
  '@/lib/features/slips/slip-confirmation-template': load(
    'lib/features/slips/slip-confirmation-template.ts',
  ),
  '@/lib/features/slips/slip-confirmation-settings': load(
    'lib/features/slips/slip-confirmation-settings.ts',
    { 'server-only': {} },
  ),
}
