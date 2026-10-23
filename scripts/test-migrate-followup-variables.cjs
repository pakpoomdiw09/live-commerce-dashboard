const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
async function main() {
  const db = new PGlite()
  try {
    await db.exec(`create table bot_settings(tenant_id text primary key, followup_steps jsonb, updated_at timestamptz);
      create table follow_up_jobs(id integer primary key, step integer, text text, status text);
      create function gate_test() returns trigger language plpgsql as $$begin raise exception 'gate should be bypassed'; end$$;
      create trigger bot_settings_ai_plan_gate before update on bot_settings for each row execute function gate_test();
      create trigger bot_settings_followup_plan_gate before update on bot_settings for each row execute function gate_test();
      alter table bot_settings disable trigger bot_settings_followup_plan_gate;`)
    const steps = [
      { delay_minutes: 15, text: 'Hello {name}, pay {total}', custom: 'keep' },
      { delay_minutes: 60, text: 'คุณ {name} กรุณาชำระ {total}' },
      { delay_minutes: 120, text: 'Custom {name} {total}' },
    ]
    await db.query('insert into bot_settings values ($1,$2,null)', [
      'tenant',
      JSON.stringify(steps),
    ])
    await db.query('insert into follow_up_jobs values (1,1,$1,$2),(2,1,$1,$3)', [
      'Hello {name} {total}',
      'scheduled',
      'sent',
    ])
    const sql = readFileSync(join(__dirname, '../supabase/migrate-followup-variables.sql'), 'utf8')
    await db.exec(sql)
    const first = (await db.query('select * from bot_settings')).rows[0]
    assert.equal(
      first.followup_steps[0].text,
      'คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ',
    )
    assert.equal(first.followup_steps[0].custom, 'keep')
    assert.equal(first.followup_steps[1].text, 'คุณ {ชื่อลูกค้า} กรุณาชำระ {ยอดเงิน}')
    assert.equal(first.followup_steps[2].text, 'Custom {ชื่อลูกค้า} {ยอดเงิน}')
    assert.equal(first.followup_steps[2].delay_minutes, 120)
    const jobs = (await db.query('select * from follow_up_jobs order by id')).rows
    assert.equal(jobs[0].text, first.followup_steps[0].text)
    assert.equal(jobs[1].text, 'Hello {name} {total}')
    await db.exec(sql)
    assert.deepEqual((await db.query('select * from bot_settings')).rows[0], first)
    const gates = (
      await db.query(
        'select tgname,tgenabled from pg_trigger where not tgisinternal order by tgname',
      )
    ).rows
    assert.deepEqual(
      gates.map((g) => g.tgenabled),
      ['O', 'D'],
    )
    console.log(
      'Migration passed: Thai/English mapping, custom messages and fields, pending jobs, preserved history, trigger state, rerun.',
    )
  } finally {
    await db.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
