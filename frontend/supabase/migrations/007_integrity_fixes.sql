-- 007_integrity_fixes.sql
-- Fixes found in an external review of 001-006 (2026-11-06) and the payment rules confirmed by the clinic owner:
--   1. A device replacement may only hand out a unit from the shelf (not one sold to another patient).
--   2. A refund returns the unit the patient actually has (after replacements), and only when the device comes back.
--   3. Replacement and refund lock the sale item, so two requests at the same moment cannot both pass the checks.
--   4. A unit's purchase price is locked; only an admin can correct it, and the correction is logged.
--   5. National IDs are read and written only through functions; every full read is logged in the same step.
--   6. Anonymous visitors get no access to the new views and functions.
--   7. SGK money is a payment row (payer = 'sgk'); its status is derived instead of stored.
--   8. Reports are separated: sales report (on the sale date), cash ledger (on the payment date), receivables.
--   9. Payments cannot exceed what the patient or SGK owes.
-- Tests: frontend/supabase/tests/007_integrity_test.sql (bash frontend/supabase/tests/run.sh).
-- Run once in the Supabase SQL Editor, after 006_new_tables.sql.

begin;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- Which unit a sale item stands for today: the sold unit, or the newest replacement in its chain.
-- Ordered by id, not by date, because the replacement trigger only accepts links in insertion order.
create or replace function public.sale_item_current_unit(p_sale_item_id bigint)
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select dr.new_stock_unit_id from public.device_replacements dr
      where dr.sale_item_id = p_sale_item_id
      order by dr.id desc
      limit 1),
    (select si.stock_unit_id from public.sale_items si where si.id = p_sale_item_id))
$$;

-- What each sale item is worth after its share of the sale discount and VAT.
-- The discount is split by item value and rounded to kuruş; the last item absorbs the rounding difference.
create view public.sale_item_values
with (security_invoker = true)
as
with lines as (
  select
    si.id                                                        as sale_item_id,
    si.sale_id,
    s.discount,
    s.tax_rate,
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
  round((gross - discount_share) * (1 + tax_rate / 100), 2) as net_value
from final;

create or replace function public.sale_total(p_sale_id bigint)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(net_value), 0) from public.sale_item_values where sale_id = p_sale_id
$$;

-- ---------------------------------------------------------------------------
-- 1 + 3. Device replacements
-- ---------------------------------------------------------------------------

create or replace function public.device_replacement_apply()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Locking the sale item makes a second, simultaneous replacement wait and then see this one.
  perform 1 from public.sale_items where id = new.sale_item_id for update;
  if not found then
    raise exception 'Sale item % does not exist', new.sale_item_id using errcode = 'P0001';
  end if;

  if exists (select 1 from public.refunds where sale_item_id = new.sale_item_id and returns_device) then
    raise exception 'The device of sale item % was returned; it cannot be replaced', new.sale_item_id
      using errcode = 'P0001';
  end if;

  if public.sale_item_current_unit(new.sale_item_id) is distinct from new.old_stock_unit_id then
    raise exception 'Unit % is not the device currently in use for sale item %', new.old_stock_unit_id, new.sale_item_id
      using errcode = 'P0001';
  end if;

  -- Only a unit on the shelf can be handed out. A unit sent straight from the manufacturer is first
  -- registered in stock, then given out here; that keeps every handed-out unit traceable.
  update public.stock_units set status = 'sold'
   where id = new.new_stock_unit_id and status = 'in_stock';
  if not found then
    raise exception 'Unit % must be in stock to be handed out as a replacement', new.new_stock_unit_id
      using errcode = 'P0001';
  end if;

  update public.stock_units set status = 'removed' where id = new.old_stock_unit_id;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2 + 3. Refunds
-- ---------------------------------------------------------------------------

-- false = money only (for example a price correction); the patient keeps the device.
alter table public.refunds add column returns_device boolean not null default true;

create or replace function public.refund_return_stock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  item       public.sale_items%rowtype;
  item_value numeric;
  unit_id    bigint;
begin
  select * into item from public.sale_items where id = new.sale_item_id for update;
  if not found then
    raise exception 'Sale item % does not exist', new.sale_item_id using errcode = 'P0001';
  end if;

  select net_value into item_value from public.sale_item_values where sale_item_id = new.sale_item_id;
  if new.amount > item_value then
    raise exception 'Refund % is more than the item value %', new.amount, item_value using errcode = 'P0001';
  end if;

  if item.stock_unit_id is null then
    new.returns_device := false;  -- a service has no device to return
  elsif new.returns_device then
    unit_id := public.sale_item_current_unit(item.id);
    update public.stock_units set status = 'in_stock' where id = unit_id and status = 'sold';
    if not found then
      raise exception 'Unit % is not with the patient, so it cannot come back to stock', unit_id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Purchase price lock
-- ---------------------------------------------------------------------------

