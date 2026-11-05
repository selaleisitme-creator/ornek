-- 004_appointments.sql
-- Appointment kinds (R20), appointments (R21), reminders (R22) and panel access to the
-- website's appointment requests (R23).
-- Design reference: ŞELALE/docs/veritabani-normalizasyon.md (section 4, "Randevular").
-- Run once in the Supabase SQL Editor, after 003_patients_sales.sql.

begin;

-- ---------------------------------------------------------------------------
-- R20 Appointment kinds
-- ---------------------------------------------------------------------------

create table public.appointment_kinds (
  id                    bigint generated always as identity primary key,
  key                   text not null unique check (key ~ '^[a-z_]+$'),
  name                  text not null check (btrim(name) <> ''),
  -- Kinds that reset the "maintenance due" clock on the patient card.
  counts_as_maintenance boolean not null default false,
  sort_order            integer not null default 0,
  active                boolean not null default true
);

insert into public.appointment_kinds (key, name, counts_as_maintenance, sort_order) values
  ('checkup',      'Kontrol',            false, 1),
  ('hearing_test', 'İşitme testi',       false, 2),
  ('programming',  'Cihaz programlama',  false, 3),
  ('delivery',     'Cihaz teslimi',      false, 4),
  ('maintenance',  'Servis / bakım',     true,  5),
  ('consultation', 'Danışmanlık',        false, 6),
  ('other',        'Diğer',              false, 7);

-- ---------------------------------------------------------------------------
-- R21 Appointments
-- ---------------------------------------------------------------------------

create table public.appointments (
  id                 bigint generated always as identity primary key,
  patient_id         bigint not null references public.patients (id),
  kind_id            bigint not null references public.appointment_kinds (id),
  starts_at          timestamptz not null,
  -- End time instead of a duration column: the overlap rule below needs a plain range of two stored
  -- values, and the duration is simply ends_at - starts_at.
  ends_at            timestamptz not null,
  status             text not null default 'waiting'
                     check (status in ('waiting', 'attended', 'no_show', 'cancelled')),
  cancelled_at       timestamptz,
  referral_source_id bigint references public.referral_sources (id),
  request_id         uuid unique references public.appointment_requests (id),
  notes              text,
  created_by         uuid default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now(),
  constraint appointments_duration check (ends_at - starts_at between interval '15 minutes' and interval '90 minutes'),
  constraint appointments_cancelled_pair check ((status = 'cancelled') = (cancelled_at is not null)),
  -- One clinic, one room: a waiting or attended appointment may not overlap another one.
  -- '[)' means the end minute is free, so 10:00-10:30 and 10:30-11:00 do not clash.
  constraint appointments_no_overlap exclude using gist (
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('waiting', 'attended'))
);

create index appointments_patient_id_idx on public.appointments (patient_id, starts_at desc);
create index appointments_starts_at_idx on public.appointments (starts_at);

-- ---------------------------------------------------------------------------
-- R22 Appointment reminders
-- ---------------------------------------------------------------------------

create table public.appointment_reminders (
  appointment_id  bigint not null references public.appointments (id),
  -- "offset" is a reserved word in SQL, hence the longer name.
  reminder_offset text not null check (reminder_offset in ('3d', '1d', '1h')),
  shown_at        timestamptz,
  sent_at         timestamptz,
  primary key (appointment_id, reminder_offset)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.appointment_kinds     enable row level security;
alter table public.appointments          enable row level security;
alter table public.appointment_reminders enable row level security;

create policy "staff read appointment kinds" on public.appointment_kinds for select to authenticated using (public.is_active_staff());
create policy "staff add appointment kinds"  on public.appointment_kinds for insert to authenticated with check (public.is_active_staff());
create policy "staff edit appointment kinds" on public.appointment_kinds for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read appointments" on public.appointments for select to authenticated using (public.is_active_staff());
create policy "staff add appointments"  on public.appointments for insert to authenticated with check (public.is_active_staff());
create policy "staff edit appointments" on public.appointments for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read reminders" on public.appointment_reminders for select to authenticated using (public.is_active_staff());
create policy "staff add reminders"  on public.appointment_reminders for insert to authenticated with check (public.is_active_staff());
create policy "staff edit reminders" on public.appointment_reminders for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- The website keeps writing requests with the secret key (no change there). Panel staff may now
-- read them and mark them converted or rejected; they still cannot create or delete them.
create policy "staff read appointment requests" on public.appointment_requests for select to authenticated using (public.is_active_staff());
create policy "staff edit appointment requests" on public.appointment_requests for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

commit;
