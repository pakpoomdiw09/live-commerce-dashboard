begin;

create or replace function public.facebook_is_system_disclosure(p_text text) returns boolean
language sql immutable parallel safe set search_path=pg_catalog as $$
 select coalesce(
  p_text ilike '%Facebook สร้างแชทนี้เนื่องจาก%'
  or p_text ilike '%สร้างแชทนี้เนื่องจาก%'
  or p_text ilike '%ต้องการส่งข้อความส่วนบุคคล ซึ่งอาจเป็นข้อความโปรโมชัน%'
  , false
 );
$$;
revoke all on function public.facebook_is_system_disclosure(text) from public,anon,authenticated;
grant execute on function public.facebook_is_system_disclosure(text) to service_role;

-- Do not persist Facebook's automated thread disclosures as customer messages.
create or replace function public.facebook_inbound_message_at(
  p_payload jsonb,
  p_page text,
  p_received_at timestamptz
) returns timestamptz
language plpgsql immutable set search_path=pg_catalog,public as $$
declare
  m jsonb;
  flag text;
  has_text boolean;
  has_media boolean;
  milliseconds numeric;
  whitespace text:='[[:space:]]';
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or p_page is null
    or p_page !~ '^\d{1,64}$'
    or p_received_at is null
    or not isfinite(p_received_at) then
    return null;
  end if;
  if p_payload ?| array[
    'delivery', 'read', 'postback', 'optin', 'referral', 'account_linking',
    'reaction', 'message_reaction', 'message_edit', 'pass_thread_control',
    'take_thread_control', 'request_thread_control'
  ] then
    return null;
  end if;
  if jsonb_typeof(p_payload->'sender'->'id') is distinct from 'string'
    or p_payload->'sender'->>'id' !~ '^\d{1,64}$'
    or p_payload->'sender'->>'id' = p_page
    or jsonb_typeof(p_payload->'recipient'->'id') is distinct from 'string'
    or p_payload->'recipient'->>'id' is distinct from p_page then
    return null;
  end if;
  m := p_payload->'message';
  if jsonb_typeof(m) is distinct from 'object'
    or public.facebook_is_system_disclosure(m->>'text') then
    return null;
  end if;
  foreach flag in array array['is_echo', 'is_deleted', 'is_unsupported'] loop
    if m ? flag and m->flag is distinct from 'false'::jsonb then
      return null;
    end if;
  end loop;
  if jsonb_typeof(m->'mid') is distinct from 'string'
    or regexp_replace(m->>'mid', whitespace, '', 'g') = ''
    or length(m->>'mid') > 512 then
    return null;
  end if;
  has_text := jsonb_typeof(m->'text') = 'string'
    and regexp_replace(m->>'text', whitespace, '', 'g') <> '';
  select exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(m->'attachments') = 'array'
        then m->'attachments' else '[]'::jsonb end
    ) a
    where jsonb_typeof(a) = 'object'
      and a->>'type' in ('image', 'audio', 'video', 'file', 'location', 'fallback')
      and jsonb_typeof(a->'payload') = 'object'
  ) into has_media;
  if not coalesce(has_text, false) and not has_media then return null; end if;
  if jsonb_typeof(p_payload->'timestamp') is distinct from 'number' then return null; end if;
  milliseconds := (p_payload->>'timestamp')::numeric;
  if milliseconds <= 0
    or milliseconds <> trunc(milliseconds)
    or milliseconds > 9007199254740991
    or milliseconds > floor(extract(epoch from p_received_at) * 1000) then
    return null;
  end if;
  return to_timestamp(floor(milliseconds / 1000)::double precision)
    + (mod(milliseconds, 1000)::integer * interval '1 millisecond');
end;
$$;
revoke all on function public.facebook_inbound_message_at(jsonb,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.facebook_inbound_message_at(jsonb,text,timestamptz)
  to service_role;

-- messages stores text in `body` (not `content`); remove only the known Meta disclosures.
delete from public.messages
where public.facebook_is_system_disclosure(body);

notify pgrst, 'reload schema';
commit;
