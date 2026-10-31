const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const load = require('./helpers/load-typescript.cjs')
const matching = load('lib/features/slips/receiver-matching.ts', {
  '@/lib/features/banking/banks': load('lib/features/banking/banks.ts'),
})

test('migration is repeatable; QR save activates the matching account atomically, preserves history and enforces tenant/owner/version guards', async () => {
  const db = new PGlite()
  try {
    await db.exec(
      readFileSync('scripts/test-bank-accounts-sql.cjs', 'utf8')
        .split('await db.exec(`')[1]
        .split('`)')[0],
    )
    await db.exec(
      'create table auth.users(id uuid primary key default gen_random_uuid());create function has_tenant_feature(uuid,text) returns boolean language sql as $$select true$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text);alter table storage.objects enable row level security;',
    )
    for (const file of ['bank-accounts.sql', 'slip-bank-controls.sql', 'bank-registry.sql'])
      await db.exec(readFileSync('supabase/' + file, 'utf8'))
    const sql = readFileSync('supabase/bank-qr-upload.sql', 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    const one = async (q, params = []) => (await db.query(q, params)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id
    const staff = (await one('insert into auth.users default values returning id')).id
    const tenant = (await one('insert into tenants default values returning id')).id
    const other = (await one('insert into tenants default values returning id')).id
    await db.query("insert into tenant_members values($1,$2,'owner'),($1,$3,'staff')", [
      tenant,
      owner,
      staff,
    ])
    const payload = require('promptpay-qr')('0812345678', {})
    const save = ({
      actor = owner,
      shop = tenant,
      bank = 'KBANK',
      number = '1234567890',
      version = 0,
      path = `${tenant}/one.png`,
    } = {}) =>
      db.query('select save_bank_receiving_qr($1,$2,$3,$4,$5,$6,$7,$8)', [
        shop,
        actor,
        bank,
        'ร้านทดสอบ',
        number,
        path,
        payload,
        version,
      ])
    await assert.rejects(save({ actor: staff }), (e) => e.code === '42501')
    await assert.rejects(save({ shop: other }), (e) => e.code === '42501')
    await assert.rejects(save({ path: `${other}/bad.png` }), (e) => e.code === '22023')
    await save()
    const account = await one('select * from bank_accounts where tenant_id=$1 and is_primary', [
      tenant,
    ])
    assert.equal(account.is_active, true)
    assert.equal(account.account_number, '1234567890')
    assert.equal(matching.receiverMatchesAny([account], '004', 'xxx-x-x6789-0'), true)
    assert.equal(matching.receiverMatchesAny([account], '006', 'xxx-x-x6789-0'), false)
    assert.equal(
      (await one('select account_number from tenants where id=$1', [tenant])).account_number,
      '1234567890',
    )
    await assert.rejects(save(), (e) => e.code === '40001')
    await assert.rejects(save({ number: '9999999999', version: 1 }), (e) => e.code === '22023')
    assert.equal((await one('select count(*)::int n from bank_accounts')).n, 1)
    await save({ bank: 'KTB', number: '9999999999', version: 1, path: `${tenant}/two.png` })
    await db.exec(sql)
    assert.equal((await one('select count(*)::int n from bank_receiving_qr')).n, 1)
    assert.equal((await one('select count(*)::int n from bank_accounts')).n, 2)
    assert.equal(
      (await one('select bank_code from bank_accounts where is_primary')).bank_code,
      'KTB',
    )
    assert.equal((await one('select version from bank_receiving_qr')).version, 2)
    assert.equal(
      (await one("select public from storage.buckets where id='bank-receiving-qr'")).public,
      false,
    )
    assert.equal((await one('select count(*)::int n from bank_account_audit')).n, 4)
    const previous = await one('select * from bank_receiving_qr')
    const upgrade = readFileSync('supabase/bank-qr-per-account.sql', 'utf8')
    await db.exec(upgrade)
    await db.exec(upgrade)
    assert.deepEqual(await one('select * from bank_receiving_qr'), previous)
    const primary = await one('select * from bank_accounts where is_primary')
    await db.query('update bank_accounts set is_active=false where id=$1', [account.id])
    const upload = ({
      id = account.id,
      version = 0,
      bank = 'KBANK',
      number = '1234567890',
      actor = owner,
      shop = tenant,
      path = `${tenant}/${id}/new.png`,
    } = {}) =>
      db.query('select save_bank_account_qr($1,$2,$3,$4,$5,$6,$7,$8)', [
        shop,
        actor,
        id,
        bank,
        number,
        path,
        payload,
        version,
      ])
    await upload()
    assert.equal((await one('select count(*)::int n from bank_receiving_qr')).n, 2)
    assert.equal(
      (await one('select is_active from bank_accounts where id=$1', [account.id])).is_active,
      false,
    )
    assert.equal((await one('select id from bank_accounts where is_primary')).id, primary.id)
    await assert.rejects(upload(), (e) => e.code === '40001')
    await assert.rejects(upload({ actor: staff, version: 1 }), (e) => e.code === '42501')
    await assert.rejects(upload({ shop: other, version: 1 }), (e) => e.code === '42501')
    await assert.rejects(upload({ id: other, version: 0 }), (e) => e.code === 'P0002')
    await assert.rejects(upload({ number: '9999999999', version: 1 }), (e) => e.code === '40001')
    await assert.rejects(
      upload({ path: `${tenant}/${primary.id}/wrong.png`, version: 1 }),
      (e) => e.code === '22023',
    )
    await upload({ id: primary.id, bank: 'KTB', number: '9999999999', version: 2 })
    assert.equal(
      (await one('select version from bank_receiving_qr where account_id=$1', [primary.id]))
        .version,
      3,
    )
    assert.equal(
      (await one('select version from bank_receiving_qr where account_id=$1', [account.id]))
        .version,
      1,
    )
    await db.exec(upgrade)
    assert.equal((await one('select count(*)::int n from bank_receiving_qr')).n, 2)
    assert.equal(
      (await one("select count(*)::int n from bank_account_audit where action='qr_upload'")).n,
      2,
    )
    await db.exec('set role authenticated')
    await assert.rejects(db.exec('select * from bank_receiving_qr'), (e) => e.code === '42501')
    await assert.rejects(save({ version: 2 }), (e) => e.code === '42501')
    await assert.rejects(upload({ version: 1 }), (e) => e.code === '42501')
    await db.exec('reset role; set role anon')
    await assert.rejects(db.exec('select * from bank_receiving_qr'), (e) => e.code === '42501')
  } finally {
    await db.close()
  }
})
