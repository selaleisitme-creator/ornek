-- 008_design_gaps.sql
-- Faz 0 database work (ŞELALE/docs/ekran-plani.md, section 2):
--   1. Serial number policy per product; units without a serial number.
--   2. Bulk price changes get a batch id and can be undone.
--   3. Legacy sales: devices sold before the panel (no payments, not in reports or receivables).
--   4. Roles admin / staff / intern, access end date, intern limits, permission guard on profiles.
--   5. Settings editable by all staff; auto sign-out time only by an admin; profiles.last_login_at dropped.
--   6. A patient sale does not also carry a typed customer name.
--   7. Payment method and link names follow the design; the remaining design links are added.
--   8. Views: stock_summary, patient_overview.
--   9. Storage buckets and their rules.
--  10. National ID helper views become functions (closes the Security Advisor warnings).
-- Tests: frontend/supabase/tests/008_design_gaps_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 007_integrity_fixes.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Serial number policy
-- ---------------------------------------------------------------------------

alter table public.products
  add column serial_policy text not null default 'required'
  check (serial_policy in ('required', 'optional', 'none'));

-- Domes and some receivers have no serial number. Filled ones stay unique (NULLs never clash).
alter table public.stock_units alter column serial_no drop not null;

create or replace function public.stock_unit_serial_rule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  policy text;
begin
  select serial_policy into policy from public.products where id = new.product_id;
  if policy = 'required' and new.serial_no is null then
    raise exception 'This product needs a serial number for every unit' using errcode = 'P0001';
  elsif policy = 'none' and new.serial_no is not null then
    raise exception 'This product is tracked without a serial number' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger stock_units_serial_rule
before insert or update of serial_no, product_id on public.stock_units
for each row execute function public.stock_unit_serial_rule();

-- ---------------------------------------------------------------------------
-- 2. Price change batches
-- ---------------------------------------------------------------------------

-- The bulk price RPC (Faz 1) sets app.price_batch for its transaction; every change it causes shares the id.
alter table public.price_changes add column batch_id uuid;
create index price_changes_batch_id_idx on public.price_changes (batch_id) where batch_id is not null;

create or replace function public.current_price_batch()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.price_batch', true), '')::uuid
$$;

create or replace function public.log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into public.price_changes (product_id, price_field, old_price, new_price, changed_by, batch_id)
    values (new.id, 'sale', old.sale_price, new.sale_price, auth.uid(), public.current_price_batch());
  end if;
  if new.purchase_price is distinct from old.purchase_price then
    insert into public.price_changes (product_id, price_field, old_price, new_price, changed_by, batch_id)
    values (new.id, 'purchase', old.purchase_price, new.purchase_price, auth.uid(), public.current_price_batch());
  end if;
  return new;
end;
$$;

create or replace function public.log_service_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_changes (service_id, price_field, old_price, new_price, changed_by, batch_id)
    values (new.id, 'sale', old.price, new.price, auth.uid(), public.current_price_batch());
  end if;
  return new;
end;
$$;

create or replace function public.stock_unit_purchase_price_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_price is distinct from old.purchase_price then
    if auth.uid() is not null and not (public.is_mfa_verified() and public.is_active_admin()) then
      raise exception 'Only an admin can correct the purchase price of a stock unit' using errcode = '42501';
    end if;
    insert into public.price_changes (stock_unit_id, price_field, old_price, new_price, changed_by, batch_id)
    values (new.id, 'purchase', coalesce(old.purchase_price, 0), coalesce(new.purchase_price, 0), auth.uid(),
            public.current_price_batch());
  end if;
  return new;
end;
$$;

