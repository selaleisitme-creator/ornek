-- Tests for 010_stock_screen.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
-- Runs after the 007, 008 and 009 tests in the same database, so every id is looked up by name.
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
create function t.brand() returns bigint language sql stable as $$ select id from public.brands where name = 'Stok Test' $$;

-- create_stock_receipt with the three arguments as jsonb literals, for statements that must be refused.
create function t.entry_sql(p jsonb, r jsonb, u jsonb) returns text language sql stable as $$
  select format('select public.create_stock_receipt(%L::jsonb, %L::jsonb, %L::jsonb)', p, r, u)
$$;
create function t.units(prefix text, n integer) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('serial_no', prefix || g, 'ear_side', 'right') order by g) from generate_series(1, n) g
$$;

-- Results that later checks read back (batch ids, returned JSON).
create table t.res (k text primary key, v jsonb);
grant all on t.res to authenticated;

grant execute on all functions in schema t to anon, authenticated;

select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.brands (name) values ('Stok Test');
insert into public.suppliers (name) values ('Tedarikçi 010');

-- Everything below runs as the staff member without accounting rights (like an intern), through RLS.
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- E: stock entry'
insert into t.res select 'e1', public.create_stock_receipt(
  jsonb_build_object('brand_id', t.brand(), 'category', 'device', 'name', 'Model 7', 'sale_price', 50000,
                     'purchase_price', 4000, 'serial_policy', 'required', 'gtin', '08712345678906'),
  jsonb_build_object('supplier_id', (select id from public.suppliers where name = 'Tedarikçi 010'),
                     'received_on', '2026-11-01', 'invoice_no', 'F-7', 'payment_method', 'transfer',
                     'price_mode', 'total', 'amount', 30000),
  t.units('S7-', 7));
select t.ok('E1a 7 units are created for the new product',
  (select count(*) from public.stock_units where product_id = t.product('Model 7')) = 7);
select t.ok('E1b the unit prices add up to exactly 30000',
  (select sum(purchase_price) from public.stock_units where product_id = t.product('Model 7')) = 30000);
select t.ok('E1c six units cost 4285.71 and the last one 4285.74',
  (select count(*) from public.stock_units where product_id = t.product('Model 7') and purchase_price = 4285.71) = 6
  and (select purchase_price from public.stock_units where serial_no = 'S7-7') = 4285.74);
select t.ok('E1d the result names the product, the receipt and the 7 units in order',
  (select (v ->> 'product_id')::bigint = t.product('Model 7')
          and (v ->> 'receipt_id') is not null
          and jsonb_array_length(v -> 'unit_ids') = 7
          and (v -> 'unit_ids' ->> 0)::bigint = t.unit('S7-1')
     from t.res where k = 'e1'));
select t.ok('E1e the receipt carries supplier, date, invoice and payment method',
  (select sr.received_on = '2026-11-01' and sr.invoice_no = 'F-7' and sr.payment_method = 'transfer' and sr.supplier_id is not null
     from public.stock_receipts sr where sr.id = (select (v ->> 'receipt_id')::bigint from t.res where k = 'e1')));

insert into t.res select 'e2', public.create_stock_receipt(
  jsonb_build_object('brand_id', t.brand(), 'category', 'device', 'name', 'Model Açılış', 'sale_price', 20000),
  jsonb_build_object('opening', true),
  t.units('OPEN-', 2));
select t.ok('E2a opening stock opens no receipt',
  (select v -> 'receipt_id' = 'null'::jsonb from t.res where k = 'e2')
  and (select count(*) from public.stock_units where product_id = t.product('Model Açılış') and receipt_id is null) = 2);

select t.expect_error('E3 a required serial number cannot be left out',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')),
              '{"payment_method": "cash", "price_mode": "unit", "amount": 100}',
              '[{"serial_no": "S7-8"}, {"serial_no": "  "}]'), 'serial number');
select t.expect_error('E4 a serial number already in stock is refused',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')),
              '{"payment_method": "cash", "price_mode": "unit", "amount": 100}',
              '[{"serial_no": "S7-1"}]'), 'duplicate');
