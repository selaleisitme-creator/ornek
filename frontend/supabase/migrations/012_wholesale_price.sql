-- 012_wholesale_price.sql
-- Wholesale price on stock models (2026-11-24 decision; reverses Faz 1 decision 4 for the price itself).
-- The wholesale sale ("Toptan satış") comes with the sale wizard in Faz 2; this file only stores and updates the price.
--   1. products.wholesale_price: empty until someone enters it (existing models have none).
--   2. price_changes logs wholesale price changes too ('wholesale').
--   3. The product price trigger and undo_price_batch handle the new field.
--   4. create_stock_receipt stores the wholesale price of a new model.
--   5. update_prices_bulk gets p_field ('sale' | 'wholesale'); without it the sale price changes, as before.
--   6. stock_summary shows the wholesale price (new last column).
--   7. Grants.
-- Tests: frontend/supabase/tests/012_wholesale_price_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 011_home_summaries.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------

alter table public.products
  add column wholesale_price numeric(12, 2) check (wholesale_price >= 0);

-- ---------------------------------------------------------------------------
-- 2 + 3. Price history and undo
-- ---------------------------------------------------------------------------

alter table public.price_changes drop constraint price_changes_price_field_check;
alter table public.price_changes add constraint price_changes_price_field_check
  check (price_field in ('sale', 'purchase', 'wholesale'));

-- Copied from 008 with the wholesale branch added. An empty old or new price is logged as 0: the column is
-- not null, and "no price" and "0" mean the same thing to the person reading the history.
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
  if new.wholesale_price is distinct from old.wholesale_price then
    insert into public.price_changes (product_id, price_field, old_price, new_price, changed_by, batch_id)
    values (new.id, 'wholesale', coalesce(old.wholesale_price, 0), coalesce(new.wholesale_price, 0), auth.uid(),
            public.current_price_batch());
  end if;
  return new;
end;
$$;

-- The trigger also fires on the new column.
drop trigger products_price_change on public.products;
create trigger products_price_change
after update of sale_price, purchase_price, wholesale_price on public.products
for each row execute function public.log_product_price_change();

-- Copied from 008 with the wholesale branch added. A logged 0 for an empty wholesale price is matched as empty,
-- so undoing the first wholesale price of a model empties it again.
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
    elsif change.product_id is not null and change.price_field = 'wholesale' then
      update public.products set wholesale_price = nullif(change.old_price, 0)
       where id = change.product_id and coalesce(wholesale_price, 0) = change.new_price;
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
-- 4. Stock entry: copied from 010; a new model also takes "wholesale_price"
-- ---------------------------------------------------------------------------