-- Puts every price in a batch back. Refuses if any of them was changed again afterwards, so a newer
-- change is never silently overwritten. The undo itself is a new batch, so it can be undone too.
-- Runs with the caller's rights: RLS decides who may change prices.
create or replace function public.undo_price_batch(p_batch_id uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  change   record;
  restored integer := 0;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.price_changes where batch_id = p_batch_id) then
    raise exception 'Price batch % not found', p_batch_id using errcode = 'P0001';
  end if;

  perform set_config('app.price_batch', gen_random_uuid()::text, true);

  for change in
    select * from public.price_changes where batch_id = p_batch_id order by id desc
  loop
    if change.product_id is not null and change.price_field = 'sale' then
      update public.products set sale_price = change.old_price
       where id = change.product_id and sale_price = change.new_price;
    elsif change.product_id is not null then
      update public.products set purchase_price = change.old_price
       where id = change.product_id and purchase_price = change.new_price;
    elsif change.service_id is not null then
      update public.services set price = change.old_price
       where id = change.service_id and price = change.new_price;
    else
      update public.stock_units set purchase_price = change.old_price
       where id = change.stock_unit_id and purchase_price = change.new_price;
    end if;

    if not found then
      raise exception 'A price in this batch was changed again later; undo the newer change first'
        using errcode = 'P0001';
    end if;
    restored := restored + 1;
  end loop;

  perform set_config('app.price_batch', '', true);
  return restored;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Legacy sales
-- ---------------------------------------------------------------------------

-- A legacy sale records a device the patient bought before the panel existed. Its unit is entered without a
-- stock receipt (so no purchase shows up in the cash ledger) and sold by the normal sale item trigger.
alter table public.sales drop constraint sales_sale_kind_check;
alter table public.sales add constraint sales_sale_kind_check check (sale_kind in ('retail', 'service', 'legacy'));

-- The money for a legacy sale was taken before the panel, so it never gets payments here.
create or replace function public.sale_payment_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  kind         text;
  sale_value   numeric;
  sgk_expected numeric;
  patient_paid numeric;
  sgk_paid     numeric;
begin
  select sale_kind, coalesce(sgk_amount, 0) into kind, sgk_expected
    from public.sales where id = new.sale_id for update;
  if not found then
    raise exception 'Sale % does not exist', new.sale_id using errcode = 'P0001';
  end if;
  if kind = 'legacy' then
    raise exception 'A legacy sale (sold before the panel) takes no payments' using errcode = 'P0001';
  end if;

  sale_value := public.sale_total(new.sale_id);

  select coalesce(sum(amount) filter (where payer = 'patient'), 0),
         coalesce(sum(amount) filter (where payer = 'sgk'), 0)
    into patient_paid, sgk_paid
    from public.sale_payments
   where sale_id = new.sale_id and id <> new.id;

  if new.payer = 'sgk' then
    if sgk_paid + new.amount > sgk_expected then
      raise exception 'SGK payments (%) would exceed the expected SGK amount (%)', sgk_paid + new.amount, sgk_expected
        using errcode = 'P0001';
    end if;
  elsif patient_paid + new.amount > sale_value - sgk_expected then
    raise exception 'Patient payments (%) would exceed the patient''s share (%)', patient_paid + new.amount, sale_value - sgk_expected
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace view public.receivables
with (security_invoker = true)
as
select sale_id, sale_no, sale_date, patient_id, buyer_name, total,
       patient_remaining, sgk_remaining, sgk_status
from public.sales_overview
where sale_kind <> 'legacy'
  and (patient_remaining > 0 or sgk_remaining > 0);

create or replace view public.sale_report
with (security_invoker = true)
as
select
  si.id                                          as sale_item_id,
  s.id                                           as sale_id,
  s.sale_no,
  s.sale_date,
  coalesce(pt.full_name, s.customer_name)        as buyer_name,
  b.name || ' ' || pr.name                       as device,
  su.serial_no,
  case when si.service_id is not null then sv.name
       when pr.category = 'device' then 'Cihaz satışı'
       else 'Ürün satışı' end                    as operation,
  si.quantity,
  siv.net_value,
  exists (select 1 from public.refunds r where r.sale_item_id = si.id) as refunded
from public.sale_items si
join public.sales s                on s.id = si.sale_id
join public.sale_item_values siv   on siv.sale_item_id = si.id
left join public.patients pt       on pt.id = s.patient_id
left join public.stock_units su    on su.id = si.stock_unit_id
left join public.products pr       on pr.id = su.product_id
left join public.brands b          on b.id = pr.brand_id
left join public.services sv       on sv.id = si.service_id
where s.sale_kind <> 'legacy';

