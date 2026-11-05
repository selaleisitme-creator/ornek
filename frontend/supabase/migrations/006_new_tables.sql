-- 006_new_tables.sql
-- Three tables found in the design review and the clinic owner's answers (2026-11-06):
--   R34 patient_contacts      last contact with a patient (WhatsApp, phone) for maintenance follow-ups
--   R35 device_replacements   a device swapped under warranty or service, without a sale
--   R36 patient_national_ids  national ID numbers, moved out of patients so interns cannot read them
-- Design reference: ŞELALE/docs/ekran-plani.md (sections 1.5.1 and 2).
-- Run once in the Supabase SQL Editor, after 005_accounting.sql.

begin;

-- ---------------------------------------------------------------------------
-- R34 Patient contacts
-- ---------------------------------------------------------------------------

-- A log instead of a single "last contacted" column on patients: the patient card shows the latest
-- entry, and the home page needs to know why each contact happened (maintenance, reminder…).
create table public.patient_contacts (
  id             bigint generated always as identity primary key,
  patient_id     bigint not null references public.patients (id),
  contacted_at   timestamptz not null default now(),
  channel        text not null default 'whatsapp' check (channel in ('whatsapp', 'phone', 'in_person')),
  purpose        text not null default 'general' check (purpose in ('maintenance', 'reminder', 'adaptation', 'general')),
  appointment_id bigint references public.appointments (id),  -- filled when the contact was an appointment reminder
  note           text,
  created_by     uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);

create index patient_contacts_patient_id_idx on public.patient_contacts (patient_id, contacted_at desc);

-- ---------------------------------------------------------------------------
-- R35 Device replacements
-- ---------------------------------------------------------------------------

create table public.device_replacements (
  id                bigint generated always as identity primary key,
  sale_item_id      bigint not null references public.sale_items (id),
  old_stock_unit_id bigint not null references public.stock_units (id),
  -- Unique: a unit can be handed out as a replacement only once.
  new_stock_unit_id bigint not null unique references public.stock_units (id),
  replaced_on       date not null default current_date,
  reason            text not null default 'warranty' check (reason in ('warranty', 'service')),
  note              text,
  created_by        uuid not null default auth.uid() references public.profiles (id),
  created_at        timestamptz not null default now(),
  constraint device_replacements_different_units check (old_stock_unit_id <> new_stock_unit_id)
);

create index device_replacements_sale_item_id_idx on public.device_replacements (sale_item_id, replaced_on);

-- Keeps the chain honest: the replaced unit must be the one the patient is using right now
-- (the sold unit, or the latest replacement), and stock statuses follow the swap in the same transaction.
create or replace function public.device_replacement_apply()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  current_unit bigint;
begin
  if exists (select 1 from public.refunds where sale_item_id = new.sale_item_id) then
    raise exception 'A refunded sale item cannot get a replacement' using errcode = 'P0001';
  end if;

  select coalesce(
           (select dr.new_stock_unit_id from public.device_replacements dr
             where dr.sale_item_id = new.sale_item_id
             order by dr.replaced_on desc, dr.id desc
             limit 1),
           si.stock_unit_id)
    into current_unit
    from public.sale_items si
   where si.id = new.sale_item_id;

  if current_unit is null or current_unit <> new.old_stock_unit_id then
    raise exception 'Unit % is not the device currently in use for sale item %', new.old_stock_unit_id, new.sale_item_id
      using errcode = 'P0001';
  end if;

  -- The new unit either comes straight from the manufacturer (registered as sold) or from the shelf.
  update public.stock_units set status = 'sold'
   where id = new.new_stock_unit_id and status in ('in_stock', 'sold');
  if not found then
    raise exception 'Unit % cannot be handed out (it is in service or removed)', new.new_stock_unit_id
      using errcode = 'P0001';
  end if;

  update public.stock_units set status = 'removed' where id = new.old_stock_unit_id;
  return new;
end;
$$;

create trigger device_replacements_apply
before insert on public.device_replacements
for each row execute function public.device_replacement_apply();

-- ---------------------------------------------------------------------------
-- R36 Patient national IDs
-- ---------------------------------------------------------------------------

-- RLS decides which rows someone may read, not which columns. Kept on patients, the ID could be read by
-- everyone who can open a patient card (interns included). In its own table, one rule hides it.
create or replace function public.can_view_national_ids()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_mfa_verified()
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and active and can_view_national_id
     )
$$;

create table public.patient_national_ids (
  patient_id  bigint primary key references public.patients (id),
  encrypted   text not null,  -- encrypted and decrypted by the server code; the key never reaches the database
  last4       text not null check (last4 ~ '^[0-9]{4}$'),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  updated_at  timestamptz not null default now()
);

-- patients is still empty, so the two columns can go without moving any data. The check stops the whole
-- file (nothing is changed) if an ID was entered in the meantime, instead of silently deleting it.
do $$
begin
  if exists (select 1 from public.patients where national_id_encrypted is not null) then
    raise exception 'patients already holds national IDs; move them into patient_national_ids before dropping the columns';
  end if;
end;
$$;

alter table public.patients drop constraint patients_national_id_pair;
alter table public.patients drop column national_id_encrypted;
alter table public.patients drop column national_id_last4;

-- Lets every staff member see *whether* an ID is on file ("TC kayıtlı") without seeing the ID.
-- Runs with the owner's rights (no security_invoker), so it must only ever expose patient_id.
create view public.patient_national_id_presence
as
select patient_id
from public.patient_national_ids
where public.is_active_staff();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.patient_contacts     enable row level security;
alter table public.device_replacements  enable row level security;
alter table public.patient_national_ids enable row level security;

create policy "staff read patient contacts" on public.patient_contacts for select to authenticated using (public.is_active_staff());
create policy "staff add patient contacts"  on public.patient_contacts for insert to authenticated with check (public.is_active_staff());
create policy "staff edit patient contacts" on public.patient_contacts for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- A replacement is a fact about the past; it is added, never edited.
create policy "staff read device replacements" on public.device_replacements for select to authenticated using (public.is_active_staff());
create policy "staff add device replacements"  on public.device_replacements for insert to authenticated with check (public.is_active_staff());

-- Anyone on staff may enter the ID of a new patient (write-only for interns);
-- reading and correcting it needs can_view_national_id.
create policy "id viewers read national ids" on public.patient_national_ids for select to authenticated using (public.can_view_national_ids());
create policy "staff add national ids"       on public.patient_national_ids for insert to authenticated with check (public.is_active_staff());
create policy "id viewers edit national ids" on public.patient_national_ids for update to authenticated
  using (public.can_view_national_ids()) with check (public.can_view_national_ids());

commit;
