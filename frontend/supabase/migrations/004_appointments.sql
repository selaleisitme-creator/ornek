-- 004_appointments.sql
-- Clinic appointment calendar and website appointment requests.

begin;

create table if not exists public.appointment_requests (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null check (btrim(full_name) <> ''),
  phone            text not null check (btrim(phone) <> ''),
  email            text not null,
  appointment_date date not null,
  appointment_time text not null,
  status           text not null default 'new'
                   check (status in ('new', 'converted', 'rejected')),
  issue            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.appointment_kinds (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  color      text not null default 'blue',
  sort_order integer not null default 0,
  active     boolean not null default true
);

insert into public.appointment_kinds (name, color, sort_order) values
  ('İşitme testi', 'blue', 10),
  ('Cihaz kontrolleri', 'green', 20),
  ('Bakım / servis', 'amber', 30),
  ('İşitme cihazı danışmanlığı', 'violet', 40)
on conflict (name) do nothing;

create table if not exists public.appointments (
  id          bigint generated always as identity primary key,
  patient_id  bigint not null references public.patients (id),
  kind_id     bigint not null references public.appointment_kinds (id),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  status      text not null default 'waiting'
              check (status in ('waiting', 'attended', 'no_show', 'cancelled')),
  referral_source_id bigint references public.referral_sources (id),
  request_id  uuid references public.appointment_requests (id),
  notes       text,
  cancelled_at timestamptz,
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now(),
  constraint appointments_time_order check (ends_at > starts_at)
);

create index if not exists appointments_starts_at_idx on public.appointments (starts_at);
create index if not exists appointments_patient_idx on public.appointments (patient_id, starts_at desc);
create index if not exists appointments_request_idx on public.appointments (request_id);

-- Deleting a website request must not block deleting its linked appointment request history.
do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'appointments_request_id_fkey'
      and conrelid = 'public.appointments'::regclass
  ) then
    alter table public.appointments
      drop constraint appointments_request_id_fkey,
      add constraint appointments_request_id_fkey
        foreign key (request_id)
        references public.appointment_requests (id)
        on delete set null;
  end;
end;
$$;

-- Keep changing a request into an appointment idempotent and move it out of the new queue.
alter table public.appointment_requests
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists issue text;

alter table public.appointment_kinds enable row level security;
alter table public.appointments enable row level security;

create policy "staff read appointment kinds" on public.appointment_kinds
  for select to authenticated using (public.is_active_staff());
create policy "staff manage appointment kinds" on public.appointment_kinds
  for all to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

create policy "staff read appointments" on public.appointments
  for select to authenticated using (public.is_active_staff());
create policy "staff add appointments" on public.appointments
  for insert to authenticated
  with check (public.is_active_staff());
create policy "staff edit appointments" on public.appointments
  for update to authenticated
  using (public.is_active_staff())
  with check (public.is_active_staff());

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'appointment_requests'
      and policyname = 'staff read appointment requests'
  ) then
    create policy "staff read appointment requests" on public.appointment_requests
      for select to authenticated using (public.is_active_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'appointment_requests'
      and policyname = 'staff add appointment requests'
  ) then
    create policy "staff add appointment requests" on public.appointment_requests
      for insert to authenticated
      with check (public.is_active_staff());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'appointment_requests'
      and policyname = 'staff edit appointment requests'
  ) then
    create policy "staff edit appointment requests" on public.appointment_requests
      for update to authenticated
      using (public.is_active_staff())
      with check (public.is_active_staff());
  end if;
end;
$$;

-- Reject overlapping active appointments. Cancelled appointments do not occupy the calendar.
create or replace function public.appointment_no_overlap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'cancelled' then
    return new;
  end if;

  if exists (
    select 1
    from public.appointments existing
    where existing.id is distinct from new.id
      and existing.status <> 'cancelled'
      and existing.starts_at < new.ends_at
      and existing.ends_at > new.starts_at
  ) then
    raise exception 'Bu saat aralığında başka bir randevu var.'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists appointments_no_overlap on public.appointments;
create trigger appointments_no_overlap
  before insert or update of starts_at, ends_at, status
  on public.appointments
  for each row execute function public.appointment_no_overlap();

grant select, insert, update on public.appointment_kinds to authenticated;
grant select, insert, update on public.appointments to authenticated;
grant select, insert, update on public.appointment_requests to authenticated;

commit;