-- ---------------------------------------------------------------------------
-- 4. Roles, access end date, permission guard
-- ---------------------------------------------------------------------------

-- Live rule was (role = 'admin'); interns and staff need to fit in.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'staff', 'intern'));

-- Internship end date: access stops on its own after this day.
alter table public.profiles add column access_until date;

-- Interns never see national IDs or accounting (clinic owner's rule); enforced here, not only in the UI.
alter table public.profiles add constraint profiles_intern_limits
  check (role <> 'intern' or (not can_view_national_id and not can_view_accounting));

-- Every permission check goes through is_active_staff(), so the end date applies everywhere at once.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_mfa_verified()
     and exists (
       select 1 from public.profiles
       where id = auth.uid()
         and active
         and (access_until is null or access_until >= (now() at time zone 'Europe/Istanbul')::date)
     )
$$;

create or replace function public.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active
      and (access_until is null or access_until >= (now() at time zone 'Europe/Istanbul')::date)
  )
$$;

create or replace function public.is_accounting_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
     and exists (select 1 from public.profiles where id = auth.uid() and can_view_accounting)
$$;

create or replace function public.can_view_national_ids()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_staff()
     and exists (select 1 from public.profiles where id = auth.uid() and can_view_national_id)
$$;

-- Whatever the profiles RLS rules allow, nobody but an admin may change who has which role or permission;
-- otherwise an intern could give themselves accounting access. auth.uid() is empty only for the server's
-- secret key and migrations.
create or replace function public.profile_permission_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or (public.is_mfa_verified() and public.is_active_admin()) then
    return new;
  end if;

  if tg_op = 'INSERT'
     or new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.access_until is distinct from old.access_until
     or new.can_view_national_id is distinct from old.can_view_national_id
     or new.can_view_accounting is distinct from old.can_view_accounting then
    raise exception 'Only an admin can change roles, access or permissions' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_permission_guard
before insert or update on public.profiles
for each row execute function public.profile_permission_guard();

-- ---------------------------------------------------------------------------
-- 5. Settings
-- ---------------------------------------------------------------------------

alter table public.settings
  add column idle_logout_minutes integer not null default 30 check (idle_logout_minutes between 5 and 480);

-- Nothing ever wrote it; Supabase keeps the real value in auth.users.last_sign_in_at.
alter table public.profiles drop column if exists last_login_at;

-- Clinic owner: interns may change settings too. Only the auto sign-out time stays with the admin.
drop policy "admins edit settings" on public.settings;
create policy "staff edit settings" on public.settings for update to authenticated
  using (public.is_active_staff()) with check (public.is_active_staff());

create or replace function public.settings_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.idle_logout_minutes is distinct from old.idle_logout_minutes
     and auth.uid() is not null
     and not (public.is_mfa_verified() and public.is_active_admin()) then
    raise exception 'Only an admin can change the auto sign-out time' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger settings_guard
before update on public.settings
for each row execute function public.settings_guard();

-- ---------------------------------------------------------------------------
-- 6. Customer fields only for walk-in customers
-- ---------------------------------------------------------------------------

alter table public.sales add constraint sales_customer_only_without_patient
  check (patient_id is null or (customer_name is null and customer_phone is null));

-- ---------------------------------------------------------------------------
-- 7. Names and links from the design
-- ---------------------------------------------------------------------------

update public.payment_methods set name = 'Kart (POS)' where code = 'card_pos';

-- Most design links start with "Adres ekle", so a link may wait for its address.
alter table public.links drop constraint links_url_required;

update public.links set name = 'Ürün Takip Sistemi' where system_key = 'uts';
update public.links set name = 'WSA Garanti Takip' where system_key = 'wsa';
update public.links set url = 'https://gss.sgk.gov.tr/medikalmerkez/faces/pages/login.jsp' where system_key = 'medical_center';

insert into public.links (name, url, icon_letter, color, sort_order) values
  ('Paynet',                'https://www.paynet.com.tr/', 'P', '#1c6dd0', 5),
  ('Medula',                null,                         'S', '#0f766e', 6),
  ('Digital Vergi Dairesi', null,                         'V', '#9a3412', 7),
  ('E-mail',                null,                         '@', '#475569', 8),
  ('WSA Servis Modülü',     null,                         'W', '#1f7a5a', 9),
  ('Kepkur Mail',           null,                         '@', '#6b21a8', 10);

