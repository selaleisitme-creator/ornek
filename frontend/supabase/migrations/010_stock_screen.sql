-- 010_stock_screen.sql
-- Faz 1 (Stok) database work (ŞELALE/docs/faz-1-stok-plani.md, section 6):
--   1. R37 stock_removals: why a unit left the stock.
--   2. create_stock_receipt: product (new or existing), receipt and units in one all-or-nothing call.
--   3. update_prices_bulk: one sale price change for many products, undoable as one batch.
--   4. remove_stock_units: units leave the stock with a reason; the rows stay.
--   5. stock_summary: "low" starts at the minimum, not below it.
--   6. ledger_entries: units removed as an entry error are not a purchase expense.
--   7. Staff may delete product photo rows.
--   8. Service price list from the design (18 items).
--   9. Grants.
-- Tests: frontend/supabase/tests/010_stock_screen_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 009_hardening.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. R37 Stock removals
-- ---------------------------------------------------------------------------

-- A separate table, not a column on stock_units: a warranty replacement also sets a unit to 'removed', but its
-- record lives in device_replacements. One unit leaves the stock at most once, so the unit id is the key.
create table public.stock_removals (
  stock_unit_id bigint primary key references public.stock_units (id),
  reason        text not null check (reason in ('entry_error', 'damaged_lost', 'returned_to_supplier', 'other')),
  note          text,
  removed_at    timestamptz not null default now(),
  removed_by    uuid not null default auth.uid() references public.profiles (id)
);

-- No update or delete policy: the reason is part of the stock history (and decides the cash ledger).
alter table public.stock_removals enable row level security;
create policy "staff read stock removals" on public.stock_removals for select to authenticated using (public.is_active_staff());
create policy "staff add stock removals"  on public.stock_removals for insert to authenticated with check (public.is_active_staff());

-- ---------------------------------------------------------------------------
-- 2. Stock entry
-- ---------------------------------------------------------------------------

-- One call, one transaction: a new product, its receipt and its units are created together, so a refused
-- unit (missing or duplicate serial number) never leaves an empty product or receipt behind.
-- Runs with the caller's rights: the RLS rules and the serial number trigger apply as usual.
--   p_product: {"id": n} for an existing active product, or the new product's columns.
--   p_receipt: opening, supplier_id, received_on, invoice_no, payment_method, note, price_mode ('unit' | 'total'), amount.
--              Opening stock (bought before the panel) gets no stock_receipts row, so it never reaches the cash ledger.
--   p_units:   1-500 objects {serial_no, ear_side, production_date, wsa_code}.
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
      boxes_per_carton, sale_price, purchase_price, warranty_months, min_stock, serial_policy)
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
-- 3. Bulk sale price update
-- ---------------------------------------------------------------------------

-- Sale price only (Faz 1 decision 4): the purchase price is written with every stock entry.
--   p_mode 'set': the new price is p_value; 'percent': +/- p_value %; 'amount': +/- p_value TL.
--   p_round_to 0: to the cent; 1, 10, 100: to the nearest whole, ten or hundred TL (percent and amount only).
-- Every new price is computed before any is written, so one result of zero or less changes nothing.
-- The price trigger logs each change with this call's batch id; undo_price_batch (008) puts them all back.
-- Returns the batch id, or null when no price would change (there would be nothing to undo).
create or replace function public.update_prices_bulk(p_product_ids bigint[], p_mode text, p_value numeric,
                                                     p_round_to numeric default 0)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_ids   bigint[];
  v_row   record;
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
  if p_value is null then
    raise exception 'A price change needs a value' using errcode = 'P0001';
  end if;
  if p_round_to is null or p_round_to not in (0, 1, 10, 100) then
    raise exception 'Prices can only be rounded to 0, 1, 10 or 100' using errcode = 'P0001';
  end if;

  -- Locked so a parallel edit cannot slip in between computing and writing the new prices.
  for v_row in
    select id, sale_price from public.products where id = any (v_ids) order by id for update
  loop
    v_price := case p_mode
                 when 'set'     then p_value
                 when 'percent' then v_row.sale_price * (1 + p_value / 100)
                 else                v_row.sale_price + p_value
               end;
    v_price := case when p_mode = 'set' or p_round_to = 0 then round(v_price, 2)
                    else round(v_price / p_round_to) * p_round_to end;
    if v_price <= 0 then
      raise exception 'A new price would be zero or less; no price was changed' using errcode = 'P0001';
    end if;
    if v_price <> v_row.sale_price then
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
  update public.products p set sale_price = (v_new ->> p.id::text)::numeric
   where p.id in (select k::bigint from jsonb_object_keys(v_new) k);
  perform set_config('app.price_batch', '', true);

  return v_batch;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Removing stock units
