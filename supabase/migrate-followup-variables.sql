-- Run the WHOLE file as postgres in Supabase SQL Editor, after automation.sql.
-- Migrates existing settings and scheduled message templates. Safe to re-run.
-- Custom Thai messages, delays, extra steps and unrelated JSON properties are preserved.
-- English-only messages in steps 1/2 become the new Thai defaults; other steps only
-- have placeholders translated. Sent/cancelled/failed history is never rewritten.
begin;

do $$
declare
  saved_gates jsonb;
  gate record;
  first_message text := 'คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ';
  second_message text := 'แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ';
begin
  -- This maintenance update must work for Free/expired tenants too. Temporarily
  -- disable only feature-gate triggers, preserving their original enabled states.
  lock table public.bot_settings in access exclusive mode;
  select coalesce(jsonb_agg(jsonb_build_object('name', tgname, 'enabled', tgenabled)), '[]'::jsonb)
  into saved_gates from pg_trigger
  where tgrelid = 'public.bot_settings'::regclass
    and tgname in ('bot_settings_ai_plan_gate', 'bot_settings_followup_plan_gate');
  for gate in select * from jsonb_to_recordset(saved_gates) as g(name text, enabled text) loop
    execute format('alter table public.bot_settings disable trigger %I', gate.name);
  end loop;

  with migrated as (
    select s.tenant_id, coalesce((
      select jsonb_agg(
        case when jsonb_typeof(item->'text') = 'string' then
          jsonb_set(item, '{text}', to_jsonb(
            case
              -- Ignore placeholders when deciding whether the original message is Thai.
              when ordinal in (1, 2)
                and regexp_replace(item->>'text', '\{(name|total|ชื่อลูกค้า|ยอดเงิน)\}', '', 'g') !~ '[ก-๙]'
                then case when ordinal = 1 then first_message else second_message end
              else replace(replace(item->>'text', '{name}', '{ชื่อลูกค้า}'), '{total}', '{ยอดเงิน}')
            end
          ))
        else item end order by ordinal
      ) from jsonb_array_elements(s.followup_steps) with ordinality as steps(item, ordinal)
    ), '[]'::jsonb) as steps
    from public.bot_settings s where jsonb_typeof(s.followup_steps) = 'array'
  )
  update public.bot_settings s set followup_steps = m.steps, updated_at = now()
  from migrated m where s.tenant_id = m.tenant_id and s.followup_steps is distinct from m.steps;

  for gate in select * from jsonb_to_recordset(saved_gates) as g(name text, enabled text) loop
    execute format('alter table public.bot_settings %s trigger %I',
      case gate.enabled when 'O' then 'enable' when 'A' then 'enable always'
                        when 'R' then 'enable replica' else 'disable' end, gate.name);
  end loop;

  -- Already scheduled reminders hold a snapshot of their text. Migrate those too
  -- so the next worker run uses Thai templates, while keeping audit history intact.
  update public.follow_up_jobs set text = case
    when step in (1, 2)
      and regexp_replace(text, '\{(name|total|ชื่อลูกค้า|ยอดเงิน)\}', '', 'g') !~ '[ก-๙]'
      then case when step = 1 then first_message else second_message end
    else replace(replace(text, '{name}', '{ชื่อลูกค้า}'), '{total}', '{ยอดเงิน}') end
  where status = 'scheduled' and (
    text like '%{name}%' or text like '%{total}%'
    or (step in (1, 2) and regexp_replace(text, '\{(name|total|ชื่อลูกค้า|ยอดเงิน)\}', '', 'g') !~ '[ก-๙]')
  );
end $$;

alter table public.bot_settings alter column followup_steps set default '[
  {"delay_minutes": 15, "text": "คุณ {ชื่อลูกค้า} ยังไม่ได้ส่งสลิปสำหรับยอด {ยอดเงิน} บาทนะคะ โอนแล้วส่งสลิปในแชทนี้ได้เลยค่ะ"},
  {"delay_minutes": 60, "text": "แจ้งเตือนอีกครั้งค่ะ ออเดอร์ยอด {ยอดเงิน} บาท ยังรอการชำระเงิน หากต้องการยกเลิกแจ้งแอดมินได้เลยนะคะ"}
]'::jsonb;

commit;
