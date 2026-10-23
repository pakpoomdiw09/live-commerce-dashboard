const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  vm = require('node:vm'),
  ts = require('typescript')
const exportsObject = {}
vm.runInNewContext(
  ts.transpileModule(
    fs.readFileSync('lib/features/follow-ups/manual-followup-context.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText,
  { exports: exportsObject },
)
const { followUpChatDraft } = exportsObject
const history = [
  {
    id: 'm1',
    sender: 'customer',
    body: 'ตกลงยอดรวม 1,200 บาท แต่โอนผ่านแอปไม่ได้',
    created_at: '2026-10-20',
  },
]
const supported = followUpChatDraft(
  {
    amount: '1,200',
    message_id: 'm1',
    quote: 'ยอดรวม 1,200 บาท',
    issue_message_id: 'm1',
    issue_quote: 'โอนผ่านแอปไม่ได้',
  },
  history,
)
assert.equal(supported.analysis.amount, '1,200')
assert.equal(supported.analysis.transferIssue.quote, 'โอนผ่านแอปไม่ได้')
assert.equal(supported.analysis.paymentStatus, 'unverified')
for (const selection of [
  { amount: '900', message_id: 'm1', quote: 'ยอดรวม 1,200 บาท' },
  { amount: '1,200', message_id: 'foreign', quote: history[0].body },
  { amount: '1,200', message_id: 'm1', quote: 'invented' },
  { amount: Infinity, message_id: 'm1', quote: history[0].body },
])
  assert.equal(followUpChatDraft(selection, history).analysis.amount, null)
assert.equal(
  followUpChatDraft({ issue_message_id: 'm1', issue_quote: 'invented' }, history).analysis
    .transferIssue,
  null,
)
assert.ok(followUpChatDraft({}, []).draft.length > 0)
console.log(
  'PASS: quoted amount and transfer issue, unsupported amounts, foreign messages, fabricated quotes, invalid values and neutral fallback',
)
