-- 005_accounting.sql
-- Expense categories (R25), expense templates (R26), manual cash entries (R27) and the cash ledger
-- views that rebuild the clinic's Excel "KASA DEFTERİ" from the real records.
-- Design reference: ŞELALE/docs/veritabani-normalizasyon.md (section 3-D and section 4, "Muhasebe").
-- Run once in the Supabase SQL Editor, after 004_appointments.sql.

begin;

-- ---------------------------------------------------------------------------
-- Freeze the purchase price on each stock unit
-- ---------------------------------------------------------------------------
-- The ledger shows a stock purchase at the unit's purchase price. If that fell back to the
-- product's current price, a later price change would rewrite old months of the ledger.
create or replace function public.stock_unit_freeze_purchase_price()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.purchase_price is null then
    select purchase_price into new.purchase_price from public.products where id = new.product_id;
  end if;
  return new;
end;
$$;

create trigger stock_units_freeze_purchase_price
before insert on public.stock_units
for each row execute function public.stock_unit_freeze_purchase_price();

update public.stock_units u
   set purchase_price = p.purchase_price
  from public.products p
 where p.id = u.product_id and u.purchase_price is null;

-- ---------------------------------------------------------------------------
-- R25 Expense categories
-- ---------------------------------------------------------------------------

create table public.expense_categories (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> ''),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- "Kira", "kira" and "KİRA" must be one category (the Excel sheet allowed all three).
create unique index expense_categories_name_key on public.expense_categories (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- R26 Expense templates (fixed monthly costs such as rent)
-- ---------------------------------------------------------------------------

create table public.expense_templates (
  id                  bigint generated always as identity primary key,
  name                text not null check (btrim(name) <> ''),
  expense_category_id bigint references public.expense_categories (id),
  amount              numeric(12, 2) not null check (amount > 0),
  payment_method      text not null references public.payment_methods (code),
  note                text,
  active              boolean not null default true,
  created_at          timestamptz not null default now()
);

create unique index expense_templates_name_key on public.expense_templates (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- R27 Cash entries (only what is typed in by hand: rent, bills, other income)
-- ---------------------------------------------------------------------------

create table public.cash_entries (
  id                  bigint generated always as identity primary key,
  direction           text not null check (direction in ('income', 'expense')),
  entry_date          date not null default current_date,  -- the Excel date macro's job
  amount              numeric(12, 2) not null check (amount > 0),
  payment_method      text not null references public.payment_methods (code),
  expense_category_id bigint references public.expense_categories (id),
  template_id         bigint references public.expense_templates (id),
  counterparty_name   text,
  description         text,
  created_by          uuid not null default auth.uid() references public.profiles (id),
  created_at          timestamptz not null default now()
);

create index cash_entries_entry_date_idx on public.cash_entries (entry_date);

-- ---------------------------------------------------------------------------
-- Row Level Security: accounting needs can_view_accounting, not just an active account
-- ---------------------------------------------------------------------------

alter table public.expense_categories enable row level security;
alter table public.expense_templates  enable row level security;
alter table public.cash_entries       enable row level security;

create policy "accounting read expense categories" on public.expense_categories for select to authenticated using (public.is_accounting_staff());
create policy "accounting add expense categories"  on public.expense_categories for insert to authenticated with check (public.is_accounting_staff());
create policy "accounting edit expense categories" on public.expense_categories for update to authenticated using (public.is_accounting_staff()) with check (public.is_accounting_staff());

create policy "accounting read expense templates" on public.expense_templates for select to authenticated using (public.is_accounting_staff());
create policy "accounting add expense templates"  on public.expense_templates for insert to authenticated with check (public.is_accounting_staff());
create policy "accounting edit expense templates" on public.expense_templates for update to authenticated using (public.is_accounting_staff()) with check (public.is_accounting_staff());

create policy "accounting read cash entries" on public.cash_entries for select to authenticated using (public.is_accounting_staff());
create policy "accounting add cash entries"  on public.cash_entries for insert to authenticated with check (public.is_accounting_staff());
create policy "accounting edit cash entries" on public.cash_entries for update to authenticated using (public.is_accounting_staff()) with check (public.is_accounting_staff());

-- ---------------------------------------------------------------------------
-- ledger_entries: the 13 Excel columns, one row per sale item / refund / stock unit / cash entry
-- ---------------------------------------------------------------------------
-- security_invoker: the view runs with the reader's rights, so table RLS still applies.
-- The extra is_accounting_staff() filter hides sales figures from staff without accounting access.

create view public.ledger_entries
with (security_invoker = true)
as
with sale_lines as (
  select
    si.id,
    s.id                                       as sale_id,
    s.sale_date,
    s.tax_rate,
    s.discount,
    si.unit_price * si.quantity                as gross,
    sum(si.unit_price * si.quantity) over w    as sale_gross,
    row_number() over (w order by si.id desc)  as reverse_position
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  window w as (partition by si.sale_id)
),
discount_shares as (
  -- Discount split by item value, rounded to kuruş; the last item absorbs the rounding difference.
  select
    sl.*,
    round(sl.discount * sl.gross / nullif(sl.sale_gross, 0), 2) as rounded_share,
    sum(round(sl.discount * sl.gross / nullif(sl.sale_gross, 0), 2)) over (partition by sl.sale_id) as rounded_total
  from sale_lines sl
),
sale_payment_labels as (
  -- "NAKİT + KK" in the payment list's own order, each method once.
  select sale_id, string_agg(ledger_label, ' + ' order by sort_order) as label
  from (
    select distinct sp.sale_id, pm.ledger_label, pm.sort_order
    from public.sale_payments sp
    join public.payment_methods pm on pm.code = sp.payment_method
  ) methods
  group by sale_id
),
ledger_rows as (
  -- 1) Sale items: income
  select
    'sale_item'::text                                       as source,
    si.id                                                   as source_id,
    1                                                       as source_order,
    ds.sale_date                                            as entry_date,
    'income'::text                                          as direction,
    coalesce(pt.full_name, s.customer_name)                 as full_name,
    coalesce(pt.phone, s.customer_phone)                    as phone,
    b.name || ' ' || pr.name                                as device,
    su.serial_no,
    si.mold_type,
    case
      when si.service_id is not null then sv.name
      when pr.category = 'device' then 'Cihaz satışı'
      else 'Ürün satışı'
    end                                                     as operation,
    null::text                                              as expense_type,
    round(
      (ds.gross - case when ds.reverse_position = 1
                       then coalesce(ds.discount - (ds.rounded_total - ds.rounded_share), 0)
                       else coalesce(ds.rounded_share, 0) end)
      * (1 + ds.tax_rate / 100), 2)                         as amount,
    coalesce(spl.label, 'BELİRTİLMEDİ')                     as payment_label,
    si.service_note                                         as description
  from public.sale_items si
  join discount_shares ds        on ds.id = si.id
  join public.sales s            on s.id = si.sale_id
  left join public.patients pt   on pt.id = s.patient_id
  left join public.stock_units su on su.id = si.stock_unit_id
  left join public.products pr   on pr.id = su.product_id
  left join public.brands b      on b.id = pr.brand_id
  left join public.services sv   on sv.id = si.service_id
  left join sale_payment_labels spl on spl.sale_id = s.id

  union all

  -- 2) Refunds: expense
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
  join public.sale_items si      on si.id = r.sale_item_id
  join public.sales s            on s.id = si.sale_id
  join public.payment_methods pm on pm.code = r.payment_method
  left join public.patients pt   on pt.id = s.patient_id
  left join public.stock_units su on su.id = si.stock_unit_id
  left join public.products pr   on pr.id = su.product_id
  left join public.brands b      on b.id = pr.brand_id

  union all

  -- 3) Stock purchases: expense, one row per unit (Excel lists every serial number on its own line)
  select
    'stock_unit', su.id, 3, sr.received_on, 'expense',
    sp.name,
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
  left join public.suppliers sp  on sp.id = sr.supplier_id
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
  join public.payment_methods pm on pm.code = ce.payment_method
  left join public.expense_categories ec on ec.id = ce.expense_category_id
)
select
  source,
  source_id,
  date_trunc('month', entry_date)::date                     as month,
  case direction when 'income' then 'GELİR' else 'GİDER' end as income_expense,  -- GELİR/GİDER
  full_name,                                                                   -- ADI SOYADI
  phone,                                                                       -- TEL. NO
  device,                                                                      -- CİHAZ MARKA MODEL
  serial_no,                                                                   -- SERİ NO
  mold_type,                                                                   -- KALIP CİNSİ
  operation,                                                                   -- YAPILAN İŞLEM
  expense_type,                                                                -- GİDER TÜRÜ
  amount,                                                                      -- FİYAT
  payment_label,                                                               -- NAKİT/KK
  entry_date,                                                                  -- TARİH
  -- TOPLAM: running income minus expense, restarting every month like the Excel SUMIF formula.
  sum(case direction when 'income' then amount else -amount end) over (
    partition by date_trunc('month', entry_date)
    order by entry_date, source_order, source_id
    rows between unbounded preceding and current row
  )                                                          as running_total,
  description                                                                  -- AÇIKLAMALAR