select t.expect_error('E5a a failing entry with a new product is refused',
  t.entry_sql(jsonb_build_object('brand_id', t.brand(), 'category', 'device', 'name', 'Model Hayalet', 'sale_price', 1),
              '{"payment_method": "cash", "price_mode": "unit", "amount": 100}',
              '[{"serial_no": "S7-2"}]'), 'duplicate');
select t.ok('E5b ... and leaves no product behind', t.product('Model Hayalet') is null);
select t.ok('E5c ... nor a receipt',
  not exists (select 1 from public.stock_receipts where payment_method = 'cash' and invoice_no is null and note is null
              and created_by = '11111111-1111-1111-1111-111111111111'));

insert into t.res select 'e6', public.create_stock_receipt(
  jsonb_build_object('id', t.product('Model 7')),
  '{"payment_method": "cash", "price_mode": "unit", "amount": 4100.50}',
  '[{"serial_no": "S7-8", "ear_side": "left", "production_date": "2026-05-01", "wsa_code": "W8"}, {"serial_no": "S7-9"}]');
select t.ok('E6a an existing product gets new units at the unit price',
  (select count(*) from public.stock_units where product_id = t.product('Model 7')) = 9
  and (select count(*) from public.stock_units where serial_no in ('S7-8', 'S7-9') and purchase_price = 4100.50) = 2);
select t.ok('E6b unit details are stored',
  (select ear_side = 'left' and production_date = '2026-05-01' and wsa_code = 'W8' from public.stock_units where serial_no = 'S7-8'));
select t.ok('E6c the existing product keeps its id', (select (v ->> 'product_id')::bigint from t.res where k = 'e6') = t.product('Model 7'));

select t.expect_error('E7a a purchase needs a payment method',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')), '{"price_mode": "unit", "amount": 100}', '[{"serial_no": "X-1"}]'),
  'payment method');
select t.expect_error('E7b a purchase needs an amount above zero',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')), '{"payment_method": "cash", "price_mode": "unit", "amount": 0}',
              '[{"serial_no": "X-1"}]'), 'amount');
select t.expect_error('E7c no units is refused',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')), '{"payment_method": "cash", "price_mode": "unit", "amount": 1}', '[]'),
  'between 1 and 500');
select t.expect_error('E7d more than 500 units is refused',
  t.entry_sql(jsonb_build_object('id', t.product('Model Açılış')), '{"opening": true}',
              (select jsonb_agg('{}'::jsonb) from generate_series(1, 501))), 'between 1 and 500');
select t.expect_error('E7e an unknown price mode is refused',
  t.entry_sql(jsonb_build_object('id', t.product('Model 7')), '{"payment_method": "cash", "price_mode": "each", "amount": 1}',
              '[{"serial_no": "X-1"}]'), 'price mode');
insert into public.products (brand_id, category, name, active) values (t.brand(), 'device', 'Model Pasif', false);
select t.expect_error('E7f an inactive product takes no stock',
  t.entry_sql(jsonb_build_object('id', t.product('Model Pasif')), '{"opening": true}', '[{"serial_no": "X-1"}]'),
  'not found or inactive');

\echo '--- BP: bulk sale price update'
insert into public.products (brand_id, category, name, sale_price, serial_policy) values
  (t.brand(), 'dome', 'Fiyat A', 1234.56, 'none'),
  (t.brand(), 'dome', 'Fiyat B', 999, 'none');
insert into t.res select 'bp1', to_jsonb(public.update_prices_bulk(array[t.product('Fiyat A'), t.product('Fiyat B')], 'percent', 10, 10));
select t.ok('BP1a +10% rounded to 10 TL: 1360 and 1100',
  (select sale_price from public.products where name = 'Fiyat A') = 1360
  and (select sale_price from public.products where name = 'Fiyat B') = 1100);
