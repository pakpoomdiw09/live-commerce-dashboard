const assert = require('node:assert/strict'),
  fs = require('node:fs')
const { PGlite } = require(process.argv[2] || '@electric-sql/pglite')
;(async () => {
  const db = new PGlite()
  let checks = 0
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key default gen_random_uuid());
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create table tenants(id uuid primary key default gen_random_uuid(),name text default 'Shop',plan text default 'pro',plan_expires_at timestamptz default now()+interval '30 days',is_active boolean default true,auto_reply_enabled boolean default true,broadcast_allowance integer default 100,broadcast_credits integer default 100,broadcast_topup_credits integer default 7,broadcast_credit_mode text default 'purchased',broadcast_period text default to_char(now(),'YYYY-MM'));
 create table tenant_members(tenant_id uuid references tenants(id),user_id uuid references auth.users(id),role text);create table platform_admins(user_id uuid primary key references auth.users(id));
 create table customers(id uuid primary key default gen_random_uuid(),platform text not null default 'facebook',tenant_id uuid references tenants(id),platform_user_id text default '123',display_name text default 'Customer',bot_enabled boolean default true,last_message_at timestamptz default now(),handover_at timestamptz);
 create table messages(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),sender text,body text,external_id text unique,created_at timestamptz default now());
 create table bot_settings(tenant_id uuid primary key references tenants(id),reply_mode text default 'keyword',followup_enabled boolean default false,followup_steps jsonb default '[{"delay_minutes":30,"text":"hello"},{"delay_minutes":180,"text":"hello again"}]');
 create table products(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),name text default 'Product',price numeric default 100,is_active boolean default true);
 create table orders(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),customer_id uuid references customers(id),product_id uuid references products(id),product_name text default 'Product',amount numeric default 100,status text default 'pending_payment',message_id uuid references messages(id),created_at timestamptz default now());
 create table slips(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),customer_id uuid references customers(id),created_at timestamptz default now());
 create table follow_up_jobs(id uuid primary key default gen_random_uuid(),tenant_id uuid references tenants(id),customer_id uuid references customers(id),order_id uuid not null references orders(id),step smallint,text text,run_at timestamptz,status text default 'scheduled' check(status in ('scheduled','sent','cancelled','failed')),reason text,sent_at timestamptz,created_at timestamptz default now(),unique(order_id,step));
 alter table follow_up_jobs enable row level security;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create function has_tenant_feature(p_tenant uuid,p_feature text) returns boolean language sql security definer as $$select exists(select 1 from tenants where id=p_tenant and is_active and plan in ('starter','pro') and plan_expires_at>now() and (p_feature<>'ai_agent' or plan='pro'))$$;
 create function can_access_tenant(p_tenant uuid) returns boolean language sql security definer as $$select exists(select 1 from tenant_members where tenant_id=p_tenant and user_id=auth.uid())$$;
 create function schedule_follow_ups() returns trigger language plpgsql as $$begin return new;end$$;
 create function cancel_paid_follow_ups() returns trigger language plpgsql as $$begin return null;end$$;
 create trigger orders_schedule_follow_ups after insert on orders for each row execute function schedule_follow_ups();
 create trigger orders_cancel_follow_ups after update of status on orders for each row execute function cancel_paid_follow_ups();
 grant usage on schema public,auth,storage to authenticated,service_role;grant all on all tables in schema public,auth,storage to service_role;
 grant select on customers,tenants to authenticated;grant update(bot_enabled) on customers to authenticated;create publication supabase_realtime;`)
    await db.exec(fs.readFileSync('supabase/smart-inbox.sql', 'utf8'))
    const credits = fs.readFileSync('supabase/free-message-quota.sql', 'utf8')
    await db.exec(
      credits.slice(
        credits.indexOf('create or replace function public.refresh_broadcast_credits'),
        credits.indexOf('create or replace function public.platform_update_tenant'),
      ),
    )
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0]
    const owner = (await one('insert into auth.users default values returning id')).id
    const legacy = (await one('insert into tenants default values returning id')).id
    await db.query('insert into bot_settings(tenant_id,followup_enabled) values($1,true)', [legacy])
    const migration = fs.readFileSync('supabase/smart-follow-ups.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    assert.equal(
      (
        await one(
          "select steps->0->>'delay_minutes' n from follow_up_workflows where tenant_id=$1 and kind='payment'",
          [legacy],
        )
      ).n,
      '30',
    )
    checks++
    await db.exec('set role service_role')
    assert.equal(
      (
        await one(
          "select render_smart_follow_up('{name} {product}','Customer {product}','Actual',100) rendered",
        )
      ).rendered,
      'Customer {product} Actual',
    )
    checks++
    async function setup(plan = 'pro', kind = 'payment', ai = false, manual = false) {
      const tenant = (await one('insert into tenants(plan) values($1) returning id', [plan])).id
      await db.query("insert into tenant_members values($1,$2,'owner')", [tenant, owner])
      await db.query('insert into follow_up_policies(tenant_id,enabled) values($1,true)', [tenant])
      const wf = (
        await one(
          'insert into follow_up_workflows(tenant_id,kind,enabled,use_ai,steps) values($1,$2,true,$3,\'[{"delay_minutes":1,"text":"Hello {name} {product} {total}"}]\') returning id',
          [tenant, kind, ai],
        )
      ).id
      const customer = (
        await one('insert into customers(tenant_id) values($1) returning id', [tenant])
      ).id
      const source = (
        await one(
          "insert into messages(customer_id,sender,body) values($1,'customer','hello') returning id",
          [customer],
        )
      ).id
      const product = (
        await one('insert into products(tenant_id) values($1) returning id', [tenant])
      ).id
      const order = (
        await one(
          'insert into orders(tenant_id,customer_id,message_id,product_id) values($1,$2,$3,$4) returning id',
          [tenant, customer, manual ? null : source, product],
        )
      ).id
      await db.query(
        "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
        [tenant],
      )
      return { tenant, customer, source, product, order, wf }
    }
    await db.exec('reset role')
    await db.exec(fs.readFileSync('supabase/manual-follow-ups.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/manual-follow-ups.sql', 'utf8'))
    await db.exec('set role service_role')
    const manualInterest = await setup('pro', 'interested', true)
    await db.query('delete from orders where id=$1', [manualInterest.order])
    const addArgs = [
      manualInterest.tenant,
      owner,
      manualInterest.customer,
      'interested',
      manualInterest.product,
    ]
    const added = (await db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', addArgs))
      .rows
    assert.equal(added.length, 1)
    assert.equal(added[0].status, 'pending')
    checks++
    assert.equal(
      (await db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', addArgs)).rows[0].id,
      added[0].id,
    )
    checks++
    await assert.rejects(
      db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', [
        manualInterest.tenant,
        owner,
        owner,
        'interested',
        manualInterest.product,
      ]),
      (e) => e.code === '22023',
    )
    checks++
    await assert.rejects(
      db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', [
        manualInterest.tenant,
        manualInterest.customer,
        manualInterest.customer,
        'interested',
        manualInterest.product,
      ]),
      (e) => e.code === '42501',
    )
    checks++
    const claim = async (t) =>
      (await db.query('select * from claim_follow_up_jobs($1,1)', [t])).rows[0]
    const prepare = async (j) =>
      (await one('select prepare_follow_up($1,$2) result', [j.id, j.claim_token])).result
    const job = async (t) =>
      one('select * from follow_up_jobs where tenant_id=$1 order by step limit 1', [t])
    const finish = async (j, status, provider = null, reason = null) =>
      (
        await one('select complete_follow_up($1,$2,$3,$4,$5) ok', [
          j.id,
          j.claim_token,
          status,
          provider,
          reason,
        ])
      ).ok
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [manualInterest.tenant],
    )
    assert.equal((await prepare(await claim(manualInterest.tenant))).reason, 'ai_draft')
    checks++
    const noOrder = await setup('starter', 'payment', false, true)
    await db.query('delete from orders where id=$1', [noOrder.order])
    const manualArgs = [noOrder.tenant, owner, noOrder.customer, 'payment', null]
    const manualJobs = (
      await db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', manualArgs)
    ).rows
    assert.equal(manualJobs.length, 1)
    assert.equal(manualJobs[0].status, 'pending')
    assert.equal(manualJobs[0].order_id, null)
    checks++
    assert.equal(
      (await db.query('select * from add_manual_follow_up($1,$2,$3,$4,$5)', manualArgs)).rows[0].id,
      manualJobs[0].id,
    )
    checks++
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [noOrder.tenant],
    )
    assert.equal((await prepare(await claim(noOrder.tenant))).reason, 'ai_draft')
    checks++
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Checked manual reminder')", [
      manualJobs[0].id,
      noOrder.tenant,
      owner,
    ])
    assert.equal((await prepare(await claim(noOrder.tenant))).status, 'ready')
    checks++
    const noOrderAfter = await setup('pro', 'after_sales', false, true)
    await db.query('delete from orders where id=$1', [noOrderAfter.order])
    const afterManual = (
      await db.query("select * from add_manual_follow_up($1,$2,$3,'after_sales',null)", [
        noOrderAfter.tenant,
        owner,
        noOrderAfter.customer,
      ])
    ).rows
    assert.equal(afterManual.length, 1)
    assert.equal(afterManual[0].status, 'pending')
    checks++
    await db.query('update customers set followup_opted_out=true where id=$1', [
      noOrderAfter.customer,
    ])
    assert.equal(
      (
        await db.query("select * from add_manual_follow_up($1,$2,$3,'after_sales',null)", [
          noOrderAfter.tenant,
          owner,
          noOrderAfter.customer,
        ])
      ).rows.length,
      0,
    )
    checks++
    const flexibleInterest = await setup('pro', 'interested', false, true)
    const flexible = (
      await db.query("select * from add_manual_follow_up($1,$2,$3,'interested',null)", [
        flexibleInterest.tenant,
        owner,
        flexibleInterest.customer,
      ])
    ).rows
    assert.equal(flexible.length, 1)
    assert.equal(flexible[0].status, 'pending')
    assert.equal(flexible[0].product_id, null)
    checks++
    await db.query("update follow_up_jobs set run_at=now()-interval '1 minute' where id=$1", [
      flexible[0].id,
    ])
    assert.equal((await prepare(await claim(flexibleInterest.tenant))).reason, 'ai_draft')
    checks++
    await db.query(
      "select act_follow_up_job($1,$2,$3,'approve','Approved generic interest reminder')",
      [flexible[0].id, flexibleInterest.tenant, owner],
    )
    assert.equal((await prepare(await claim(flexibleInterest.tenant))).status, 'ready')
    checks++
    const a = await setup('starter')
    const j = await claim(a.tenant)
    assert.ok(j)
    assert.equal(await claim(a.tenant), undefined)
    assert.equal((await prepare(j)).status, 'ready')
    assert.equal((await prepare(j)).status, 'skipped')
    assert.equal(await finish(j, 'sent', 'mid-1'), true)
    assert.equal(await finish(j, 'failed'), false)
    assert.equal((await job(a.tenant)).status, 'sent')
    checks++
    const claimedChat = await setup('starter')
    const version = (
      await one('select conversation_version from customers where id=$1', [claimedChat.customer])
    ).conversation_version
    await db.query("select manage_inbox_conversation($1,$2,'claim',$3,null)", [
      claimedChat.customer,
      owner,
      version,
    ])
    assert.equal((await job(claimedChat.tenant)).status, 'cancelled')
    assert.equal((await job(claimedChat.tenant)).reason, 'handover')
    assert.equal(
      (
        await one(
          "select actor_id from conversation_events where customer_id=$1 and action='claim'",
          [claimedChat.customer],
        )
      ).actor_id,
      owner,
    )
    assert.equal(
      (await one('select assigned_user_id from customers where id=$1', [claimedChat.customer]))
        .assigned_user_id,
      owner,
    )
    checks++
    for (const [scenario, change, reason] of [
      ['paid', (s) => db.query("update orders set status='paid' where id=$1", [s.order]), 'paid'],
      [
        'cancelled',
        (s) => db.query("update orders set status='cancelled' where id=$1", [s.order]),
        'order_cancelled',
      ],
      [
        'optout',
        (s) =>
          db.query("insert into messages(customer_id,sender,body) values($1,'customer','STOP')", [
            s.customer,
          ]),
        'opt_out',
      ],
      [
        'handoff',
        (s) => db.query('update customers set bot_enabled=false where id=$1', [s.customer]),
        'handover',
      ],
      [
        'reply',
        (s) =>
          db.query("insert into messages(customer_id,sender,body) values($1,'customer','thanks')", [
            s.customer,
          ]),
        'customer_replied',
      ],
      [
        'expiry',
        (s) =>
          db.query("update tenants set plan_expires_at=now()-interval '1 minute' where id=$1", [
            s.tenant,
          ]),
        'plan_required',
      ],
      [
        'window',
        (s) =>
          db.query("update customers set last_message_at=now()-interval '25 hours' where id=$1", [
            s.customer,
          ]),
        'window_closed',
      ],
      [
        'credit',
        (s) =>
          db.query('update tenants set broadcast_credits=0,broadcast_topup_credits=0 where id=$1', [
            s.tenant,
          ]),
        'quota_exhausted',
      ],
      [
        'slip',
        (s) =>
          db.query('insert into slips(tenant_id,customer_id) values($1,$2)', [
            s.tenant,
            s.customer,
          ]),
        'slip_received',
      ],
    ]) {
      const s = await setup()
      const current = await claim(s.tenant)
      await change(s)
      await prepare(current)
      assert.equal((await job(s.tenant)).reason, reason, scenario)
      assert.equal(
        (
          await one('select count(*)::int n from messages where external_id=$1', [
            'followup:' + current.id,
          ])
        ).n,
        0,
        scenario,
      )
      checks++
    }
    const quiet = await setup()
    await db.query(
      "update follow_up_policies set quiet_enabled=true,timezone='UTC',quiet_start=(extract(hour from now() at time zone 'UTC')::int*60+extract(minute from now())::int),quiet_end=(extract(hour from now() at time zone 'UTC')::int*60+extract(minute from now())::int+60)%1440 where tenant_id=$1",
      [quiet.tenant],
    )
    assert.equal((await prepare(await claim(quiet.tenant))).status, 'deferred')
    assert.equal((await job(quiet.tenant)).status, 'pending')
    checks++
    const crash = await setup()
    let pending = await claim(crash.tenant)
    await db.query("update follow_up_jobs set claim_until=now()-interval '1 minute' where id=$1", [
      pending.id,
    ])
    await claim(crash.tenant)
    assert.equal((await job(crash.tenant)).status, 'pending')
    await db.query("update follow_up_jobs set run_at=now()-interval '1 minute' where id=$1", [
      pending.id,
    ])
    pending = await claim(crash.tenant)
    assert.notEqual(pending.claim_token, (await job(a.tenant)).claim_token)
    await prepare(pending)
    await db.query("update follow_up_jobs set claim_until=now()-interval '1 minute' where id=$1", [
      pending.id,
    ])
    assert.equal(await claim(crash.tenant), undefined)
    assert.equal((await job(crash.tenant)).status, 'requires_review')
    await assert.rejects(
      db.query('select act_follow_up_job($1,$2,$3,$4,null)', [
        pending.id,
        crash.tenant,
        owner,
        'retry',
      ]),
      (e) => e.code === '40001',
    )
    checks++
    const failure = await setup()
    const f = await claim(failure.tenant)
    await prepare(f)
    await finish(f, 'failed', null, 'api_rejected')
    assert.equal(
      (await one('select broadcast_credits from tenants where id=$1', [failure.tenant]))
        .broadcast_credits,
      100,
    )
    checks++
    const uncertain = await setup()
    const u = await claim(uncertain.tenant)
    await prepare(u)
    await finish(u, 'requires_review', null, 'delivery_unknown')
    assert.equal(
      (await one('select broadcast_credits from tenants where id=$1', [uncertain.tenant]))
        .broadcast_credits,
      99,
    )
    assert.equal(await claim(uncertain.tenant), undefined)
    checks++
    const limited = await setup()
    await db.query('update follow_up_policies set max_per_customer=1 where tenant_id=$1', [
      limited.tenant,
    ])
    const first = await claim(limited.tenant)
    await prepare(first)
    await finish(first, 'sent', 'mid-limit')
    await db.query(
      "insert into follow_up_jobs(tenant_id,customer_id,order_id,workflow_id,step,text,run_at,source_seq) values($1,$2,$3,$4,2,'second',now()-interval '1 minute',1)",
      [limited.tenant, limited.customer, limited.order, limited.wf],
    )
    assert.equal((await prepare(await claim(limited.tenant))).reason, 'rate_limit')
    checks++
    const after = await setup('pro', 'after_sales')
    assert.equal(await job(after.tenant), undefined)
    await db.query("update orders set status='shipped' where id=$1", [after.order])
    assert.equal(await job(after.tenant), undefined)
    await db.query(
      'insert into order_delivery_events(tenant_id,customer_id,order_id,confirmed_by,evidence,delivered_at) values($1,$2,$3,$4,$5,now())',
      [after.tenant, after.customer, after.order, owner, 'Courier tracking delivered'],
    )
    assert.equal((await job(after.tenant)).kind, 'after_sales')
    checks++
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [after.tenant],
    )
    assert.equal((await prepare(await claim(after.tenant))).status, 'ready')
    checks++
    const interest = await setup('pro', 'interested', true)
    await db.query('delete from orders where id=$1', [interest.order])
    await db.query("select enqueue_follow_up($1,$2,'interested',null,$3,$4)", [
      interest.tenant,
      interest.customer,
      interest.source,
      interest.product,
    ])
    assert.equal((await job(interest.tenant)).status, 'requires_review')
    const ij = await job(interest.tenant)
    await db.query("select act_follow_up_job($1,$2,$3,'approve','Human checked wording')", [
      ij.id,
      interest.tenant,
      owner,
    ])
    assert.equal((await job(interest.tenant)).status, 'pending')
    checks++
    await db.query(
      "update follow_up_jobs set run_at=now()-interval '1 minute' where tenant_id=$1",
      [interest.tenant],
    )
    assert.equal((await prepare(await claim(interest.tenant))).status, 'ready')
    checks++
    const starter = await setup('starter', 'interested')
    await db.query('delete from orders where id=$1', [starter.order])
    await db.query("select enqueue_follow_up($1,$2,'interested',null,$3,$4)", [
      starter.tenant,
      starter.customer,
      starter.source,
      starter.product,
    ])
    assert.equal(await job(starter.tenant), undefined)
    checks++
    const free = await setup('free')
    assert.equal(await job(free.tenant), undefined)
    checks++
    await db.query("insert into messages(customer_id,sender,body) values($1,'customer','STOP')", [
      free.customer,
    ])
    assert.equal(
      (await one('select followup_opted_out from customers where id=$1', [free.customer]))
        .followup_opted_out,
      true,
    )
    await db.query("insert into messages(customer_id,sender,body) values($1,'customer','START')", [
      free.customer,
    ])
    assert.equal(
      (await one('select followup_opted_out from customers where id=$1', [free.customer]))
        .followup_opted_out,
      false,
    )
    assert.equal(await job(free.tenant), undefined)
    checks++
    const settings = await setup('starter')
    const policy = {
      enabled: true,
      timezone: 'Asia/Bangkok',
      quiet_enabled: false,
      quiet_start: 1320,
      quiet_end: 480,
      max_per_customer: 3,
      max_per_order: 3,
    }
    const workflows = ['payment', 'interested', 'after_sales'].map((kind) => ({
      kind,
      version: kind === 'payment' ? 1 : 0,
      enabled: kind === 'payment',
      use_ai: false,
      stop_on_reply: true,
      steps: [
        { delay_minutes: 30, text: 'first' },
        { delay_minutes: 180, text: 'second' },
        { delay_minutes: 360, text: 'third' },
      ],
    }))
    await db.query('select save_smart_follow_up($1,$2,$3,$4)', [
      settings.tenant,
      owner,
      JSON.stringify(policy),
      JSON.stringify(workflows),
    ])
    assert.equal(
      (
        await one(
          "select jsonb_array_length(steps) n from follow_up_workflows where tenant_id=$1 and kind='payment'",
          [settings.tenant],
        )
      ).n,
      3,
    )
    checks++
    await assert.rejects(
      db.query('select save_smart_follow_up($1,$2,$3,$4)', [
        settings.tenant,
        owner,
        JSON.stringify(policy),
        JSON.stringify(workflows),
      ]),
      (e) => e.code === '40001',
    )
    checks++
    const current = (
      await db.query('select * from follow_up_workflows where tenant_id=$1', [settings.tenant])
    ).rows
    current.find((w) => w.kind === 'interested').enabled = true
    await assert.rejects(
      db.query('select save_smart_follow_up($1,$2,$3,$4)', [
        settings.tenant,
        owner,
        JSON.stringify(policy),
        JSON.stringify(current),
      ]),
      (e) => e.code === '42501',
    )
    checks++
    const manual = await setup('pro', 'payment', false, true)
    await db.query("select enqueue_follow_up($1,$2,'payment',$3)", [
      manual.tenant,
      manual.customer,
      manual.order,
    ])
    assert.equal(await job(manual.tenant), undefined)
    await db.query('select confirm_follow_up_order($1,$2,$3)', [manual.order, manual.tenant, owner])
    assert.equal((await job(manual.tenant)).kind, 'payment')
    checks++
    await assert.rejects(
      db.query("select act_follow_up_job($1,$2,$3,'skip',null)", [ij.id, a.tenant, owner]),
      (e) => e.code === 'P0002',
    )
    checks++
    await db.exec('reset role')
    await db.query("select set_config('test.user',$1,false)", [owner])
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select claim_follow_up_jobs(null,1)'), /permission denied/)
    await assert.rejects(
      db.query('update follow_up_workflows set enabled=true'),
      /permission denied/,
    )
    checks++
    console.log(
      `PASS: ${checks} integration scenarios: migration rerun, paid/cancel, opt-out, handoff, replies, expiry, quota, quiet hours, Messenger, duplicate claims, crash recovery, refunds, review safety, verified delivery, AI review, Starter/Pro/Free and tenant/RPC isolation`,
    )
  } finally {
    await db.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