from ledger_rows
where public.is_accounting_staff();

-- ---------------------------------------------------------------------------
-- ledger_monthly: the three summary lines under each month block in Excel
-- ---------------------------------------------------------------------------

create view public.ledger_monthly
with (security_invoker = true)
as
select
  month,
  sum(amount) filter (where income_expense = 'GELİR')               as total_income,
  sum(amount) filter (where income_expense = 'GİDER')               as total_expense,
  coalesce(sum(amount) filter (where income_expense = 'GELİR'), 0)
    - coalesce(sum(amount) filter (where income_expense = 'GİDER'), 0) as profit
from public.ledger_entries
group by month;

-- ---------------------------------------------------------------------------
-- ledger_payment_totals: money in and out per payment method per month
-- ---------------------------------------------------------------------------
-- Sale income comes from the payments themselves, so a sale paid half cash, half card is split
-- correctly here (ledger_entries can only show it as "NAKİT + KK").

create view public.ledger_payment_totals
with (security_invoker = true)
as
with movements as (
  select sp.paid_on as entry_date, sp.payment_method, sp.amount as income, 0::numeric as expense
  from public.sale_payments sp
  union all
  select r.refunded_on, r.payment_method, 0, r.amount
  from public.refunds r
  union all
  select sr.received_on, sr.payment_method, 0, su.purchase_price
  from public.stock_units su
  join public.stock_receipts sr on sr.id = su.receipt_id
  union all
  select ce.entry_date, ce.payment_method,
         case ce.direction when 'income' then ce.amount else 0 end,
         case ce.direction when 'expense' then ce.amount else 0 end
  from public.cash_entries ce
)
select
  date_trunc('month', m.entry_date)::date as month,
  pm.ledger_label                         as payment_label,
  sum(m.income)                           as total_income,
  sum(m.expense)                          as total_expense
from movements m
join public.payment_methods pm on pm.code = m.payment_method
where public.is_accounting_staff()
group by 1, 2, pm.sort_order
order by 1, pm.sort_order;

commit;