alter table public.price_changes add column stock_unit_id bigint references public.stock_units (id);
alter table public.price_changes drop constraint price_changes_target_check;
alter table public.price_changes add constraint price_changes_target_check
  check (num_nonnulls(product_id, service_id, stock_unit_id) = 1);
create index price_changes_stock_unit_id_idx on public.price_changes (stock_unit_id, changed_at desc);

-- The cash ledger reads each unit's purchase price, so changing it rewrites past months.
-- Security definer so the log row can be written although users cannot insert into price_changes.
create or replace function public.stock_unit_purchase_price_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.purchase_price is distinct from old.purchase_price then
    -- auth.uid() is empty only for the database owner (migrations); every panel user has one.
    if auth.uid() is not null and not (public.is_mfa_verified() and public.is_active_admin()) then
      raise exception 'Only an admin can correct the purchase price of a stock unit' using errcode = '42501';
    end if;
    insert into public.price_changes (stock_unit_id, price_field, old_price, new_price, changed_by)
    values (new.id, 'purchase', coalesce(old.purchase_price, 0), coalesce(new.purchase_price, 0), auth.uid());
  end if;
  return new;
end;
$$;

create trigger stock_units_purchase_price_guard
before update of purchase_price on public.stock_units
for each row execute function public.stock_unit_purchase_price_guard();

-- ---------------------------------------------------------------------------
-- 5. National IDs only through functions
-- ---------------------------------------------------------------------------

-- With these gone the table has RLS and no rules, so no panel user can touch it directly.
drop policy "id viewers read national ids" on public.patient_national_ids;
drop policy "staff add national ids"       on public.patient_national_ids;
drop policy "id viewers edit national ids" on public.patient_national_ids;

