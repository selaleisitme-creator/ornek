-- Tests for 007_integrity_fixes.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
-- Run with migrations up to 006 to see the original bugs (FAIL), and with 007 to see them fixed.
\set ON_ERROR_STOP off
\pset footer off

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  raise notice '% %', case when cond then 'PASS' else 'FAIL' end, name;
end $$;

-- Runs a statement that must be refused. Its error message must contain `pattern`.
create function t.expect_error(name text, stmt text, pattern text default '') returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || pattern || '%' then
      raise notice 'PASS % (refused: %)', name, sqlerrm;
    else
      raise notice 'FAIL % (wrong error: %)', name, sqlerrm;
    end if;
    return;
  end;
  raise notice 'FAIL % (was not refused)', name;
end $$;

create function t.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', 'aal2')::text, false);
$$;

create function t.unit(serial text) returns bigint language sql stable as $$
  select id from public.stock_units where serial_no = serial;
$$;
create function t.status(serial text) returns text language sql stable as $$
  select status from public.stock_units where serial_no = serial;
$$;

grant execute on all functions in schema t to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Data (as the database owner, signed in as the admin so created_by is filled)
-- ---------------------------------------------------------------------------
select t.as_user('22222222-2222-2222-2222-222222222222');
alter table public.profiles add column if not exists can_view_accounting boolean not null default false;
update public.profiles set can_view_accounting = true where role = 'admin';

insert into public.brands (name) values ('Phonak');
insert into public.products (brand_id, category, name, sale_price, purchase_price)
values (1, 'device', 'Audeo', 1000, 600), (1, 'device', 'Lumity', 30000, 18000);
insert into public.stock_receipts (payment_method, received_on) values ('paynet', '2026-10-01');
insert into public.stock_units (product_id, receipt_id, serial_no) values
  (1, 1, 'A1'), (1, 1, 'A2'), (1, 1, 'B1'), (1, 1, 'B2'), (1, 1, 'N1'), (1, 1, 'N2'), (1, 1, 'N3'), (2, 1, 'C1');
insert into public.patients (full_name, phone) values ('Ali Veli', '05551112233'), ('Ayşe Kaya', '05554445566');

-- S1: Ali buys A1. S2: Ayşe buys B1. S3: Ali buys A2.
insert into public.sales (patient_id, sale_date) values (1, '2026-10-05'), (2, '2026-10-06'), (1, '2026-10-07');
insert into public.sale_items (sale_id, stock_unit_id, unit_price) values (1, t.unit('A1'), 1000);
insert into public.sale_items (sale_id, stock_unit_id, unit_price) values (2, t.unit('B1'), 1000);
insert into public.sale_items (sale_id, stock_unit_id, unit_price) values (3, t.unit('A2'), 1000);

-- From here on, act through RLS like the panel does.
set role authenticated;

\echo '--- A: a replacement may only hand out a unit from the shelf'
select t.expect_error('A1 unit sold to another patient cannot be the new unit',
  format('insert into public.device_replacements (sale_item_id, old_stock_unit_id, new_stock_unit_id) values (2, %s, %s)', t.unit('B1'), t.unit('A1')),
  'in stock');
select t.ok('A1 the other patient''s unit is still sold', t.status('A1') = 'sold');
insert into public.device_replacements (sale_item_id, old_stock_unit_id, new_stock_unit_id) values (2, t.unit('B1'), t.unit('N1'));
select t.ok('A2 shelf unit handed out: old removed, new sold', t.status('B1') = 'removed' and t.status('N1') = 'sold');

\echo '--- B: a refund returns the device the patient actually has'
insert into public.refunds (sale_item_id, amount, payment_method, reason) values (2, 1000, 'cash', 'Memnun kalmadı');
select t.ok('B1 the replacement unit goes back to the shelf', t.status('N1') = 'in_stock');
select t.ok('B1 the replaced unit stays removed', t.status('B1') = 'removed');
insert into public.refunds (sale_item_id, amount, payment_method, reason, returns_device) values (3, 100, 'cash', 'Fiyat farkı', false);
select t.ok('B2 a money-only refund leaves the device with the patient', t.status('A2') = 'sold');

\echo '--- D: purchase prices are locked once a unit is in stock'
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.expect_error('D1 staff cannot change a unit''s purchase price',
  format('update public.stock_units set purchase_price = 1 where id = %s', t.unit('B2')), 'admin');
select t.as_user('22222222-2222-2222-2222-222222222222');
update public.stock_units set purchase_price = 550 where serial_no = 'B2';
select t.ok('D2 an admin correction is applied and logged',
  t.unit('B2') in (select stock_unit_id from public.price_changes where price_field = 'purchase' and new_price = 550));