select t.ok('BP1b both changes share the returned batch id',
  (select count(*) from public.price_changes where batch_id = (select (v #>> '{}')::uuid from t.res where k = 'bp1')) = 2);
select t.ok('BP1c the batch setting does not outlive the call', coalesce(current_setting('app.price_batch', true), '') = '');

select public.update_prices_bulk(array[t.product('Fiyat A'), t.product('Fiyat B')], 'amount', 250.004);
select t.ok('BP2 +250.004 TL without rounding keeps two decimals: 1610 and 1350',
  (select sale_price from public.products where name = 'Fiyat A') = 1610
  and (select sale_price from public.products where name = 'Fiyat B') = 1350);

select public.update_prices_bulk(array[t.product('Fiyat A')], 'percent', 3.333);
select t.ok('BP3 +3.333% without rounding: 1610 -> 1663.66',
  (select sale_price from public.products where name = 'Fiyat A') = 1663.66);

insert into t.res select 'bp4', to_jsonb(public.update_prices_bulk(array[t.product('Fiyat A'), t.product('Fiyat B')], 'set', 2000));
select t.ok('BP4a set 2000 on both', (select count(*) from public.products where name in ('Fiyat A', 'Fiyat B') and sale_price = 2000) = 2);
select t.ok('BP4b a second identical set changes nothing and returns no batch',
  public.update_prices_bulk(array[t.product('Fiyat A'), t.product('Fiyat B')], 'set', 2000) is null);
select t.ok('BP5a undo of the set batch restores two prices',
  public.undo_price_batch((select (v #>> '{}')::uuid from t.res where k = 'bp4')) = 2);
select t.ok('BP5b ... back to 1663.66 and 1350',
  (select sale_price from public.products where name = 'Fiyat A') = 1663.66
  and (select sale_price from public.products where name = 'Fiyat B') = 1350);

select t.expect_error('BP6a a result of zero or less is refused',
  format('select public.update_prices_bulk(array[%s, %s], ''amount'', -1500)', t.product('Fiyat A'), t.product('Fiyat B')),
  'zero or less');
select t.ok('BP6b ... and no price changed',
  (select sale_price from public.products where name = 'Fiyat A') = 1663.66
  and (select sale_price from public.products where name = 'Fiyat B') = 1350);
select t.expect_error('BP7a an empty product list is refused', 'select public.update_prices_bulk(array[]::bigint[], ''set'', 1)', 'no products');
select t.expect_error('BP7b an unknown mode is refused',
  format('select public.update_prices_bulk(array[%s], ''double'', 1)', t.product('Fiyat A')), 'mode');
select t.expect_error('BP7c rounding to 5 TL is refused',
  format('select public.update_prices_bulk(array[%s], ''percent'', 1, 5)', t.product('Fiyat A')), 'round');
select t.expect_error('BP7d an unknown product is refused', 'select public.update_prices_bulk(array[999999999::bigint], ''set'', 1)', 'not found');

\echo '--- RM: removing stock units'
select public.remove_stock_units(array[t.unit('S7-7')], 'other');
select t.expect_error('RM1a a unit that is no longer in stock cannot be removed',
  format('select public.remove_stock_units(array[%s, %s], ''damaged_lost'')', t.unit('S7-3'), t.unit('S7-7')), 'not in stock');
select t.ok('RM1b ... and the other unit stays in stock', (select status from public.stock_units where serial_no = 'S7-3') = 'in_stock');
select t.expect_error('RM1c an unknown unit is refused', 'select public.remove_stock_units(array[999999999::bigint], ''other'')', 'not in stock');
select t.expect_error('RM1d an unknown reason is refused',
  format('select public.remove_stock_units(array[%s], ''lost'')', t.unit('S7-3')), 'reason');
select t.expect_error('RM1e an empty list is refused', 'select public.remove_stock_units(array[]::bigint[], ''other'')', 'no units');

select t.ok('RM2a two units removed in one call',
  public.remove_stock_units(array[t.unit('S7-1')], 'entry_error', 'Yanlış model') = 1
  and public.remove_stock_units(array[t.unit('S7-2')], 'damaged_lost') = 1);
select t.ok('RM2b the units are removed and the reason, note and user are stored',
  (select count(*) from public.stock_units where serial_no in ('S7-1', 'S7-2') and status = 'removed') = 2
  and (select reason = 'entry_error' and note = 'Yanlış model' and removed_by = '11111111-1111-1111-1111-111111111111'
         from public.stock_removals where stock_unit_id = t.unit('S7-1')));
delete from public.stock_removals;
select t.ok('RM3 removal records cannot be deleted', (select count(*) from public.stock_removals) = 3);

\echo '--- LE: cash ledger (as the admin, who has accounting rights)'
select t.as_user('22222222-2222-2222-2222-222222222222');
select t.ok('LE1 an entry_error removal leaves the ledger',
  not exists (select 1 from public.ledger_entries where source = 'stock_unit' and source_id = t.unit('S7-1')));
select t.ok('LE2 a damaged_lost removal stays in the ledger',
  exists (select 1 from public.ledger_entries where source = 'stock_unit' and source_id = t.unit('S7-2') and amount = 4285.71));
select t.ok('LE3 opening stock never reaches the ledger',
  not exists (select 1 from public.ledger_entries where source = 'stock_unit' and serial_no like 'OPEN-%'));
select t.ok('LE4 the six remaining purchases of the 30000 receipt are listed',
  (select sum(amount) from public.ledger_entries where source = 'stock_unit' and serial_no like 'S7-_'
     and entry_date = '2026-11-01') = 30000 - 4285.71);
select t.ok('LE5 the monthly totals still work', exists (select 1 from public.ledger_monthly where month = '2026-11-01'));
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- SS: stock summary low-stock threshold'
select public.create_stock_receipt(
  jsonb_build_object('brand_id', t.brand(), 'category', 'dome', 'name', 'Eşik Dome', 'serial_policy', 'none', 'min_stock', 2),
  '{"opening": true}', '[{}, {}]');
select t.ok('SS1 in stock equal to the minimum is low',
  (select in_stock = 2 and stock_level = 'low' from public.stock_summary where product_id = t.product('Eşik Dome')));
select public.create_stock_receipt(jsonb_build_object('id', t.product('Eşik Dome')), '{"opening": true}', '[{}]');
select t.ok('SS2 one above the minimum is ok', (select stock_level from public.stock_summary where product_id = t.product('Eşik Dome')) = 'ok');
select t.ok('SS3 nothing in stock is still out',
  (select stock_level from public.stock_summary where product_id = t.product('Model Pasif')) = 'out');

\echo '--- PH: product photos'
insert into public.product_photos (product_id, storage_path) values (t.product('Model 7'), 'products/010/a.webp');
delete from public.product_photos where storage_path = 'products/010/a.webp';
select t.ok('PH1 staff can delete a product photo row',
  not exists (select 1 from public.product_photos where storage_path = 'products/010/a.webp'));

\echo '--- G: grants'
reset role;
select t.ok('G1 signed-in users can call the three functions',
  has_function_privilege('authenticated', 'public.create_stock_receipt(jsonb, jsonb, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.update_prices_bulk(bigint[], text, numeric, numeric)', 'execute')
  and has_function_privilege('authenticated', 'public.remove_stock_units(bigint[], text, text)', 'execute'));
set role anon;
select t.expect_error('G2 anon cannot enter stock', 'select public.create_stock_receipt(''{}'', ''{}'', ''[]'')', 'permission denied');
select t.expect_error('G3 anon cannot change prices', 'select public.update_prices_bulk(array[1::bigint], ''set'', 1)', 'permission denied');
select t.expect_error('G4 anon cannot remove stock', 'select public.remove_stock_units(array[1::bigint], ''other'')', 'permission denied');
reset role;

\echo '--- SV: service price list'
select t.ok('SV1 the 18 services from the design are seeded (13 service, 5 audiology exam)',
  (select count(*) from public.services where category = 'service' and name in
     ('Kalıp ücreti', 'Kalıp montaj', 'Receiver', 'Receiver Montaj', 'Cihaz Bakım', 'Cihaz Tamir', 'Teknik Servis',
      'Hoparlör Değişimi', 'Mikrofon Değişimi', 'Pil Ölçer', 'Filtre', 'Boynuz', 'Pil kapağı')) = 13
  and (select count(*) from public.services where category = 'audiology_exam' and name in
     ('Cihaz Programlama', 'İşitme Testi', 'Odyolojik Muayene', 'REM (Gerçek Kulak Ölçümü)',
      'Evde Hizmet Bedeli (Mücbir sebep dahilinde)')) = 5);
select t.ok('SV2 prices follow the design',
  (select sum(price) from public.services where category = 'service') = 42500
  and (select price from public.services where name = 'Odyolojik Muayene') = 15000);
