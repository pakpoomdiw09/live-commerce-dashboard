// Some restricted Windows runners report ENOMEM from the native passwd lookup.
// Keep Node's default behavior everywhere else; only provide harmless test
// identity data when that specific lookup is unavailable.
const os = require('node:os')

try {
  os.userInfo()
} catch (error) {
  if (error?.code !== 'ENOMEM' && error?.info?.code !== 'ENOMEM') throw error
  os.userInfo = () => ({
    username: process.env.USERNAME || 'test-runner',
    uid: -1,
    gid: -1,
    shell: null,
    homedir: process.env.USERPROFILE || process.cwd(),
  })
}