-- Anyone on staff may enter the ID of a patient who has none (interns included); changing an existing
-- one needs the ID permission. The value arrives already encrypted by the server.
create or replace function public.save_national_id(p_patient_id bigint, p_encrypted text, p_last4 text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_active_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  if exists (select 1 from public.patient_national_ids where patient_id = p_patient_id) then
    if not public.can_view_national_ids() then
      raise exception 'Changing an existing national ID needs the national ID permission' using errcode = '42501';
    end if;
    update public.patient_national_ids
       set encrypted = p_encrypted, last4 = p_last4, updated_at = now()
     where patient_id = p_patient_id;
  else
    insert into public.patient_national_ids (patient_id, encrypted, last4)
    values (p_patient_id, p_encrypted, p_last4);
  end if;
end;
$$;

-- The only way to get the encrypted ID: the read and its audit row happen in one step.
create or replace function public.reveal_national_id(p_patient_id bigint)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  value text;
begin
  if not public.can_view_national_ids() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select encrypted into value from public.patient_national_ids where patient_id = p_patient_id;
  if value is not null then
    insert into public.national_id_views (patient_id, viewed_by) values (p_patient_id, auth.uid());
  end if;
  return value;
end;
$$;

-- Masked display (*******1234) for users with the ID permission. Runs with the owner's rights,
-- so it exposes only patient_id and the last four digits, and only to permitted users.
create view public.patient_national_id_last4
as
select patient_id, last4
from public.patient_national_ids
where public.can_view_national_ids();

-- ---------------------------------------------------------------------------
-- 6. No access for anonymous visitors
-- ---------------------------------------------------------------------------

revoke all on public.patient_national_id_presence from anon;
revoke all on public.patient_national_id_last4 from anon;
revoke execute on function public.save_national_id(bigint, text, text) from public, anon;
revoke execute on function public.reveal_national_id(bigint) from public, anon;
grant execute on function public.save_national_id(bigint, text, text) to authenticated;
grant execute on function public.reveal_national_id(bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. SGK payments are payment rows
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from public.sales where sgk_status is not null) then
    raise exception 'sales already holds SGK statuses; record them as sale_payments before dropping the columns';
  end if;
end;
$$;

alter table public.sales drop constraint sales_sgk_pair;
alter table public.sales drop constraint sales_sgk_received;
alter table public.sales drop column sgk_status;
alter table public.sales drop column sgk_received_on;

alter table public.sale_payments
  add column payer text not null default 'patient' check (payer in ('patient', 'sgk'));

-- ---------------------------------------------------------------------------
-- 9. Payments cannot exceed what is owed
-- ---------------------------------------------------------------------------

create or replace function public.sale_payment_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sale_value   numeric;
  sgk_expected numeric;
  patient_paid numeric;
  sgk_paid     numeric;
begin
  -- Locking the sale makes simultaneous payments for it wait for each other.
  select coalesce(sgk_amount, 0) into sgk_expected from public.sales where id = new.sale_id for update;
  if not found then
    raise exception 'Sale % does not exist', new.sale_id using errcode = 'P0001';
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

create trigger sale_payments_guard
before insert or update of sale_id, amount, payer on public.sale_payments
for each row execute function public.sale_payment_guard();

-- ---------------------------------------------------------------------------
-- 8. Reports
-- ---------------------------------------------------------------------------

drop view public.ledger_payment_totals;
drop view public.ledger_monthly;
drop view public.ledger_entries;

-- Per sale: totals, what was paid by whom, and what is still owed. Visible to all staff
-- (the sale screen shows the open balance); the ledger views below are accounting-only.
--   remaining = total - value of items returned with their device - all payments + refunds paid for returned devices
-- A money-only refund lowers both what is owed and what was kept, so it does not change the balance.
create view public.sales_overview
with (security_invoker = true)
as
with item_totals as (
  select sale_id, sum(gross) as gross, sum(net_value) as total
  from public.sale_item_values
  group by sale_id
),
paid as (
  select sale_id,
         sum(amount) filter (where payer = 'patient') as patient_paid,
         sum(amount) filter (where payer = 'sgk')     as sgk_paid
  from public.sale_payments
  group by sale_id
),
returned as (
  select si.sale_id,
         sum(r.amount)                                                   as refunded,
         sum(case when r.returns_device then siv.net_value else 0 end)  as returned_value,
         sum(case when r.returns_device then r.amount else 0 end)       as device_refunds
  from public.refunds r
  join public.sale_items si       on si.id = r.sale_item_id
  join public.sale_item_values siv on siv.sale_item_id = r.sale_item_id
  group by si.sale_id
),
balances as (
  select
    s.id                                          as sale_id,
    s.sale_no,
    s.sale_date,
    s.sale_kind,
    s.patient_id,
    coalesce(pt.full_name, s.customer_name)       as buyer_name,
    coalesce(it.gross, 0)                         as gross,
    s.discount,
    s.tax_rate,
    coalesce(it.total, 0)                         as total,
    coalesce(s.sgk_amount, 0)                     as sgk_expected,
    coalesce(p.sgk_paid, 0)                       as sgk_paid,
    coalesce(p.patient_paid, 0)                   as patient_paid,
    coalesce(r.refunded, 0)                       as refunded,
    coalesce(it.total, 0) - coalesce(r.returned_value, 0)
      - coalesce(p.patient_paid, 0) - coalesce(p.sgk_paid, 0)
      + coalesce(r.device_refunds, 0)             as remaining_total
  from public.sales s
  left join public.patients pt on pt.id = s.patient_id
  left join item_totals it     on it.sale_id = s.id
  left join paid p             on p.sale_id = s.id
  left join returned r         on r.sale_id = s.id
)
select
  b.*,
  b.sgk_expected - b.sgk_paid                       as sgk_remaining,
  b.remaining_total - (b.sgk_expected - b.sgk_paid) as patient_remaining,
  case when b.sgk_expected = 0 then null
       when b.sgk_paid >= b.sgk_expected then 'received'
       else 'pending' end                           as sgk_status
from balances b;

-- Open balances: who still owes what (patient share and expected SGK money).
create view public.receivables
with (security_invoker = true)
as
select sale_id, sale_no, sale_date, patient_id, buyer_name, total,
       patient_remaining, sgk_remaining, sgk_status
from public.sales_overview
where patient_remaining > 0 or sgk_remaining > 0;

-- Sales report: every sale item on its sale date at its full value (accrual view of revenue).
create view public.sale_report
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
left join public.services sv       on sv.id = si.service_id;

-- Cash ledger: the 13 Excel columns, now on a cash basis. Income is every payment on the day the money
-- arrived (patient or SGK); the device, serial and operation columns list the items of that sale.
create view public.ledger_entries
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

-- Monthly cash summary. net_cash is money in minus money out, not accounting profit
-- (expected SGK money and unpaid balances are in receivables, not here).
create view public.ledger_monthly
with (security_invoker = true)
as
select
  month,
  coalesce(sum(amount) filter (where income_expense = 'GELİR'), 0) as total_income,
  coalesce(sum(amount) filter (where income_expense = 'GİDER'), 0) as total_expense,
  coalesce(sum(amount) filter (where income_expense = 'GELİR'), 0)
    - coalesce(sum(amount) filter (where income_expense = 'GİDER'), 0) as net_cash
from public.ledger_entries
group by month;

-- Money in and out per payment method per month.
create view public.ledger_payment_totals
with (security_invoker = true)
as
select
  le.month,
  le.payment_label,
  coalesce(sum(le.amount) filter (where le.income_expense = 'GELİR'), 0) as total_income,
  coalesce(sum(le.amount) filter (where le.income_expense = 'GİDER'), 0) as total_expense
from public.ledger_entries le
join public.payment_methods pm on pm.ledger_label = le.payment_label
group by le.month, le.payment_label, pm.sort_order
order by le.month, pm.sort_order;

revoke all on public.sale_item_values, public.sales_overview, public.receivables, public.sale_report,
              public.ledger_entries, public.ledger_monthly, public.ledger_payment_totals
  from anon;

commit;
