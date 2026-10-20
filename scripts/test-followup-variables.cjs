const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const ts = require('typescript')
const api = {}
vm.runInNewContext(ts.transpileModule(readFileSync(join(__dirname, '../lib/features/agents/chatbot.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api, require: () => ({}) })
test('Thai and legacy variables work together and replace every occurrence', () => {
  assert.equal(api.renderFollowUp('{ชื่อลูกค้า}/{name}: {ยอดเงิน}/{total}', { name: 'สมใจ', total: 590.5 }), 'สมใจ/สมใจ: 590.50/590.50')
  assert.equal(api.renderFollowUp('{ยอดเงิน} {ยอดเงิน}', { name: 'สมใจ', total: 0 }), '0.00 0.00')
})
test('Inserted customer names are literal and unknown placeholders remain intact', () => {
  assert.equal(api.renderFollowUp('{name} {total} {unknown}', { name: '{ยอดเงิน} $&', total: 1000 }), '{ยอดเงิน} $& 1,000.00 {unknown}')
})
test('Default follow-up steps use Thai variables and the requested delays', () => {
  const steps = api.defaultBotSettings('tenant').followup_steps
  assert.equal(steps[0].delay_minutes, 15)
  assert.equal(steps[1].delay_minutes, 60)
  assert.ok(steps[0].text.includes('{ชื่อลูกค้า}'))
  assert.ok(steps.every(step => step.text.includes('{ยอดเงิน}') && !step.text.includes('{total}')))
})
