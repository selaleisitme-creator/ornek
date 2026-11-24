-- Tests for 015_patient_devices.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
-- Runs after the earlier tests in the same database, so every id is looked up by name.
\set ON_ERROR_STOP off
\pset footer off

drop schema if exists t cascade;
create schema t;
grant usage on schema t to anon, authenticated;

create function t.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  raise notice '% %', case when cond then 'PASS' else 'FAIL' end, name;
end $$;

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

create function t.product(n text) returns bigint language sql stable as $$ select id from public.products where name = n $$;
create function t.unit(serial text) returns bigint language sql stable as $$ select id from public.stock_units where serial_no = serial $$;
create function t.patient(n text) returns bigint language sql stable as $$ select id from public.patients where full_name = n $$;
create function t.brand() returns bigint language sql stable as $$ select id from public.brands where name = 'Cihaz Test' $$;
create function t.today() returns date language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;
create function t.item(serial text) returns bigint language sql stable as $$
  select si.id from public.sale_items si join public.stock_units u on u.id = si.stock_unit_id where u.serial_no = serial
$$;
-- add_legacy_device / replace_device as SQL text, for statements that must be refused.
create function t.legacy_sql(patient bigint, p jsonb, u jsonb, s jsonb) returns text language sql stable as $$
  select format('select public.add_legacy_device(%s, %L::jsonb, %L::jsonb, %L::jsonb)', patient, p, u, s)
$$;
create function t.replace_sql(item bigint, u jsonb, reason text, d date, w date default null) returns text language sql stable as $$
  select format('select public.replace_device(%s, %L::jsonb, %L, %L::date, null, %L::date)', item, u, reason, d, w)
$$;

create table t.res (k text primary key, v jsonb);
grant all on t.res to authenticated;
grant execute on all functions in schema t to anon, authenticated;

select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.brands (name) values ('Cihaz Test');
insert into public.products (brand_id, category, name, sale_price, purchase_price, serial_policy) values
  (t.brand(), 'device', 'Cihaz Model A', 30000, 18000, 'required'),
  (t.brand(), 'dome', 'Cihaz Kubbe', 50, 10, 'none');
insert into public.stock_units (product_id, serial_no, ear_side) values
  (t.product('Cihaz Model A'), 'CT-1', 'right'),
  (t.product('Cihaz Model A'), 'CT-2', 'right');
insert into public.patients (full_name, phone, record_type) values
  ('Cihaz Hasta', '+905550001111', 'patient'),
  ('Cihaz Aday', '+905550001112', 'candidate');

-- Everything below runs as the staff member (like an intern), through RLS.
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- L: legacy device'
insert into t.res select 'l1', to_jsonb(public.add_legacy_device(
  t.patient('Cihaz Hasta'),
  jsonb_build_object('id', t.product('Cihaz Model A')),
  '{"serial_no": " CT-L1 ", "ear_side": "right"}',
  jsonb_build_object('sale_date', t.today() - 900, 'warranty_end', t.today() - 170)));