-- ---------------------------------------------------------------------------
-- 8. Views
-- ---------------------------------------------------------------------------

-- Stock page and the "low stock" suggestion. Batteries: boxes and cartons are whole ones only.
create view public.stock_summary
with (security_invoker = true)
as
select
  p.id                                                       as product_id,
  b.name                                                     as brand_name,
  p.name,
  p.category,
  p.type,
  p.unit,
  p.serial_policy,
  p.sale_price,
  p.min_stock,
  p.active,
  count(u.id) filter (where u.status = 'in_stock')           as in_stock,
  case
    when count(u.id) filter (where u.status = 'in_stock') = 0 then 'out'
    when count(u.id) filter (where u.status = 'in_stock') < p.min_stock then 'low'
    else 'ok'
  end                                                        as stock_level,
  case when p.packs_per_box is not null
       then count(u.id) filter (where u.status = 'in_stock') / p.packs_per_box end                      as boxes,
  case when p.packs_per_box is not null and p.boxes_per_carton is not null
       then count(u.id) filter (where u.status = 'in_stock') / (p.packs_per_box * p.boxes_per_carton) end as cartons,
  case when p.pack_size is not null
       then count(u.id) filter (where u.status = 'in_stock') * p.pack_size end                          as total_batteries
from public.products p
join public.brands b on b.id = p.brand_id
left join public.stock_units u on u.product_id = p.id
group by p.id, b.name;

-- Patient list and card: devices in use, warranty, adaptation (45 days), maintenance and status.
-- Status order: candidate, new (no device), adaptation, maintenance due, warranty expired, active.
create view public.patient_overview
with (security_invoker = true)
as
with today as (
  select (now() at time zone 'Europe/Istanbul')::date as d
),
devices as (
  select
    s.patient_id,
    s.sale_date,
    si.warranty_end,
    coalesce(si.ear_side, su.ear_side)  as ear_side,
    b.name || ' ' || pr.name            as device_name,
    su.serial_no
  from public.sale_items si
  join public.sales s        on s.id = si.sale_id
  join public.stock_units su on su.id = public.sale_item_current_unit(si.id)
  join public.products pr    on pr.id = su.product_id and pr.category = 'device'
  join public.brands b       on b.id = pr.brand_id
  where s.patient_id is not null
    and not exists (select 1 from public.refunds r where r.sale_item_id = si.id and r.returns_device)
),
device_summary as (
  select
    patient_id,
    string_agg(device_name || ' · ' || coalesce(serial_no, 'seri yok'), ', ')
      filter (where ear_side in ('right', 'both'))  as right_device,
    string_agg(device_name || ' · ' || coalesce(serial_no, 'seri yok'), ', ')
      filter (where ear_side in ('left', 'both'))   as left_device,
    string_agg(device_name, ', ')                   as devices,
    max(warranty_end)                               as warranty_end,
    max(sale_date)                                  as last_device_sale
  from devices
  group by patient_id
),
visits as (
  select
    a.patient_id,
    max(a.starts_at) filter (where a.starts_at < now() and a.status <> 'cancelled')        as last_appointment,
    min(a.starts_at) filter (where a.starts_at >= now() and a.status = 'waiting')          as next_appointment,
    max(a.starts_at) filter (where a.status = 'attended' and k.counts_as_maintenance)      as last_maintenance
  from public.appointments a
  join public.appointment_kinds k on k.id = a.kind_id
  group by a.patient_id
),
contacts as (
  select
    patient_id,
    max(contacted_at)                                          as last_contact,
    max(contacted_at) filter (where purpose = 'maintenance')   as last_maintenance_contact
  from public.patient_contacts
  group by patient_id
),
base as (
  select
    p.id                                                     as patient_id,
    p.patient_no,
    p.full_name,
    p.phone,
    p.record_type,
    p.registered_on,
    p.active,
    ds.patient_id is not null                                as has_device,
    ds.right_device,
    ds.left_device,
    ds.devices,
    ds.warranty_end,
    coalesce(p.adaptation_start_manual, ds.last_device_sale) as adaptation_start,
    v.last_appointment,
    v.next_appointment,
    c.last_contact,
    greatest(v.last_maintenance::date, c.last_maintenance_contact::date,
             coalesce(p.adaptation_start_manual, ds.last_device_sale)) as maintenance_reference
  from public.patients p
  left join device_summary ds on ds.patient_id = p.id
  left join visits v          on v.patient_id = p.id
  left join contacts c        on c.patient_id = p.id
)
select
  b.*,
  b.adaptation_start + 45 as adaptation_end,
  case
    when b.record_type = 'candidate' then 'candidate'
    when not b.has_device then 'new'
    when b.adaptation_start + 45 > t.d then 'adaptation'
    when b.maintenance_reference + make_interval(months => st.maintenance_interval_months) <= t.d then 'maintenance_due'
    when b.warranty_end < t.d then 'warranty_expired'
    else 'active'
  end as status
