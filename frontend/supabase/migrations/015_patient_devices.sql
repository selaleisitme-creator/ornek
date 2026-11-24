-- 015_patient_devices.sql
-- Patient card, "Cihaz ve takip bilgileri" → "Düzenle ve değiştir" (ŞELALE/docs/faz-2-cihaz-takip-plani.md, 2026-11-24):
--   1. add_legacy_device: a device sold before the panel, with its model (an inactive new one if it is not listed),
--      its unit and a legacy sale, in one call.
--   2. replace_device: a warranty or service swap; the new unit comes from the shelf or, when the manufacturer sent it,
--      is registered on the spot. Optionally a new warranty end.
--   3. Grants.
-- 013 and 014 are kept for the appointment and accounting work of the other developers.
-- No new table, so modules/ayarlar/backupRules.js (BACKUP_TABLES) stays as it is.
-- Tests: frontend/supabase/tests/015_patient_devices_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 012_wholesale_price.sql (and 013/014 if they exist by then).

begin;

-- ---------------------------------------------------------------------------
-- 1. Legacy device
-- ---------------------------------------------------------------------------

-- One transaction, so a refused serial number never leaves an empty model or sale behind.
-- Runs with the caller's rights: RLS, the serial number rule (008) and the sale item trigger (003) apply as usual.
--   p_product: {"id": n} for a hearing aid model (active or not), or {"brand_id", "name", "type"} for a model that is not
--              in the list; it is created inactive, so it never shows up in the stock list or the price window.
--   p_unit:    {"serial_no", "ear_side"}. No stock receipt and purchase price 0: the clinic bought it before the panel,
--              so it must not reach the cash ledger.
--   p_sale:    {"sale_date", "warranty_end", "unit_price"}. A legacy sale takes no payments and stays out of the reports
--              and receivables (008).
-- Returns the new sale's id.
create or replace function public.add_legacy_device(p_patient_id bigint, p_product jsonb, p_unit jsonb, p_sale jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today      date := (now() at time zone 'Europe/Istanbul')::date;
  v_patient    record;
  v_product_id bigint;
  v_category   text;
  v_serial     text := nullif(btrim(p_unit ->> 'serial_no'), '');
  v_side       text := nullif(btrim(p_unit ->> 'ear_side'), '');
  v_sale_date  date := nullif(btrim(p_sale ->> 'sale_date'), '')::date;
  v_warranty   date := nullif(btrim(p_sale ->> 'warranty_end'), '')::date;
  v_unit_id    bigint;
  v_sale_id    bigint;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select id, record_type, active into v_patient from public.patients where id = p_patient_id;
  if not found or not v_patient.active then
    raise exception 'Patient % not found', p_patient_id using errcode = 'P0001';
  end if;
  if v_patient.record_type = 'candidate' then
    raise exception 'A candidate cannot get a device; make them a patient first' using errcode = 'P0001';
  end if;

  if v_sale_date is null then
    raise exception 'A legacy device needs its sale date' using errcode = 'P0001';
  end if;
  if v_sale_date > v_today then
    raise exception 'The sale date cannot be in the future' using errcode = 'P0001';
  end if;
  if v_serial is null then
    raise exception 'A legacy device needs a serial number' using errcode = 'P0001';
  end if;
  if v_warranty is not null and v_warranty < v_sale_date then
    raise exception 'The warranty cannot end before the sale date' using errcode = 'P0001';
  end if;

  if p_product ? 'id' then
    select id, category into v_product_id, v_category from public.products where id = (p_product ->> 'id')::bigint;
    if not found then
      raise exception 'Product % not found', p_product ->> 'id' using errcode = 'P0001';
    end if;
    if v_category <> 'device' then
      raise exception 'A legacy device must be a hearing aid model' using errcode = 'P0001';
    end if;
  else
    insert into public.products (brand_id, category, name, type, serial_policy, active)
    values (
      (p_product ->> 'brand_id')::bigint,
      'device',
      regexp_replace(btrim(p_product ->> 'name'), '\s+', ' ', 'g'),
      nullif(btrim(p_product ->> 'type'), ''),
      'required',
      false)
    returning id into v_product_id;
  end if;

  insert into public.stock_units (product_id, serial_no, ear_side, purchase_price)
  values (v_product_id, v_serial, v_side, 0)
  returning id into v_unit_id;

  insert into public.sales (sale_kind, patient_id, sale_date)
  values ('legacy', p_patient_id, v_sale_date)
  returning id into v_sale_id;

  -- The sale item trigger (003) marks the unit sold.
  insert into public.sale_items (sale_id, stock_unit_id, unit_price, ear_side, warranty_start, warranty_end)
  values (v_sale_id, v_unit_id, coalesce((p_sale ->> 'unit_price')::numeric, 0), v_side, v_sale_date, v_warranty);

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Device replacement
-- ---------------------------------------------------------------------------

-- The device_replacements trigger (007) does the stock side: it checks that the replaced unit is the one the patient
-- has now and that the new one is on the shelf, then marks them removed and sold.
--   p_new_unit: {"id": n} for a unit on the shelf, or {"product_id", "serial_no", "ear_side"} for a unit the manufacturer
--               sent: registered here without a receipt and at purchase price 0 (no money changes hands), then handed out.
--   p_warranty_end: a new warranty end for the item, or null to keep it.
-- Returns the replacement's id.
create or replace function public.replace_device(p_sale_item_id bigint, p_new_unit jsonb, p_reason text,
                                                 p_replaced_on date, p_note text, p_warranty_end date default null)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today       date := (now() at time zone 'Europe/Istanbul')::date;
  v_date        date := coalesce(p_replaced_on, (now() at time zone 'Europe/Istanbul')::date);
  v_item        record;
  v_old_unit    bigint;
  v_old_cat     text;
  v_new_unit    bigint;
  v_new_cat     text;
  v_serial      text;
  v_replacement bigint;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('warranty', 'service') then
    raise exception 'Unknown replacement reason %', p_reason using errcode = 'P0001';
  end if;
  if v_date > v_today then
    raise exception 'The replacement date cannot be in the future' using errcode = 'P0001';
  end if;

  select si.id, si.ear_side, coalesce(si.warranty_start, s.sale_date) as warranty_start, s.sale_date into v_item
    from public.sale_items si join public.sales s on s.id = si.sale_id
   where si.id = p_sale_item_id and si.stock_unit_id is not null;
  if not found then
    raise exception 'Sale item % not found', p_sale_item_id using errcode = 'P0001';
  end if;
  if v_date < v_item.sale_date then
    raise exception 'A replacement cannot be dated before the sale' using errcode = 'P0001';
  end if;
  if p_warranty_end is not null and p_warranty_end < v_item.warranty_start then
    raise exception 'The warranty cannot end before it starts' using errcode = 'P0001';
  end if;

  v_old_unit := public.sale_item_current_unit(p_sale_item_id);
  select p.category into v_old_cat from public.stock_units u join public.products p on p.id = u.product_id where u.id = v_old_unit;

  if p_new_unit ? 'id' then
    v_new_unit := (p_new_unit ->> 'id')::bigint;
    select p.category into v_new_cat from public.stock_units u join public.products p on p.id = u.product_id where u.id = v_new_unit;
    if not found then
      raise exception 'Unit % must be in stock to be handed out as a replacement', v_new_unit using errcode = 'P0001';
    end if;
  else
    select category into v_new_cat from public.products where id = (p_new_unit ->> 'product_id')::bigint;
    if not found then
      raise exception 'Product % not found', p_new_unit ->> 'product_id' using errcode = 'P0001';
    end if;
  end if;
  if v_new_cat is distinct from v_old_cat then
    raise exception 'The new unit must be of the same group as the old one' using errcode = 'P0001';
  end if;

  if not (p_new_unit ? 'id') then
    v_serial := nullif(btrim(p_new_unit ->> 'serial_no'), '');
    if v_serial is null then
      raise exception 'A unit from the manufacturer needs a serial number' using errcode = 'P0001';
    end if;
    insert into public.stock_units (product_id, serial_no, ear_side, purchase_price)
    values ((p_new_unit ->> 'product_id')::bigint, v_serial,
            coalesce(nullif(btrim(p_new_unit ->> 'ear_side'), ''), v_item.ear_side), 0)
    returning id into v_new_unit;
  end if;

  insert into public.device_replacements (sale_item_id, old_stock_unit_id, new_stock_unit_id, replaced_on, reason, note)
  values (p_sale_item_id, v_old_unit, v_new_unit, v_date, p_reason, nullif(btrim(p_note), ''))
  returning id into v_replacement;

  if p_warranty_end is not null then
    update public.sale_items set warranty_end = p_warranty_end where id = p_sale_item_id;
  end if;

  return v_replacement;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants (as in 009 and 010: signed-in users only)
-- ---------------------------------------------------------------------------

revoke execute on function public.add_legacy_device(bigint, jsonb, jsonb, jsonb)               from public, anon;
revoke execute on function public.replace_device(bigint, jsonb, text, date, text, date)        from public, anon;
grant execute on function public.add_legacy_device(bigint, jsonb, jsonb, jsonb)                to authenticated;
grant execute on function public.replace_device(bigint, jsonb, text, date, text, date)         to authenticated;

commit;
