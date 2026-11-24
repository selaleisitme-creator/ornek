-- 017: wholesale sales could not be saved.
-- create_sale (016) kept the patient in a record variable that a wholesale sale never fills. PL/pgSQL evaluates every
-- variable a statement mentions before running it, even inside a CASE branch that is not taken, so the INSERT into sales
-- failed with 55000 "record v_patient is not assigned yet". The patient now lives in plain variables, which are simply
-- null for a wholesale sale. Nothing else changes; the signature and grants stay as in 016.
begin;

create or replace function public.create_sale(p_sale jsonb, p_items jsonb, p_payments jsonb, p_tasks jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_today     date := (now() at time zone 'Europe/Istanbul')::date;
  v_wholesale boolean := coalesce(p_sale ->> 'kind', '') = 'wholesale';
  v_patient_id  bigint;      -- null for a wholesale sale
  v_record    text;
  v_active    boolean;
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
    select id, record_type, active into v_patient_id, v_record, v_active from public.patients where id = (p_sale ->> 'patient_id')::bigint;
    if not found or not v_active then
      raise exception 'Patient % not found', p_sale ->> 'patient_id' using errcode = 'P0001';
    end if;
  end if;

  insert into public.sales (sale_kind, patient_id, customer_name, customer_phone, sale_date, discount, sgk_amount, invoice_mode)
  values (
    case when v_wholesale then 'wholesale' else 'retail' end,
    v_patient_id,
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

  if v_record = 'candidate' then
    update public.patients set record_type = 'patient' where id = v_patient_id;
  end if;

  return v_sale_id;
end;
$$;

commit;
