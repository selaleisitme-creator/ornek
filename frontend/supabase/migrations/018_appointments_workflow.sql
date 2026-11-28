begin;

create or replace function public.save_appointment(
  p_appointment_id bigint,
  p_patient_id bigint,
  p_patient_name text,
  p_patient_phone text,
  p_kind_id bigint,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_status text,
  p_referral_source_id bigint,
  p_notes text
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_patient public.patients%rowtype;
  v_source_id bigint;
  v_appointment_id bigint;
begin
  if not public.is_active_staff() then
    raise exception 'Active staff only' using errcode = '42501';
  end if;

  if p_duration_minutes not in (15, 30, 45, 60, 90) then
    raise exception 'Appointment duration must be 15, 30, 45, 60 or 90 minutes'
      using errcode = '23514';
  end if;
  if p_status not in ('waiting', 'attended', 'no_show', 'cancelled') then
    raise exception 'Unknown appointment status' using errcode = '23514';
  end if;
  if p_starts_at is null or p_kind_id is null then
    raise exception 'Appointment date, time and kind are required' using errcode = '23514';
  end if;

  if p_patient_id is null then
    if btrim(coalesce(p_patient_name, '')) = '' or btrim(coalesce(p_patient_phone, '')) = '' then
      raise exception 'A new appointment candidate needs a name and phone number' using errcode = '23514';
    end if;
    select * into v_patient
      from public.patients
     where active
       and lower(btrim(full_name)) = lower(btrim(p_patient_name))
       and regexp_replace(phone, '[^0-9]', '', 'g') =
           regexp_replace(p_patient_phone, '[^0-9]', '', 'g')
     order by id
     limit 1
     for update;
    if not found then
      insert into public.patients (
        full_name, phone, record_type, referral_source_id, registered_on
      )
      values (
        btrim(p_patient_name),
        btrim(p_patient_phone),
        'candidate',
        p_referral_source_id,
        (now() at time zone 'Europe/Istanbul')::date
      )
      returning * into v_patient;
    end if;
  else
    select * into v_patient
      from public.patients
     where id = p_patient_id and active
     for update;
    if not found then
      raise exception 'Patient not found or inactive' using errcode = '23503';
    end if;
    if regexp_replace(v_patient.phone, '[^0-9]', '', 'g') <>
       regexp_replace(p_patient_phone, '[^0-9]', '', 'g') then
      update public.patients
         set phone = btrim(p_patient_phone)
       where id = v_patient.id
       returning * into v_patient;
    end if;
  end if;

  -- Existing patient appointments inherit the source recorded on that patient.
  v_source_id := case
    when v_patient.record_type = 'candidate' then coalesce(p_referral_source_id, v_patient.referral_source_id)
    else v_patient.referral_source_id
  end;

  if p_appointment_id is null then
    insert into public.appointments (
      patient_id, kind_id, starts_at, ends_at, status, cancelled_at, referral_source_id, notes
    )
    values (
      v_patient.id,
      p_kind_id,
      p_starts_at,
      p_starts_at + make_interval(mins => p_duration_minutes),
      p_status,
      case when p_status = 'cancelled' then now() else null end,
      v_source_id,
      nullif(btrim(coalesce(p_notes, '')), '')
    )
    returning id into v_appointment_id;
  else
    update public.appointments
       set patient_id = v_patient.id,
           kind_id = p_kind_id,
           starts_at = p_starts_at,
           ends_at = p_starts_at + make_interval(mins => p_duration_minutes),
           status = p_status,
           cancelled_at = case when p_status = 'cancelled' then coalesce(cancelled_at, now()) else null end,
           referral_source_id = v_source_id,
           notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = p_appointment_id
     returning id into v_appointment_id;
    if not found then
      raise exception 'Appointment not found' using errcode = '23503';
    end if;
  end if;

  return v_appointment_id;
end;
$$;

create or replace function public.convert_appointment_request(
  p_request_id uuid,
  p_kind_id bigint,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_notes text
)
returns bigint
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_request public.appointment_requests%rowtype;
  v_patient public.patients%rowtype;
  v_web_source_id bigint;
  v_appointment_id bigint;
  v_request_phone text;
begin
  if not public.is_active_staff() then
    raise exception 'Active staff only' using errcode = '42501';
  end if;
  if p_duration_minutes not in (15, 30, 45, 60, 90) then
    raise exception 'Appointment duration must be 15, 30, 45, 60 or 90 minutes'
      using errcode = '23514';
  end if;
  if p_kind_id is null or p_starts_at is null then
    raise exception 'Appointment date, time and kind are required' using errcode = '23514';
  end if;

  select * into v_request
    from public.appointment_requests
   where id = p_request_id
   for update;
  if not found then
    raise exception 'Appointment request not found' using errcode = '23503';
  end if;
  if v_request.status <> 'new' then
    raise exception 'Appointment request is already resolved' using errcode = '23514';
  end if;
  v_request_phone := regexp_replace(v_request.phone, '[^0-9]', '', 'g');
  if left(v_request_phone, 2) = '00' then
    v_request_phone := substr(v_request_phone, 3);
  end if;
  if length(v_request_phone) = 11 and left(v_request_phone, 1) = '0' then
    v_request_phone := '90' || substr(v_request_phone, 2);
  elsif length(v_request_phone) = 10 then
    v_request_phone := '90' || v_request_phone;
  end if;
  if v_request_phone !~ '^[1-9][0-9]{7,14}$' then
    raise exception 'Appointment request needs a valid phone number' using errcode = '23514';
  end if;
  v_request_phone := '+' || v_request_phone;

  select id into v_web_source_id
    from public.referral_sources
   where lower(btrim(name)) = lower('Web sitesi')
   order by id
   limit 1;
  if v_web_source_id is null then
    raise exception 'Web sitesi referral source not found' using errcode = '23503';
  end if;

  select * into v_patient
    from public.patients
   where active
     and regexp_replace(phone, '[^0-9]', '', 'g') =
         regexp_replace(v_request_phone, '[^0-9]', '', 'g')
     and lower(btrim(full_name)) = lower(btrim(v_request.full_name))
   order by id
   limit 1
   for update;

  if not found then
    insert into public.patients (
      full_name, phone, record_type, referral_source_id, registered_on
    )
    values (
      btrim(v_request.full_name),
      v_request_phone,
      'candidate',
      v_web_source_id,
      (now() at time zone 'Europe/Istanbul')::date
    )
    returning * into v_patient;
  end if;

  insert into public.appointments (
    patient_id, kind_id, starts_at, ends_at, status, referral_source_id, request_id, notes
  )
  values (
    v_patient.id,
    p_kind_id,
    p_starts_at,
    p_starts_at + make_interval(mins => p_duration_minutes),
    'waiting',
    v_web_source_id,
    v_request.id,
    nullif(btrim(coalesce(p_notes, '')), '')
  )
  returning id into v_appointment_id;

  update public.appointment_requests
     set status = 'converted'
   where id = v_request.id;

  return v_appointment_id;
end;
$$;

create or replace function public.claim_appointment_reminder(
  p_appointment_id bigint,
  p_reminder_offset text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Active staff only' using errcode = '42501';
  end if;
  if p_reminder_offset not in ('3d', '1d', '1h') then
    raise exception 'Unknown appointment reminder offset' using errcode = '23514';
  end if;

  -- Closing the popup releases it after five minutes; sent reminders are never reclaimed.
  insert into public.appointment_reminders (appointment_id, reminder_offset, shown_at)
  values (p_appointment_id, p_reminder_offset, now())
  on conflict (appointment_id, reminder_offset) do update
     set shown_at = excluded.shown_at
   where appointment_reminders.sent_at is null
     and (
       appointment_reminders.shown_at is null
       or appointment_reminders.shown_at <= excluded.shown_at - interval '5 minutes'
     );
  return found;
end;
$$;

create or replace function public.record_appointment_reminder_sent(
  p_appointment_id bigint,
  p_reminder_offset text
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_patient_id bigint;
begin
  if not public.is_active_staff() then
    raise exception 'Active staff only' using errcode = '42501';
  end if;

  update public.appointment_reminders
     set sent_at = now()
   where appointment_id = p_appointment_id
     and reminder_offset = p_reminder_offset
     and shown_at is not null
     and sent_at is null;
  if not found then
    raise exception 'Appointment reminder was not shown or was already recorded' using errcode = '23514';
  end if;

  select patient_id into v_patient_id
    from public.appointments
   where id = p_appointment_id;
  if v_patient_id is null then
    raise exception 'Appointment not found' using errcode = '23503';
  end if;

  insert into public.patient_contacts (patient_id, channel, purpose, appointment_id)
  values (v_patient_id, 'whatsapp', 'reminder', p_appointment_id);
end;
$$;

revoke all on function public.save_appointment(bigint, bigint, text, text, bigint, timestamptz, integer, text, bigint, text) from public, anon;
revoke all on function public.convert_appointment_request(uuid, bigint, timestamptz, integer, text) from public, anon;
revoke all on function public.claim_appointment_reminder(bigint, text) from public, anon;
revoke all on function public.record_appointment_reminder_sent(bigint, text) from public, anon;
grant execute on function public.save_appointment(bigint, bigint, text, text, bigint, timestamptz, integer, text, bigint, text) to authenticated;
grant execute on function public.convert_appointment_request(uuid, bigint, timestamptz, integer, text) to authenticated;
grant execute on function public.claim_appointment_reminder(bigint, text) to authenticated;
grant execute on function public.record_appointment_reminder_sent(bigint, text) to authenticated;

commit;