\echo '--- E: national IDs are read only through the logging function'
reset role;
insert into public.patient_national_ids (patient_id, encrypted, last4) values (1, 'cipher-ali', '1234');
set role authenticated;
select t.ok('E1 even the admin cannot read the table directly', (select count(*) from public.patient_national_ids) = 0);
select t.ok('E2 reveal returns the encrypted value', public.reveal_national_id(1) = 'cipher-ali');
select t.ok('E3 the reveal was logged', (select count(*) from public.national_id_views where patient_id = 1) = 1);
select t.ok('E4 the admin sees the last four digits', (select last4 from public.patient_national_id_last4 where patient_id = 1) = '1234');
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.expect_error('E5 staff without permission cannot reveal', 'select public.reveal_national_id(1)', 'not allowed');
select t.ok('E6 staff without permission sees no last four digits', (select count(*) from public.patient_national_id_last4) = 0);
select public.save_national_id(2, 'cipher-ayse', '5678');
select t.ok('E7 staff can enter the ID of a patient without one', exists (select 1 from public.patient_national_id_presence where patient_id = 2));
select t.expect_error('E8 staff cannot overwrite an existing ID', 'select public.save_national_id(1, ''x'', ''0000'')', 'permission');

\echo '--- F: anonymous visitors get nothing'
set role anon;
select t.expect_error('F1 anon cannot query the presence view', 'select * from public.patient_national_id_presence', 'permission denied');
select t.expect_error('F2 anon cannot call reveal', 'select public.reveal_national_id(1)', 'permission denied');
set role authenticated;

\echo '--- G: payments, SGK and receivables (30.000 TL sale, 10.000 TL expected from SGK)'
select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.sales (patient_id, sale_date, sgk_amount) values (1, '2026-11-01', 10000);
insert into public.sale_items (sale_id, stock_unit_id, unit_price) values (4, t.unit('C1'), 30000);
insert into public.sale_payments (sale_id, payment_method, amount, paid_on) values (4, 'cash', 15000, '2026-11-01');
insert into public.sale_payments (sale_id, payment_method, amount, paid_on) values (4, 'card_pos', 5000, '2026-11-20');
select t.ok('G1 after the patient paid: patient owes 0, SGK owes 10.000',
  (select patient_remaining = 0 and sgk_remaining = 10000 and sgk_status = 'pending' from public.sales_overview where sale_id = 4));
select t.ok('G2 the expected SGK money is listed as a receivable', exists (select 1 from public.receivables where sale_id = 4));
select t.expect_error('G3 the patient cannot pay more than their share',
  'insert into public.sale_payments (sale_id, payment_method, amount) values (4, ''cash'', 1)', 'exceed');
insert into public.sale_payments (sale_id, payment_method, amount, paid_on, payer) values (4, 'transfer', 10000, '2026-12-05', 'sgk');
select t.ok('G4 after SGK paid: nothing is owed and the receivable is gone',
  (select patient_remaining = 0 and sgk_remaining = 0 and sgk_status = 'received' from public.sales_overview where sale_id = 4)
  and not exists (select 1 from public.receivables where sale_id = 4));
select t.expect_error('G5 SGK cannot pay more than expected',
  'insert into public.sale_payments (sale_id, payment_method, amount, payer) values (4, ''transfer'', 1, ''sgk'')', 'exceed');
select t.expect_error('G6 no SGK payment on a sale without an SGK amount',
  'insert into public.sale_payments (sale_id, payment_method, amount, payer) values (1, ''transfer'', 1, ''sgk'')', 'exceed');

\echo '--- H: the cash ledger follows the money, the sales report follows the sale'
select t.ok('H1 cash ledger has the three payments on their own dates',
  (select array_agg(entry_date::text || '=' || amount::text order by entry_date) from public.ledger_entries where source = 'sale_payment')
  = array['2026-11-01=15000.00', '2026-11-20=5000.00', '2026-12-05=10000.00']);
select t.ok('H2 the SGK payment is labelled in the ledger',
  exists (select 1 from public.ledger_entries where entry_date = '2026-12-05' and description like 'SGK%'));
select t.ok('H3 the sales report shows the full 30.000 TL on the sale date',
  (select sum(net_value) from public.sale_report where sale_date = '2026-11-01') = 30000);
select t.ok('H4 monthly cash total for November is 20.000 TL in',
  (select total_income from public.ledger_monthly where month = '2026-11-01') = 20000);
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.ok('H5 staff without accounting permission sees no ledger', (select count(*) from public.ledger_entries) = 0);

reset role;
