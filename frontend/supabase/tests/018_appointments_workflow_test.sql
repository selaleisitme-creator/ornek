\set ON_ERROR_STOP on
\pset footer off

begin;

drop schema if exists t cascade;
create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(name text, passed boolean) returns void language plpgsql as $$
begin
  if passed is distinct from true then
    raise exception 'FAIL %', name;
  end if;
  raise notice 'PASS %', name;
end
$$;

create function t.expect_error(name text, command_text text, pattern text) returns void language plpgsql as $$
begin
  begin
    execute command_text;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'PASS %', name;
      return;
    end if;
    raise exception 'FAIL %: unexpected error: %', name, sqlerrm;
  end;
  raise exception 'FAIL %: expected an error', name;
end
$$;

create function t.as_user(uid text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'aal', 'aal2')::text,
    false
  )
$$;

create function t.kind(kind_key text) returns bigint language sql stable as $$
  select id from public.appointment_kinds where key = kind_key
$$;

create function t.source(source_name text) returns bigint language sql stable as $$
  select id from public.referral_sources where name = source_name
$$;

create function t.patient(patient_name text) returns bigint language sql stable as $$
  select id from public.patients where full_name = patient_name
$$;

grant execute on all functions in schema t to anon, authenticated;

insert into public.appointment_requests (
  full_name, phone, email, appointment_date, appointment_time
)
values (
  '018 İş Akışı Talebi', '05551018002', '018-workflow@example.test', '2035-03-11', '13:00'
)
returning id \gset request_

set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

select public.save_appointment(
  null,
  null,
  '018 Yeni Aday',
  '+905105102969',
  t.kind('checkup'),
  '2035-03-10 10:00:00+03'::timestamptz,
  30,
  'waiting',
  t.source('Uygulama'),
  'SQL iş akışı testi'
) as appointment_id \gset saved_

select t.ok(
  'save_appointment creates a candidate with a normalized phone and linked appointment',
  exists (
    select 1
      from public.patients p
      join public.appointments a on a.patient_id = p.id
     where p.full_name = '018 Yeni Aday'
       and p.record_type = 'candidate'
       and p.phone = '+905105102969'
       and a.id = :'saved_appointment_id'::bigint
       and a.status = 'waiting'
       and a.ends_at - a.starts_at = interval '30 minutes'
  )
);

select t.expect_error(
  'save_appointment rejects an overlapping waiting appointment',
  format(
    'select public.save_appointment(null, null, %L, %L, %s, %L::timestamptz, 30, %L, %s, null)',
    '018 Çakışan Aday',
    '+905105102970',
    t.kind('checkup'),
    '2035-03-10 10:15:00+03',
    'waiting',
    t.source('Uygulama')
  ),
  'appointments_no_overlap'
);

select t.ok(
  'overlap failure rolls back the candidate insert',
  not exists (select 1 from public.patients where full_name = '018 Çakışan Aday')
);

select public.convert_appointment_request(
  :'request_id'::uuid,
  t.kind('consultation'),
  '2035-03-11 13:00:00+03'::timestamptz,
  45,
  'Web talebi notu'
) as appointment_id \gset converted_

select t.ok(
  'convert_appointment_request creates the appointment and marks the request converted',
  exists (
    select 1
      from public.appointment_requests r
      join public.appointments a on a.request_id = r.id
      join public.patients p on p.id = a.patient_id
     where r.id = :'request_id'::uuid
       and r.status = 'converted'
       and a.id = :'converted_appointment_id'::bigint
       and a.referral_source_id = t.source('Web sitesi')
       and p.full_name = '018 İş Akışı Talebi'
       and p.phone = '+905551018002'
       and p.record_type = 'candidate'
       and a.notes = 'Web talebi notu'
  )
);

select t.expect_error(
  'convert_appointment_request refuses an already converted request',
  format(
    'select public.convert_appointment_request(%L::uuid, %s, %L::timestamptz, 45, null)',
    :'request_id',
    t.kind('consultation'),
    '2035-03-11 13:00:00+03'
  ),
  'already resolved'
);

select t.ok(
  'a request can create only one appointment',
  (select count(*) = 1 from public.appointments where request_id = :'request_id'::uuid)
);

select public.claim_appointment_reminder(:'converted_appointment_id'::bigint, '1d')
  as first_claim \gset reminder_
select t.ok('claim_appointment_reminder allows the first display', :'reminder_first_claim'::boolean);

select public.claim_appointment_reminder(:'converted_appointment_id'::bigint, '1d')
  as duplicate_claim \gset reminder_again_
select t.ok('claim_appointment_reminder refuses an immediate duplicate', not :'reminder_again_duplicate_claim'::boolean);

update public.appointment_reminders
   set shown_at = now() - interval '6 minutes'
 where appointment_id = :'converted_appointment_id'::bigint
   and reminder_offset = '1d';

select public.claim_appointment_reminder(:'converted_appointment_id'::bigint, '1d')
  as snoozed_claim \gset reminder_snoozed_
select t.ok('a dismissed reminder can be shown again after five minutes', :'reminder_snoozed_snoozed_claim'::boolean);

select public.claim_appointment_reminder(:'converted_appointment_id'::bigint, '1d')
  as after_snooze_duplicate \gset reminder_after_snooze_
select t.ok('the reminder is still claimed only once during each display window', not :'reminder_after_snooze_after_snooze_duplicate'::boolean);

rollback;
