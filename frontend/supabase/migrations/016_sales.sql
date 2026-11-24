-- 016_sales.sql
-- Faz 2 sales (ŞELALE/docs/faz-2-satis-plani.md, 2026-11-24):
--   1. Prices include VAT (Şelale Hanım, 2026-11-24). VAT is chosen per item (devices 0, other products 10 or 20), so
--      sale_items gets tax_rate and sale_item_values takes the VAT out of the price instead of adding it on top.
--   2. 'wholesale' sales (to another hearing centre; customer name and phone on the sale).
--   3. create_sale: sale, items, payments, invoices and post-sale site ticks in one call.
--   4. update_sale_followup: ÜTS numbers, warranty dates, invoice numbers and site ticks after the sale.
--   5. create_refund: a refund through the existing refund trigger (007), with its date checked.
--   6. Grants.
-- 013 and 014 are kept for the appointment and accounting work of the other developers; 015 is the device follow-up.
-- No new table, so modules/ayarlar/backupRules.js (BACKUP_TABLES) stays as it is.
-- Tests: frontend/supabase/tests/016_sales_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 015_patient_devices.sql.

begin;

-- Every sale so far has VAT 0, so reading prices as VAT-inclusive changes no amount. Stop if that is not true.
do $$
begin
  if exists (select 1 from public.sales where tax_rate <> 0) then
    raise exception 'A sale already has a VAT rate; its amounts would change. Nothing was changed.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. VAT per item, included in the price
-- ---------------------------------------------------------------------------

alter table public.sale_items add column tax_rate numeric(5, 2) check (tax_rate in (0, 10, 20));

-- Same columns as in 007, plus vat_amount at the end. net_value is now what the patient pays for the item: its price
-- minus its share of the sale discount (the VAT is inside). vat_amount is the VAT inside that, to the kuruş.
create or replace view public.sale_item_values
with (security_invoker = true)
as
with lines as (
  select
    si.id                                                        as sale_item_id,
    si.sale_id,
    s.discount,
    coalesce(si.tax_rate, s.tax_rate)                            as tax_rate,
    si.unit_price * si.quantity                                  as gross,
    sum(si.unit_price * si.quantity) over (partition by si.sale_id) as sale_gross,
    row_number() over (partition by si.sale_id order by si.id desc) as reverse_position
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
),
shares as (
  select
    l.*,
    round(l.discount * l.gross / nullif(l.sale_gross, 0), 2) as rounded_share,
    sum(round(l.discount * l.gross / nullif(l.sale_gross, 0), 2)) over (partition by l.sale_id) as rounded_total
  from lines l
),
final as (
  select
    sale_item_id,
    sale_id,
    gross,
    tax_rate,
    case when reverse_position = 1
         then coalesce(discount - (rounded_total - rounded_share), 0)
         else coalesce(rounded_share, 0) end as discount_share
  from shares
)
select
  sale_item_id,
  sale_id,
  gross,
  discount_share,
  round(gross - discount_share, 2)                                              as net_value,
  round((gross - discount_share) * tax_rate / (100 + tax_rate), 2)              as vat_amount
from final;

-- ---------------------------------------------------------------------------
-- 2. Wholesale sales
-- ---------------------------------------------------------------------------

alter table public.sales drop constraint sales_sale_kind_check;
alter table public.sales add constraint sales_sale_kind_check
  check (sale_kind in ('retail', 'service', 'legacy', 'wholesale'));

-- ---------------------------------------------------------------------------
-- 3. create_sale
-- ---------------------------------------------------------------------------