-- ---------------------------------------------------------------------------

-- The units stay (sales and the ledger may point at them); only their status changes and the reason is kept.
-- All or nothing: if any unit is missing or no longer in stock, none is removed.
create or replace function public.remove_stock_units(p_unit_ids bigint[], p_reason text, p_note text default null)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ids    bigint[];
  v_locked integer;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select array_agg(distinct id) into v_ids from unnest(p_unit_ids) id where id is not null;
  if v_ids is null then
    raise exception 'There are no units to remove' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('entry_error', 'damaged_lost', 'returned_to_supplier', 'other') then
    raise exception 'Unknown removal reason %', p_reason using errcode = 'P0001';
  end if;

  -- Locked so a sale cannot take one of these units while they are being removed.
  select count(*) into v_locked
    from (select id from public.stock_units
           where id = any (v_ids) and status = 'in_stock'
           order by id
             for update) u;
  if v_locked <> cardinality(v_ids) then
    raise exception 'Some units are not in stock; nothing was removed' using errcode = 'P0001';
  end if;

  update public.stock_units set status = 'removed' where id = any (v_ids);
  insert into public.stock_removals (stock_unit_id, reason, note)
  select id, p_reason, nullif(btrim(p_note), '') from unnest(v_ids) id;

  return cardinality(v_ids);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stock summary: "low" starts at the minimum
-- ---------------------------------------------------------------------------

-- Same columns as in 008; only the threshold changes (ekran-plani.md section 2, item 15). "out" still wins.
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
       then count(u.id) filter (where u.status = 'in_stock') * p.pack_size end                          as total_batteries
from public.products p
join public.brands b on b.id = p.brand_id
left join public.stock_units u on u.product_id = p.id
group by p.id, b.name;

-- ---------------------------------------------------------------------------
-- 6. Cash ledger: entry errors are not purchases
-- ---------------------------------------------------------------------------

-- Copied from 007 unchanged except one condition in the stock purchases branch. Same columns, names and types,
-- so ledger_monthly and ledger_payment_totals keep working on top of it.
create or replace view public.ledger_entries
with (security_invoker = true)
as
with sale_details as (
  select
    si.sale_id,
    string_agg(b.name || ' ' || pr.name, ', ' order by si.id) filter (where pr.id is not null) as devices,
    string_agg(su.serial_no, ', ' order by si.id) filter (where su.serial_no is not null)       as serials,
    string_agg(si.mold_type, ', ' order by si.id) filter (where si.mold_type is not null)       as molds,
    string_agg(distinct case when si.service_id is not null then sv.name
                             when pr.category = 'device' then 'Cihaz satışı'
                             else 'Ürün satışı' end, ', ')                                       as operations
  from public.sale_items si
  left join public.stock_units su on su.id = si.stock_unit_id
  left join public.products pr    on pr.id = su.product_id
  left join public.brands b       on b.id = pr.brand_id
  left join public.services sv    on sv.id = si.service_id
  group by si.sale_id
),
ledger_rows as (
  -- 1) Payments: income on the payment date
  select
    'sale_payment'::text                      as source,
    sp.id                                     as source_id,
    1                                         as source_order,
    sp.paid_on                                as entry_date,
    'income'::text                            as direction,
    coalesce(pt.full_name, s.customer_name)   as full_name,
    coalesce(pt.phone, s.customer_phone)      as phone,
    sd.devices                                as device,
    sd.serials                                as serial_no,
    sd.molds                                  as mold_type,
    sd.operations                             as operation,
    null::text                                as expense_type,
    sp.amount,
    pm.ledger_label                           as payment_label,
    case sp.payer when 'sgk' then 'SGK ödemesi · ' || s.sale_no else s.sale_no end as description
  from public.sale_payments sp
  join public.sales s            on s.id = sp.sale_id
  join public.payment_methods pm on pm.code = sp.payment_method
  left join public.patients pt   on pt.id = s.patient_id
  left join sale_details sd      on sd.sale_id = s.id

  union all

  -- 2) Refunds: expense on the refund date
  select
    'refund', r.id, 2, r.refunded_on, 'expense',
    coalesce(pt.full_name, s.customer_name),
    coalesce(pt.phone, s.customer_phone),
    b.name || ' ' || pr.name,
    su.serial_no,
    null,
    'İade',
    'İade',
    r.amount,
    pm.ledger_label,
    r.reason
  from public.refunds r
  join public.sale_items si       on si.id = r.sale_item_id
  join public.sales s             on s.id = si.sale_id
  join public.payment_methods pm  on pm.code = r.payment_method
  left join public.patients pt    on pt.id = s.patient_id
  left join public.stock_units su on su.id = si.stock_unit_id
  left join public.products pr    on pr.id = su.product_id
  left join public.brands b       on b.id = pr.brand_id

  union all

  -- 3) Stock purchases: expense on the receipt date, one row per unit
  select
    'stock_unit', su.id, 3, sr.received_on, 'expense',
    sup.name,
    null,
    b.name || ' ' || pr.name,
    su.serial_no,
    null,
    null,
    'Stok alışı',
    su.purchase_price,
    pm.ledger_label,
    sr.note
  from public.stock_units su
  join public.stock_receipts sr  on sr.id = su.receipt_id
  join public.products pr        on pr.id = su.product_id
  join public.brands b           on b.id = pr.brand_id
  join public.payment_methods pm on pm.code = sr.payment_method
  left join public.suppliers sup on sup.id = sr.supplier_id
  where su.purchase_price > 0
    -- A unit entered by mistake was never paid for (Faz 1 decision 2); damaged or returned units stay.
    and not exists (select 1 from public.stock_removals rm
                     where rm.stock_unit_id = su.id and rm.reason = 'entry_error')

  union all

  -- 4) Manual cash entries
  select
    'cash_entry', ce.id, 4, ce.entry_date, ce.direction,
    ce.counterparty_name,
    null,
    null,
    null,
    null,
    null,
    ec.name,
    ce.amount,
    pm.ledger_label,
    ce.description
  from public.cash_entries ce
  join public.payment_methods pm         on pm.code = ce.payment_method
  left join public.expense_categories ec on ec.id = ce.expense_category_id
)
select
  source,
  source_id,
  date_trunc('month', entry_date)::date                     as month,
  case direction when 'income' then 'GELİR' else 'GİDER' end as income_expense,
  full_name,
  phone,
  device,
  serial_no,
  mold_type,
  operation,
  expense_type,
  amount,
  payment_label,
  entry_date,
  sum(case direction when 'income' then amount else -amount end) over (
    partition by date_trunc('month', entry_date)
    order by entry_date, source_order, source_id
    rows between unbounded preceding and current row
  )                                                          as running_total,
  description