select t.ok('L1a a legacy sale is created for the patient',
  (select sale_kind from public.sales where id = (select (v #>> '{}')::bigint from t.res where k = 'l1')) = 'legacy'
  and (select patient_id from public.sales where id = (select (v #>> '{}')::bigint from t.res where k = 'l1')) = t.patient('Cihaz Hasta'));
select t.ok('L1b the unit is sold, without a stock receipt and at no purchase price',
  (select status = 'sold' and receipt_id is null and purchase_price = 0 from public.stock_units where serial_no = 'CT-L1'));
select t.ok('L1c the item keeps the side and the warranty, starting on the sale date',
  (select ear_side = 'right' and warranty_start = t.today() - 900 and warranty_end = t.today() - 170
     from public.sale_items where id = t.item('CT-L1')));

insert into t.res select 'l2', to_jsonb(public.add_legacy_device(
  t.patient('Cihaz Hasta'),
  jsonb_build_object('brand_id', t.brand(), 'name', ' Eski  Model ', 'type', 'BTE'),
  '{"serial_no": "CT-L2", "ear_side": "left"}',
  jsonb_build_object('sale_date', t.today() - 2000, 'unit_price', 12000)));
select t.ok('L2a a model that was not in the list is created inactive, as a hearing aid',
  (select not active and category = 'device' and serial_policy = 'required' and type = 'BTE'
     from public.products where name = 'Eski Model'));
select t.ok('L2b ... and the item keeps the price typed in', (select unit_price from public.sale_items where id = t.item('CT-L2')) = 12000);

select t.expect_error('L3 a candidate gets no device',
  t.legacy_sql(t.patient('Cihaz Aday'), jsonb_build_object('id', t.product('Cihaz Model A')), '{"serial_no": "CT-L3"}',
               jsonb_build_object('sale_date', t.today())), 'candidate');
select t.expect_error('L4 a sale date in the future is refused',
  t.legacy_sql(t.patient('Cihaz Hasta'), jsonb_build_object('id', t.product('Cihaz Model A')), '{"serial_no": "CT-L4"}',
               jsonb_build_object('sale_date', t.today() + 1)), 'future');
select t.expect_error('L5 a legacy device needs a serial number',
  t.legacy_sql(t.patient('Cihaz Hasta'), jsonb_build_object('id', t.product('Cihaz Model A')), '{"serial_no": " "}',
               jsonb_build_object('sale_date', t.today())), 'serial');
select t.expect_error('L6 a serial number already in the system is refused',
  t.legacy_sql(t.patient('Cihaz Hasta'), jsonb_build_object('id', t.product('Cihaz Model A')), '{"serial_no": "CT-1"}',
               jsonb_build_object('sale_date', t.today())), 'duplicate');
select t.expect_error('L7 only a hearing aid model can be a legacy device',
  t.legacy_sql(t.patient('Cihaz Hasta'), jsonb_build_object('id', t.product('Cihaz Kubbe')), '{"serial_no": "CT-L7"}',
               jsonb_build_object('sale_date', t.today())), 'hearing aid');
select t.expect_error('L8 a warranty that ends before the sale is refused',
  t.legacy_sql(t.patient('Cihaz Hasta'), jsonb_build_object('id', t.product('Cihaz Model A')), '{"serial_no": "CT-L8"}',
               jsonb_build_object('sale_date', t.today() - 10, 'warranty_end', t.today() - 20)), 'warranty');
select t.ok('L9 the refused calls left nothing behind',
  not exists (select 1 from public.stock_units where serial_no in ('CT-L3', 'CT-L4', 'CT-L7', 'CT-L8')));

\echo '--- R: device replacement'
insert into t.res select 'r1', to_jsonb(public.replace_device(
  t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-1')), 'warranty', t.today() - 5, 'TEST not', t.today() + 700));
select t.ok('R1a the replacement is recorded with the old and the new unit',
  (select old_stock_unit_id = t.unit('CT-L1') and new_stock_unit_id = t.unit('CT-1') and reason = 'warranty'
     from public.device_replacements where id = (select (v #>> '{}')::bigint from t.res where k = 'r1')));
select t.ok('R1b the old unit is removed and the new one is sold',
  (select status from public.stock_units where serial_no = 'CT-L1') = 'removed'
  and (select status from public.stock_units where serial_no = 'CT-1') = 'sold');
select t.ok('R1c the new warranty end is written on the item',
  (select warranty_end from public.sale_items where id = t.item('CT-L1')) = t.today() + 700);
select t.ok('R1d the patient overview shows the new unit', (select right_device from public.patient_overview
  where patient_id = t.patient('Cihaz Hasta')) like '%CT-1%');

insert into t.res select 'r2', to_jsonb(public.replace_device(
  t.item('CT-L1'), jsonb_build_object('product_id', t.product('Cihaz Model A'), 'serial_no', 'CT-NEW'), 'service', t.today(), null));
select t.ok('R2a a unit from the manufacturer is registered without a receipt, at no purchase price, and handed out',
  (select status = 'sold' and receipt_id is null and purchase_price = 0 and ear_side = 'right'
     from public.stock_units where serial_no = 'CT-NEW'));
select t.ok('R2b without a new warranty end the item keeps its warranty',
  (select warranty_end from public.sale_items where id = t.item('CT-L1')) = t.today() + 700);

select t.expect_error('R3 a unit that is not in stock cannot be handed out',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-L2')), 'warranty', t.today()), 'in stock');
select t.expect_error('R4a an unknown reason is refused',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-2')), 'gift', t.today()), 'reason');
select t.expect_error('R4b a date in the future is refused',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-2')), 'warranty', t.today() + 1), 'future');
select t.expect_error('R4c a date before the sale is refused',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-2')), 'warranty', t.today() - 1000), 'before the sale');
select t.expect_error('R5 a new unit of another group is refused',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('product_id', t.product('Cihaz Kubbe'), 'serial_no', 'CT-K'), 'service', t.today()),
  'same group');
select t.expect_error('R6 a warranty that ends before the sale is refused',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('id', t.unit('CT-2')), 'warranty', t.today(), t.today() - 2000), 'warranty');
select t.expect_error('R7 a new unit needs a serial number',
  t.replace_sql(t.item('CT-L1'), jsonb_build_object('product_id', t.product('Cihaz Model A')), 'service', t.today()), 'serial');
select t.expect_error('R8 an unknown sale item is refused',
  t.replace_sql(999999999, jsonb_build_object('id', t.unit('CT-2')), 'warranty', t.today()), 'not found');
select t.ok('R9 the refused calls changed nothing',
  (select status from public.stock_units where serial_no = 'CT-2') = 'in_stock'
  and not exists (select 1 from public.stock_units where serial_no = 'CT-K'));

\echo '--- G: grants'
reset role;
select t.ok('G1 anon cannot run the two functions',
  not has_function_privilege('anon', 'public.add_legacy_device(bigint, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.replace_device(bigint, jsonb, text, date, text, date)', 'execute'));