from base b
cross join today t
cross join public.settings st;

-- ---------------------------------------------------------------------------
-- 9. Storage
-- ---------------------------------------------------------------------------

-- Product photos and source icons are public to read (no secrets, cacheable, random file names);
-- only active staff may upload or delete. Backups are private: only the server (secret key) touches them.
-- SVG is left out on purpose: an SVG file can carry scripts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-photos', 'product-photos', true,  2097152,  array['image/webp', 'image/jpeg', 'image/png']),
  ('source-icons',   'source-icons',   true,  524288,   array['image/webp', 'image/png']),
  ('backups',        'backups',        false, 52428800, null)
on conflict (id) do nothing;

drop policy if exists "staff read public images"   on storage.objects;
drop policy if exists "staff upload public images" on storage.objects;
drop policy if exists "staff update public images" on storage.objects;
drop policy if exists "staff delete public images" on storage.objects;

create policy "staff read public images" on storage.objects for select to authenticated
  using (bucket_id in ('product-photos', 'source-icons') and public.is_active_staff());
create policy "staff upload public images" on storage.objects for insert to authenticated
  with check (bucket_id in ('product-photos', 'source-icons') and public.is_active_staff());
create policy "staff update public images" on storage.objects for update to authenticated
  using (bucket_id in ('product-photos', 'source-icons') and public.is_active_staff())
  with check (bucket_id in ('product-photos', 'source-icons') and public.is_active_staff());
create policy "staff delete public images" on storage.objects for delete to authenticated
  using (bucket_id in ('product-photos', 'source-icons') and public.is_active_staff());

-- ---------------------------------------------------------------------------
-- 10. National ID helpers: views become functions
-- ---------------------------------------------------------------------------

-- Supabase's Security Advisor flags views that run with the owner's rights (they skip RLS). These two were
-- filtered and closed to anon, but a function states its permission check on its first line, where it
-- cannot be lost when someone edits a column list later.
drop view public.patient_national_id_presence;
drop view public.patient_national_id_last4;

-- Which of these patients have an ID on file ("TC kayıtlı"); any active staff member, interns included.
create or replace function public.national_id_presence(p_patient_ids bigint[])
returns setof bigint
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select n.patient_id from public.patient_national_ids n where n.patient_id = any (p_patient_ids);
end;
$$;

-- Last four digits for a masked display; only users with the national ID permission.
create or replace function public.national_id_last4(p_patient_ids bigint[])
returns table (patient_id bigint, last4 text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_view_national_ids() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
    select n.patient_id, n.last4 from public.patient_national_ids n where n.patient_id = any (p_patient_ids);
end;
$$;

revoke execute on function public.national_id_presence(bigint[]) from public, anon;
revoke execute on function public.national_id_last4(bigint[]) from public, anon;
revoke execute on function public.undo_price_batch(uuid) from public, anon;
grant execute on function public.national_id_presence(bigint[]) to authenticated;
grant execute on function public.national_id_last4(bigint[]) to authenticated;
grant execute on function public.undo_price_batch(uuid) to authenticated;

revoke all on public.stock_summary, public.patient_overview from anon;

commit;