from ledger_rows
where public.is_accounting_staff();

-- ---------------------------------------------------------------------------
-- 7. Product photos may be deleted
-- ---------------------------------------------------------------------------

-- The one exception to "no delete policies" (001): a photo is not a financial or stock record, and when the
-- file is deleted from Storage its row must go too, or the product would show a broken image.
create policy "staff delete product photos" on public.product_photos
  for delete to authenticated using (public.is_active_staff());

-- ---------------------------------------------------------------------------
-- 8. Service price list (VAT included; Şelale Hanım checks and corrects them on the screen)
-- ---------------------------------------------------------------------------

insert into public.services (category, name, price) values
  ('service',        'Kalıp ücreti',                                 2000),
  ('service',        'Kalıp montaj',                                 4000),
  ('service',        'Receiver',                                     6000),
  ('service',        'Receiver Montaj',                              4000),
  ('service',        'Cihaz Bakım',                                  2500),
  ('service',        'Cihaz Tamir',                                  3500),
  ('service',        'Teknik Servis',                                2500),
  ('service',        'Hoparlör Değişimi',                            6000),
  ('service',        'Mikrofon Değişimi',                            6000),
  ('service',        'Pil Ölçer',                                    1000),
  ('service',        'Filtre',                                       1000),
  ('service',        'Boynuz',                                       2000),
  ('service',        'Pil kapağı',                                   2000),
  ('audiology_exam', 'Cihaz Programlama',                            4000),
  ('audiology_exam', 'İşitme Testi',                                 5000),
  ('audiology_exam', 'Odyolojik Muayene',                           15000),
  ('audiology_exam', 'REM (Gerçek Kulak Ölçümü)',                   15000),
  ('audiology_exam', 'Evde Hizmet Bedeli (Mücbir sebep dahilinde)', 15000);

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------

revoke execute on function public.create_stock_receipt(jsonb, jsonb, jsonb)             from public, anon;
revoke execute on function public.update_prices_bulk(bigint[], text, numeric, numeric) from public, anon;
revoke execute on function public.remove_stock_units(bigint[], text, text)             from public, anon;
grant execute on function public.create_stock_receipt(jsonb, jsonb, jsonb)             to authenticated;
grant execute on function public.update_prices_bulk(bigint[], text, numeric, numeric) to authenticated;
grant execute on function public.remove_stock_units(bigint[], text, text)             to authenticated;

revoke all on public.stock_removals from anon;

commit;
