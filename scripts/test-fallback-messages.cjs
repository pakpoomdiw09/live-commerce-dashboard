const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const api = {}
vm.runInNewContext(
  ts.transpileModule(
    readFileSync(join(__dirname, '../lib/features/agents/fallback-messages.ts'), 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    },
  ).outputText,
  { exports: api },
)
test('Random fallback selects nonempty messages and uses the default for an empty array', () => {
  const settings = { fallback_messages: [' first ', '', ' second '] }
  assert.equal(
    api.randomFallback(settings, () => 0),
    'first',
  )
  assert.equal(
    api.randomFallback(settings, () => 0.999),
    'second',
  )
  assert.equal(api.randomFallback({ fallback_messages: [' ', ''] }), api.DEFAULT_FALLBACK_MESSAGE)
})
test('Legacy single messages remain usable; explicitly clearing the array overrides legacy data', () => {
  assert.equal(api.randomFallback({ fallback_text: ' legacy ' }), 'legacy')
  assert.equal(
    api.randomFallback({ fallback_messages: [], fallback_text: 'legacy' }),
    api.DEFAULT_FALLBACK_MESSAGE,
  )
})

test('Handover selects one message, supports old text and uses a default after deletion', () => {
  const settings = { handover_messages: [' first ', '', 'second'] }
  assert.equal(
    api.randomHandover(settings, () => 0),
    'first',
  )
  assert.equal(
    api.randomHandover(settings, () => 0.99),
    'second',
  )
  assert.equal(api.randomHandover({ handover_text: 'legacy' }), 'legacy')
  assert.equal(
    api.randomHandover({ handover_messages: [], handover_text: 'legacy' }),
    api.DEFAULT_HANDOVER_MESSAGE,
  )
})
test('Fallback migration backfills old messages, reruns and validates database limits', async () => {
  if (!process.env.PGLITE_MODULE) return
  const { PGlite } = require(process.env.PGLITE_MODULE)
  const db = new PGlite()
  try {
    await db.exec(
      "create table bot_settings(id integer primary key, fallback_text text); insert into bot_settings values (1,'legacy'),(2,null);",
    )
    const sql = readFileSync(join(__dirname, '../supabase/fallback-messages.sql'), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    assert.deepEqual(
      (await db.query('select fallback_messages from bot_settings where id=1')).rows[0]
        .fallback_messages,
      ['legacy'],
    )
    await assert.rejects(
      db.query('update bot_settings set fallback_messages=$1 where id=1', [Array(21).fill('text')]),
      /constraint/,
    )
    await assert.rejects(
      db.query('update bot_settings set fallback_messages=$1 where id=1', [['x'.repeat(2001)]]),
      /constraint/,
    )
    await db.exec(
      "alter table bot_settings add column handover_text text; update bot_settings set handover_text='handover legacy' where id=1;",
    )
    const handoverSql = readFileSync(join(__dirname, '../supabase/handover-messages.sql'), 'utf8')
    await db.exec(handoverSql)
    await db.exec(handoverSql)
    assert.deepEqual(
      (await db.query('select handover_messages from bot_settings where id=1')).rows[0]
        .handover_messages,
      ['handover legacy'],
    )
    await assert.rejects(
      db.query('update bot_settings set handover_messages=$1 where id=1', [Array(21).fill('text')]),
      /constraint/,
    )
  } finally {
    await db.close()
  }
})
