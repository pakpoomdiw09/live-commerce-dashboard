const fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript'),
  assert = require('node:assert/strict'),
  { test } = require('node:test'),
  { PGlite } = require('@electric-sql/pglite')
function load(file, deps = {}) {
  const ctx = { exports: {}, require: (name) => deps[name] ?? {} }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    ctx,
  )
  return ctx.exports
}
const registry = load('lib/features/banking/banks.ts'),
  { BANKS, BANK_CODES, findBank } = registry
const processSlip = load('lib/features/slips/receiver-matching.ts', {
    '@/lib/features/banking/banks': registry,
  }),
  accounts = load('lib/features/banking/bank-accounts.ts', {
    '@/lib/features/banking/banks': registry,
  })
test('registry includes 35 active banks plus PromptPay; unique identifiers, top five priority, Thai sorting, no defunct duplicates', () => {
  assert.equal(BANKS.length, 36)
  assert.equal(new Set(BANK_CODES).size, 36)
  assert.deepEqual(Array.from(BANK_CODES.slice(0, 5)), ['KBANK', 'SCB', 'KTB', 'BBL', 'BAY'])
  const rest = BANKS.slice(5).map((b) => b.name.replace(/^ธนาคาร/, ''))
  assert.deepEqual(
    Array.from(rest),
    Array.from(rest).sort((a, b) => a.localeCompare(b, 'th')),
  )
  assert.equal(BANKS.filter((b) => b.category === 'specialized').length, 6)
  assert.equal(BANKS.filter((b) => b.category === 'foreign').length, 11)
  for (const code of ['ANZ', 'RBS', 'TBANK', 'MUFG']) assert.ok(!BANK_CODES.includes(code))
  for (const bank of BANKS) {
    assert.equal(findBank(bank.code), bank)
    assert.equal(
      accounts.bankAccountError(bank.code, 'Offline owner', '0812345678'),
      registry.isSupportedBank(bank.code) ? null : registry.UNSUPPORTED_BANK_MESSAGE,
    )
    for (const alias of bank.aliases) assert.equal(findBank(alias), bank)
  }
  assert.ok(findBank('CLICX'))
  assert.notEqual(findBank('SMTB'), findBank('SMBC'))
  assert.notEqual(findBank('BOC'), findBank('ICBC'))
})
test('18 documented SlipOK codes share the registry; old mappings/aliases stay stable; unsupported banks cannot auto-match', () => {
  const expected = {
    BBL: '002',
    KBANK: '004',
    KTB: '006',
    TTB: '011',
    SCB: '014',
    BAY: '025',
    KKP: '069',
    CIMB: '022',
    TISCO: '067',
    UOB: '024',
    TCRB: '071',
    LH: '073',
    ICBC: '070',
    SME: '098',
    BAAC: '034',
    EXIM: '035',
    GSB: '030',
    GHB: '033',
  }
  assert.equal(BANKS.filter((b) => b.slipCode).length, 18)
  for (const [code, numeric] of Object.entries(expected)) {
    assert.equal(findBank(code).slipCode, numeric)
    assert.equal(findBank(numeric).code, code)
    assert.equal(processSlip.bankMatches(code, numeric), true)
    for (const alias of findBank(code).aliases)
      assert.equal(processSlip.bankMatches(alias, numeric), true)
    assert.equal(processSlip.bankMatches(code, '999'), false)
  }
  for (const bank of BANKS.filter((b) => b.support === 'manual')) {
    assert.equal(bank.slipCode, null)
    assert.equal(processSlip.bankMatches(bank.code, bank.code), false)
    assert.equal(processSlip.bankMatches(bank.code, '004'), false)
  }
  for (const alias of ['TMB', 'TTBNK']) assert.equal(processSlip.bankMatches(alias, '011'), true)
  assert.equal(findBank('076'), undefined)
  assert.equal(processSlip.bankMatches('TTB', '076'), false)
  assert.equal(processSlip.bankMatches('PROMPTPAY', '004'), true)
})
test('all installed assets are local, licensed, hash-matched, rasterizable SVG with correct canonical manifest association', async () => {
  const manifest = JSON.parse(fs.readFileSync('public/banks/manifest.json', 'utf8'))
  const sharp = require('sharp'),
    crypto = require('node:crypto'),
    installed = BANKS.filter((b) => b.logoPath)
  assert.ok(installed.length >= 25)
  for (const bank of installed) {
    assert.ok(bank.logoPath.startsWith('/banks/'))
    const record = manifest.logos.find((row) => row.bankCode === bank.code)
    assert.ok(record, 'Missing provenance ' + bank.code)
    assert.equal(record.path, bank.logoPath)
    const bytes = fs.readFileSync('public' + bank.logoPath),
      source = bytes.toString('utf8')
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), record.sha256)
    assert.ok(record.license && record.sourceUrl)
    if (bank.logoPath.endsWith('.svg'))
      assert.ok(
        !/<script|<foreignObject|\bon\w+=|(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)/i.test(
          source,
        ),
        bank.code,
      )
    const raster = await sharp(bytes).resize(56, 56).png().toBuffer()
    assert.ok(raster.length > 100)
  }
  assert.equal(manifest.logos.length, installed.length)
  for (const bank of BANKS.filter((b) => !b.logoPath))
    assert.ok(
      manifest.missing.some((row) => row.bankCode === bank.code),
      'Missing fallback report ' + bank.code,
    )
})
test('additive bank registry SQL accepts every canonical code via existing owner RPC; repeatable, audited and tenant isolated', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      fs
        .readFileSync('scripts/test-bank-accounts-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec('create table auth.users(id uuid primary key);')
    await db.exec(fs.readFileSync('supabase/bank-accounts.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/slip-bank-controls.sql', 'utf8'))
    const sql = fs.readFileSync('supabase/bank-registry.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const one = async (q, args = []) => (await db.query(q, args)).rows[0],
      owner = crypto.randomUUID(),
      staff = crypto.randomUUID()
    await db.query('insert into auth.users values($1),($2)', [owner, staff])
    const shop = (await one('insert into tenants default values returning id')).id,
      other = (await one('insert into tenants default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')", [
      shop,
      owner,
      staff,
    ])
    const save = (code, actor = owner, tenant = shop, id = null) =>
      one("select manage_slip_bank_account($1,$2,'save',$3,$4,true) id", [
        tenant,
        actor,
        id,
        {
          bank_code: code,
          account_name: 'Offline test',
          account_number: '0812345678',
          is_active: true,
        },
      ])
    for (const code of BANK_CODES) await save(code)
    assert.equal((await one('select count(*)::int n from bank_accounts')).n, 36)
    const existing = (await one("select id from bank_accounts where bank_code='BAAC'")).id
    await save('BAAC', owner, shop, existing)
    await assert.rejects(save('ANZ'), (e) => e.code === '23514')
    await assert.rejects(save('KBANK', staff), (e) => e.code === '42501')
    await assert.rejects(save('KBANK', owner, other), (e) => e.code === '42501')
    assert.equal((await one('select count(*)::int n from bank_account_audit')).n, 37)
    await db.exec(sql)
    assert.equal((await one('select count(*)::int n from bank_accounts')).n, 36)
    const seeded = (
      await one(
        "insert into tenants(bank_code,account_name,account_number) values('CLICX','Seeded','0123456789') returning id",
      )
    ).id
    assert.equal(
      (await one('select bank_code,is_primary from bank_accounts where tenant_id=$1', [seeded]))
        .bank_code,
      'CLICX',
    )
  } finally {
    await db.close()
  }
})