-- One transaction: if any unit is no longer in stock or a payment exceeds what is owed, nothing is saved.
-- Runs with the caller's rights: RLS and the triggers of 003/007/008 apply (a unit is marked sold when its item is added,
-- payments are checked against the patient share and the SGK amount).
--   p_sale:     {patient_id} or, for "kind": "wholesale", {customer_name, customer_phone}; sale_date (default today, not in
--               the future), discount, sgk_amount (patient sales only), invoice_mode ('single' | 'per_item'), invoice_no
--               (single mode).
--   p_items:    1-200 objects, each one of {stock_unit_id} · {product_id, quantity} (serial-less goods: the oldest units on
--               the shelf) · {service_id, quantity} · {custom_service: {name, category}} (saved as an inactive service), with
--               unit_price, tax_rate (0 for hearing aids; 0, 10 or 20 otherwise), ear_side, mold_type, service_note,
--               uts_report_no, warranty_end and, in per_item mode, invoice_no.
--   p_payments: [{payment_method, amount, installments, paid_on}] paid by the patient (or the wholesale customer).
--   p_tasks:    post-sale sites already done, as system keys: ["uts", "wsa", "kolaysoft", "medical_center"].
-- Returns the new sale's id.
create or replace function public.create_sale(p_sale jsonb, p_items jsonb, p_payments jsonb, p_tasks jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today     date := (now() at time zone 'Europe/Istanbul')::date;
  v_wholesale boolean := coalesce(p_sale ->> 'kind', '') = 'wholesale';
  v_patient   record;
  v_date      date := coalesce(nullif(btrim(p_sale ->> 'sale_date'), '')::date, (now() at time zone 'Europe/Istanbul')::date);
  v_mode      text := coalesce(nullif(p_sale ->> 'invoice_mode', ''), 'single');
  v_sgk       numeric := nullif(p_sale ->> 'sgk_amount', '')::numeric;
  v_sale_id   bigint;
  v_item      record;
  v_units     bigint[];
  v_unit      bigint;
  v_category  text;
  v_service   bigint;
  v_rate      numeric;
  v_qty       integer;
  v_invoice   bigint;
  v_single    bigint;
  v_has_stock boolean := false;
  v_payment   jsonb;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 200 then
    raise exception 'A sale needs between 1 and 200 items' using errcode = 'P0001';
  end if;
  if v_date > v_today then
    raise exception 'The sale date cannot be in the future' using errcode = 'P0001';
  end if;
  if v_mode not in ('single', 'per_item') then
    raise exception 'Unknown invoice mode %', v_mode using errcode = 'P0001';
  end if;

  if v_wholesale then
    if nullif(btrim(p_sale ->> 'customer_name'), '') is null then
      raise exception 'A wholesale sale needs the customer name' using errcode = 'P0001';
    end if;
    if p_sale ? 'patient_id' then
      raise exception 'A wholesale sale is not made to a patient' using errcode = 'P0001';
    end if;
    if coalesce(v_sgk, 0) > 0 then
      raise exception 'A wholesale sale takes no SGK amount' using errcode = 'P0001';
    end if;
  else
    select id, record_type, active into v_patient from public.patients where id = (p_sale ->> 'patient_id')::bigint;
    if not found or not v_patient.active then
      raise exception 'Patient % not found', p_sale ->> 'patient_id' using errcode = 'P0001';
    end if;
  end if;

  insert into public.sales (sale_kind, patient_id, customer_name, customer_phone, sale_date, discount, sgk_amount, invoice_mode)
  values (
    case when v_wholesale then 'wholesale' else 'retail' end,
    case when v_wholesale then null else v_patient.id end,
    case when v_wholesale then regexp_replace(btrim(p_sale ->> 'customer_name'), '\s+', ' ', 'g') end,
    case when v_wholesale then nullif(btrim(p_sale ->> 'customer_phone'), '') end,
    v_date,
    coalesce(nullif(p_sale ->> 'discount', '')::numeric, 0),
    v_sgk,
    v_mode)
  returning id into v_sale_id;

  if v_mode = 'single' and nullif(btrim(p_sale ->> 'invoice_no'), '') is not null then
    insert into public.invoices (sale_id, invoice_no, issued_on)
    values (v_sale_id, btrim(p_sale ->> 'invoice_no'), v_date)
    returning id into v_single;
  end if;

  for v_item in select value as data from jsonb_array_elements(p_items)
  loop
    v_rate := nullif(v_item.data ->> 'tax_rate', '')::numeric;
    if v_rate is null or v_rate not in (0, 10, 20) then
      raise exception 'Unknown tax rate %; use 0, 10 or 20', coalesce(v_rate::text, 'empty') using errcode = 'P0001';
    end if;
    if nullif(v_item.data ->> 'unit_price', '') is null or (v_item.data ->> 'unit_price')::numeric < 0 then
      raise exception 'Every item needs a price of zero or more' using errcode = 'P0001';
    end if;

    v_invoice := v_single;
    if v_mode = 'per_item' and nullif(btrim(v_item.data ->> 'invoice_no'), '') is not null then
      select id into v_invoice from public.invoices where sale_id = v_sale_id and invoice_no = btrim(v_item.data ->> 'invoice_no');
      if not found then
        insert into public.invoices (sale_id, invoice_no, issued_on)
        values (v_sale_id, btrim(v_item.data ->> 'invoice_no'), v_date)
        returning id into v_invoice;
      end if;
    end if;

    v_service := null;
    v_units := null;
    v_qty := greatest(coalesce(nullif(v_item.data ->> 'quantity', '')::integer, 1), 1);

    if v_item.data ? 'stock_unit_id' then
      v_units := array[(v_item.data ->> 'stock_unit_id')::bigint];
    elsif v_item.data ? 'product_id' then
      -- Serial-less goods: the oldest units on the shelf, locked so a parallel sale cannot take the same ones.
      select array_agg(id) into v_units
        from (select id from public.stock_units
               where product_id = (v_item.data ->> 'product_id')::bigint and status = 'in_stock'
               order by created_at, id
               limit v_qty
                 for update) u;
      if coalesce(cardinality(v_units), 0) < v_qty then
        raise exception 'There is not enough stock of product %', v_item.data ->> 'product_id' using errcode = 'P0001';
      end if;
    elsif v_item.data ? 'service_id' then
      v_service := (v_item.data ->> 'service_id')::bigint;
    elsif v_item.data ? 'custom_service' then
      if nullif(btrim(v_item.data #>> '{custom_service,name}'), '') is null then
        raise exception 'A typed-in service needs a name' using errcode = 'P0001';
      end if;
      insert into public.services (category, name, price, active)
      values (coalesce(nullif(v_item.data #>> '{custom_service,category}', ''), 'service'),
              regexp_replace(btrim(v_item.data #>> '{custom_service,name}'), '\s+', ' ', 'g'),
              (v_item.data ->> 'unit_price')::numeric, false)
      returning id into v_service;
    else
      raise exception 'Every item needs a unit, a product, or a service' using errcode = 'P0001';
    end if;

    if v_service is not null then
      if v_wholesale then
        raise exception 'A wholesale sale takes products only, no services' using errcode = 'P0001';
      end if;
      insert into public.sale_items (sale_id, service_id, quantity, unit_price, tax_rate, service_note, invoice_id)
      values (v_sale_id, v_service, v_qty, (v_item.data ->> 'unit_price')::numeric, v_rate,
              nullif(btrim(v_item.data ->> 'service_note'), ''), v_invoice);
    else
      foreach v_unit in array v_units
      loop
        select p.category into v_category from public.stock_units u join public.products p on p.id = u.product_id where u.id = v_unit;
        if v_category = 'device' and v_rate <> 0 then
          raise exception 'A hearing aid is sold with VAT 0' using errcode = 'P0001';
        end if;
        v_has_stock := true;
        -- The sale item trigger (003) marks the unit sold, or refuses it when it is no longer in stock.
        insert into public.sale_items (sale_id, stock_unit_id, unit_price, tax_rate, ear_side, mold_type, uts_report_no,
                                       warranty_start, warranty_end, invoice_id)
        values (v_sale_id, v_unit, (v_item.data ->> 'unit_price')::numeric, v_rate,
                nullif(v_item.data ->> 'ear_side', ''),
                nullif(btrim(v_item.data ->> 'mold_type'), ''),
                nullif(btrim(v_item.data ->> 'uts_report_no'), ''),
                case when nullif(v_item.data ->> 'warranty_end', '') is not null then v_date end,
                nullif(v_item.data ->> 'warranty_end', '')::date,
                v_invoice);
      end loop;
    end if;
  end loop;

  if not v_has_stock and not v_wholesale then
    update public.sales set sale_kind = 'service' where id = v_sale_id;
  end if;
  if (select discount from public.sales where id = v_sale_id)
     > (select coalesce(sum(unit_price * quantity), 0) from public.sale_items where sale_id = v_sale_id) then
    raise exception 'The discount cannot be more than the total' using errcode = 'P0001';
  end if;
  if coalesce(v_sgk, 0) > public.sale_total(v_sale_id) then
    raise exception 'The SGK amount cannot be more than the sale total' using errcode = 'P0001';
  end if;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb))
  loop
    if coalesce(nullif(v_payment ->> 'paid_on', '')::date, v_date) > v_today then
      raise exception 'A payment date cannot be in the future' using errcode = 'P0001';
    end if;
    -- sale_payments_guard (008) refuses a payment above the patient share.
    insert into public.sale_payments (sale_id, payment_method, amount, installments, paid_on, payer)
    values (v_sale_id, v_payment ->> 'payment_method', (v_payment ->> 'amount')::numeric,
            nullif(v_payment ->> 'installments', '')::integer,
            coalesce(nullif(v_payment ->> 'paid_on', '')::date, v_date), 'patient');
  end loop;

  insert into public.sale_tasks (sale_id, link_id)
  select v_sale_id, l.id from public.links l
   where l.system_key in (select jsonb_array_elements_text(coalesce(p_tasks, '[]'::jsonb)));

  if not v_wholesale and v_patient.record_type = 'candidate' then
    update public.patients set record_type = 'patient' where id = v_patient.id;
  end if;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. update_sale_followup
-- ---------------------------------------------------------------------------

-- What the post-sale sites gave back, filled in after the sale (patient history, "Site işlemleri").
--   p_items:      [{sale_item_id, uts_report_no, warranty_start, warranty_end, invoice_no}]; a missing key leaves the value.
--   p_invoice_no: the sale's single invoice number (single mode); null leaves it.
--   p_tasks:      {"uts": true, "kolaysoft": false, ...}: true ticks the site, false unticks it, a missing key leaves it.
create or replace function public.update_sale_followup(p_sale_id bigint, p_items jsonb, p_invoice_no text, p_tasks jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale    record;
  v_row     jsonb;
  v_item_id bigint;
  v_invoice bigint;
  v_key     text;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select id, sale_kind, sale_date, invoice_mode into v_sale from public.sales where id = p_sale_id for update;
  if not found or v_sale.sale_kind = 'legacy' then
    raise exception 'Sale % not found', p_sale_id using errcode = 'P0001';
  end if;

  if nullif(btrim(p_invoice_no), '') is not null then
    select id into v_invoice from public.invoices where sale_id = p_sale_id order by id limit 1;
    if found then
      update public.invoices set invoice_no = btrim(p_invoice_no) where id = v_invoice;
    else
      insert into public.invoices (sale_id, invoice_no, issued_on) values (p_sale_id, btrim(p_invoice_no), v_sale.sale_date)
      returning id into v_invoice;
    end if;
    update public.sale_items set invoice_id = v_invoice where sale_id = p_sale_id and invoice_id is distinct from v_invoice;
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_item_id := (v_row ->> 'sale_item_id')::bigint;
    if not exists (select 1 from public.sale_items where id = v_item_id and sale_id = p_sale_id) then
      raise exception 'Sale item % is not part of sale %', v_item_id, p_sale_id using errcode = 'P0001';
    end if;
    update public.sale_items set
      uts_report_no  = case when v_row ? 'uts_report_no' then nullif(btrim(v_row ->> 'uts_report_no'), '') else uts_report_no end,
      warranty_start = case when v_row ? 'warranty_start' then nullif(v_row ->> 'warranty_start', '')::date else warranty_start end,
      warranty_end   = case when v_row ? 'warranty_end' then nullif(v_row ->> 'warranty_end', '')::date else warranty_end end
     where id = v_item_id;

    if v_sale.invoice_mode = 'per_item' and nullif(btrim(v_row ->> 'invoice_no'), '') is not null then
      select id into v_invoice from public.invoices where sale_id = p_sale_id and invoice_no = btrim(v_row ->> 'invoice_no');
      if not found then
        insert into public.invoices (sale_id, invoice_no, issued_on)
        values (p_sale_id, btrim(v_row ->> 'invoice_no'), v_sale.sale_date)
        returning id into v_invoice;
      end if;
      update public.sale_items set invoice_id = v_invoice where id = v_item_id;
    end if;
  end loop;

  for v_key in select jsonb_object_keys(coalesce(p_tasks, '{}'::jsonb))
  loop
    if (p_tasks ->> v_key)::boolean then
      insert into public.sale_tasks (sale_id, link_id)
      select p_sale_id, id from public.links where system_key = v_key
      on conflict (sale_id, link_id) do nothing;
    else
      delete from public.sale_tasks
       where sale_id = p_sale_id and link_id in (select id from public.links where system_key = v_key);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_refund
-- ---------------------------------------------------------------------------

-- The refund trigger (007) checks the amount against the item's value and puts the device back on the shelf.
-- Returns the refund's id.
create or replace function public.create_refund(p_sale_item_id bigint, p_amount numeric, p_payment_method text, p_reason text,
                                                p_returns_device boolean, p_refunded_on date)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_date  date := coalesce(p_refunded_on, (now() at time zone 'Europe/Istanbul')::date);
  v_sale  record;
  v_id    bigint;
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select s.sale_kind, s.sale_date into v_sale
    from public.sale_items si join public.sales s on s.id = si.sale_id where si.id = p_sale_item_id;
  if not found then
    raise exception 'Sale item % not found', p_sale_item_id using errcode = 'P0001';
  end if;
  if v_sale.sale_kind = 'legacy' then
    raise exception 'A sale from before the panel cannot be refunded' using errcode = 'P0001';
  end if;
  if v_date > v_today then
    raise exception 'The refund date cannot be in the future' using errcode = 'P0001';
  end if;
  if v_date < v_sale.sale_date then
    raise exception 'A refund cannot be dated before the sale' using errcode = 'P0001';
  end if;

  insert into public.refunds (sale_item_id, refunded_on, amount, payment_method, reason, returns_device)
  values (p_sale_item_id, v_date, p_amount, p_payment_method, nullif(btrim(p_reason), ''), coalesce(p_returns_device, true))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants (as in 009 and 010: signed-in users only)
-- ---------------------------------------------------------------------------

revoke execute on function public.create_sale(jsonb, jsonb, jsonb, jsonb)                          from public, anon;
revoke execute on function public.update_sale_followup(bigint, jsonb, text, jsonb)                 from public, anon;
revoke execute on function public.create_refund(bigint, numeric, text, text, boolean, date)        from public, anon;
grant execute on function public.create_sale(jsonb, jsonb, jsonb, jsonb)                           to authenticated;
grant execute on function public.update_sale_followup(bigint, jsonb, text, jsonb)                  to authenticated;
grant execute on function public.create_refund(bigint, numeric, text, text, boolean, date)         to authenticated;
revoke all on public.sale_item_values from anon;

commit;