create or replace function public.create_stock_receipt(p_product jsonb, p_receipt jsonb, p_units jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product_id bigint;
  v_receipt_id bigint;
  v_opening    boolean := coalesce((p_receipt ->> 'opening')::boolean, false);
  v_mode       text    := coalesce(nullif(btrim(p_receipt ->> 'price_mode'), ''), 'unit');
  v_amount     numeric := (p_receipt ->> 'amount')::numeric;
  v_count      integer;
  v_base       numeric;
  v_price      numeric;
  v_unit       record;
  v_unit_id    bigint;
  v_unit_ids   bigint[] := '{}';
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if p_units is null or jsonb_typeof(p_units) <> 'array'
     or jsonb_array_length(p_units) not between 1 and 500 then
    raise exception 'A stock entry needs between 1 and 500 units' using errcode = 'P0001';
  end if;
  v_count := jsonb_array_length(p_units);

  if v_mode not in ('unit', 'total') then
    raise exception 'Unknown price mode %', v_mode using errcode = 'P0001';
  end if;
  if not v_opening then
    if nullif(btrim(p_receipt ->> 'payment_method'), '') is null then
      raise exception 'A purchase needs a payment method' using errcode = 'P0001';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'A purchase needs an amount above zero' using errcode = 'P0001';
    end if;
  elsif v_amount is not null and v_amount < 0 then
    raise exception 'The amount cannot be negative' using errcode = 'P0001';
  end if;

  if p_product ? 'id' then
    select id into v_product_id from public.products
     where id = (p_product ->> 'id')::bigint and active;
    if not found then
      raise exception 'Product % not found or inactive', p_product ->> 'id' using errcode = 'P0001';
    end if;
  else
    -- Missing keys fall back to the column defaults; blank text is stored as null.
    insert into public.products (
      brand_id, category, name, type, gtin, package_barcode, manufacturer_ref, unit, pack_size, packs_per_box,
      boxes_per_carton, sale_price, purchase_price, wholesale_price, warranty_months, min_stock, serial_policy)
    values (
      (p_product ->> 'brand_id')::bigint,
      p_product ->> 'category',
      btrim(p_product ->> 'name'),
      nullif(btrim(p_product ->> 'type'), ''),
      nullif(btrim(p_product ->> 'gtin'), ''),
      nullif(btrim(p_product ->> 'package_barcode'), ''),
      nullif(btrim(p_product ->> 'manufacturer_ref'), ''),
      coalesce(nullif(p_product ->> 'unit', ''), 'piece'),
      (p_product ->> 'pack_size')::integer,
      (p_product ->> 'packs_per_box')::integer,
      (p_product ->> 'boxes_per_carton')::integer,
      coalesce((p_product ->> 'sale_price')::numeric, 0),
      coalesce((p_product ->> 'purchase_price')::numeric, 0),
      (p_product ->> 'wholesale_price')::numeric,
      coalesce((p_product ->> 'warranty_months')::integer, 0),
      coalesce((p_product ->> 'min_stock')::integer, 0),
      coalesce(nullif(p_product ->> 'serial_policy', ''), 'required'))
    returning id into v_product_id;
  end if;

  if not v_opening then
    insert into public.stock_receipts (supplier_id, received_on, invoice_no, payment_method, note)
    values (
      (p_receipt ->> 'supplier_id')::bigint,
      coalesce((p_receipt ->> 'received_on')::date, (now() at time zone 'Europe/Istanbul')::date),
      nullif(btrim(p_receipt ->> 'invoice_no'), ''),
      p_receipt ->> 'payment_method',
      nullif(btrim(p_receipt ->> 'note'), ''))
    returning id into v_receipt_id;
  end if;

  -- The cash ledger adds the units up one by one, so a total is split to the cent and the rounding
  -- difference goes to the last unit: 30000 over 7 units is six 4285.71 and one 4285.74.
  if v_mode = 'total' and coalesce(v_amount, 0) > 0 then
    v_base := round(v_amount / v_count, 2);
  end if;

  for v_unit in
    select u.value as data, u.ordinality as n from jsonb_array_elements(p_units) with ordinality u
  loop
    if coalesce(v_amount, 0) = 0 then
      v_price := null;  -- opening stock without a price: the insert trigger (005) copies the product's purchase price
    elsif v_mode = 'unit' then
      v_price := v_amount;
    elsif v_unit.n < v_count then
      v_price := v_base;
    else
      v_price := v_amount - v_base * (v_count - 1);
    end if;

    insert into public.stock_units (product_id, receipt_id, serial_no, ear_side, production_date, wsa_code, purchase_price)
    values (
      v_product_id,
      v_receipt_id,
      nullif(btrim(v_unit.data ->> 'serial_no'), ''),
      nullif(btrim(v_unit.data ->> 'ear_side'), ''),
      nullif(btrim(v_unit.data ->> 'production_date'), '')::date,
      nullif(btrim(v_unit.data ->> 'wsa_code'), ''),
      v_price)
    returning id into v_unit_id;
    v_unit_ids := v_unit_ids || v_unit_id;
  end loop;

  return jsonb_build_object('product_id', v_product_id, 'receipt_id', v_receipt_id, 'unit_ids', to_jsonb(v_unit_ids));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Bulk price update: sale or wholesale price
-- ---------------------------------------------------------------------------

-- The argument list changes, so the old function is dropped (a second one with five arguments would make
-- calls with four ambiguous). Same rules as in 010, on the chosen price:
--   p_mode 'set': the new price is p_value; 'percent': +/- p_value %; 'amount': +/- p_value TL.
--   p_round_to 0: to the cent; 1, 10, 100: to the nearest whole, ten or hundred TL (percent and amount only).
--   p_field 'sale' (default) or 'wholesale'. A percent or amount change needs an existing wholesale price on every
--   chosen model; "set" also gives one to a model that has none.
drop function public.update_prices_bulk(bigint[], text, numeric, numeric);

create function public.update_prices_bulk(p_product_ids bigint[], p_mode text, p_value numeric,
                                          p_round_to numeric default 0, p_field text default 'sale')
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_ids   bigint[];
  v_row   record;
  v_old   numeric;
  v_price numeric;
  v_new   jsonb := '{}';
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select array_agg(distinct id) into v_ids from unnest(p_product_ids) id where id is not null;
  if v_ids is null then
    raise exception 'There are no products to update' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('set', 'percent', 'amount') then
    raise exception 'Unknown price mode %', p_mode using errcode = 'P0001';
  end if;
  if p_field is null or p_field not in ('sale', 'wholesale') then
    raise exception 'Unknown price field %', p_field using errcode = 'P0001';
  end if;
  if p_value is null then
    raise exception 'A price change needs a value' using errcode = 'P0001';
  end if;
  if p_round_to is null or p_round_to not in (0, 1, 10, 100) then
    raise exception 'Prices can only be rounded to 0, 1, 10 or 100' using errcode = 'P0001';
  end if;

  -- Locked so a parallel edit cannot slip in between computing and writing the new prices.
  for v_row in
    select id, sale_price, wholesale_price from public.products where id = any (v_ids) order by id for update
  loop
    v_old := case p_field when 'sale' then v_row.sale_price else v_row.wholesale_price end;
    if v_old is null and p_mode <> 'set' then
      raise exception 'A chosen model has no wholesale price; enter it on the model first' using errcode = 'P0001';
    end if;
    v_price := case p_mode
                 when 'set'     then p_value
                 when 'percent' then v_old * (1 + p_value / 100)
                 else                v_old + p_value
               end;
    v_price := case when p_mode = 'set' or p_round_to = 0 then round(v_price, 2)
                    else round(v_price / p_round_to) * p_round_to end;
    if v_price <= 0 then
      raise exception 'A new price would be zero or less; no price was changed' using errcode = 'P0001';
    end if;
    if v_price is distinct from v_old then
      v_new := v_new || jsonb_build_object(v_row.id::text, v_price);
    end if;
  end loop;

  if (select count(*) from public.products where id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Some products were not found' using errcode = 'P0001';
  end if;
  if v_new = '{}'::jsonb then
    return null;
  end if;

  perform set_config('app.price_batch', v_batch::text, true);
  if p_field = 'sale' then
    update public.products p set sale_price = (v_new ->> p.id::text)::numeric
     where p.id in (select k::bigint from jsonb_object_keys(v_new) k);
  else
    update public.products p set wholesale_price = (v_new ->> p.id::text)::numeric
     where p.id in (select k::bigint from jsonb_object_keys(v_new) k);
  end if;
  perform set_config('app.price_batch', '', true);

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Stock summary: copied from 010, wholesale_price added as the last column
-- ---------------------------------------------------------------------------

create or replace view public.stock_summary
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
    when count(u.id) filter (where u.status = 'in_stock') <= p.min_stock then 'low'
    else 'ok'
  end                                                        as stock_level,
  case when p.packs_per_box is not null
       then count(u.id) filter (where u.status = 'in_stock') / p.packs_per_box end                      as boxes,
  case when p.packs_per_box is not null and p.boxes_per_carton is not null
       then count(u.id) filter (where u.status = 'in_stock') / (p.packs_per_box * p.boxes_per_carton) end as cartons,
  case when p.pack_size is not null
       then count(u.id) filter (where u.status = 'in_stock') * p.pack_size end                          as total_batteries,
  p.wholesale_price
from public.products p
join public.brands b on b.id = p.brand_id
left join public.stock_units u on u.product_id = p.id
group by p.id, b.name;

-- ---------------------------------------------------------------------------
-- 7. Grants (as in 009 and 010: signed-in users only)
-- ---------------------------------------------------------------------------

revoke execute on function public.update_prices_bulk(bigint[], text, numeric, numeric, text) from public, anon;
grant execute on function public.update_prices_bulk(bigint[], text, numeric, numeric, text) to authenticated;
revoke execute on function public.log_product_price_change() from public, anon, authenticated;

commit;
