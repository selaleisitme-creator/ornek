-- Tests for 016_sales.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
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
create function t.service(n text) returns bigint language sql stable as $$ select id from public.services where name = n $$;
create function t.today() returns date language sql stable as $$ select (now() at time zone 'Europe/Istanbul')::date $$;
create function t.sale(k text) returns bigint language sql stable as $$ select (v #>> '{}')::bigint from t.res where res.k = sale.k $$;
create function t.item(serial text) returns bigint language sql stable as $$
  select si.id from public.sale_items si join public.stock_units u on u.id = si.stock_unit_id where u.serial_no = serial
$$;
create function t.sale_sql(s jsonb, i jsonb, p jsonb default '[]', k jsonb default '[]') returns text language sql stable as $$
  select format('select public.create_sale(%L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb)', s, i, p, k)
$$;

create table t.res (k text primary key, v jsonb);
grant all on t.res to authenticated;
grant execute on all functions in schema t to anon, authenticated;

select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.brands (name) values ('Satış Test');
insert into public.products (brand_id, category, name, sale_price, purchase_price, serial_policy, unit, pack_size)
select id, c, n, sp, pp, pol, u, ps from public.brands,
  (values ('device', 'Satış Cihaz', 30000, 18000, 'required', 'piece', null::int),
          ('battery', 'Satış Pil', 120, 40, 'none', 'pack', 6),
          ('dome', 'Satış Kubbe', 50, 10, 'none', 'piece', null)) v(c, n, sp, pp, pol, u, ps)
where name = 'Satış Test';
insert into public.stock_units (product_id, serial_no, ear_side) values
  (t.product('Satış Cihaz'), 'ST-R', 'right'), (t.product('Satış Cihaz'), 'ST-L', 'left'),
  (t.product('Satış Cihaz'), 'ST-W1', 'right'), (t.product('Satış Cihaz'), 'ST-W2', 'left');
insert into public.stock_units (product_id) select t.product('Satış Pil') from generate_series(1, 3);
insert into public.stock_units (product_id) select t.product('Satış Kubbe') from generate_series(1, 1);
insert into public.services (category, name, price) values ('service', 'Satış Servis', 1000);
insert into public.patients (full_name, phone, record_type) values ('Satış Hasta', '+905550002222', 'candidate');

set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- S: retail sale'
insert into t.res select 's1', to_jsonb(public.create_sale(
  jsonb_build_object('patient_id', t.patient('Satış Hasta'), 'sale_date', t.today() - 1, 'discount', 1000,
                     'sgk_amount', 10000, 'invoice_mode', 'single', 'invoice_no', 'SF-001'),
  jsonb_build_array(
    jsonb_build_object('stock_unit_id', t.unit('ST-R'), 'unit_price', 30000, 'tax_rate', 0, 'ear_side', 'right',
                       'uts_report_no', 'UTS-1', 'warranty_end', t.today() + 729),
    jsonb_build_object('stock_unit_id', t.unit('ST-L'), 'unit_price', 30000, 'tax_rate', 0, 'ear_side', 'left'),
    jsonb_build_object('product_id', t.product('Satış Pil'), 'quantity', 2, 'unit_price', 120, 'tax_rate', 20),
    jsonb_build_object('service_id', t.service('Satış Servis'), 'unit_price', 1000, 'tax_rate', 20, 'service_note', 'Filtre'),
    jsonb_build_object('custom_service', jsonb_build_object('name', 'Özel Temizlik'), 'unit_price', 500, 'tax_rate', 10)),
  jsonb_build_array(jsonb_build_object('payment_method', 'card_pos', 'amount', 40000, 'installments', 3)),
  '["uts", "kolaysoft"]'));
select t.ok('S1a the sale is retail, dated yesterday, with its discount and SGK amount',
  (select sale_kind = 'retail' and sale_date = t.today() - 1 and discount = 1000 and sgk_amount = 10000
     from public.sales where id = t.sale('s1')));
select t.ok('S1b six items: two devices, two battery packs, two services',
  (select count(*) from public.sale_items where sale_id = t.sale('s1')) = 6);
select t.ok('S1c the devices and the two oldest battery packs are sold, the third pack stays',
  (select status from public.stock_units where serial_no = 'ST-L') = 'sold'
  and (select count(*) from public.stock_units where product_id = t.product('Satış Pil') and status = 'sold') = 2
  and (select status from public.stock_units where product_id = t.product('Satış Pil') order by id desc limit 1) = 'in_stock');
select t.ok('S1d a typed-in service is kept as an inactive service',
  (select not active and price = 500 from public.services where name = 'Özel Temizlik'));
select t.ok('S1e one invoice covers every item',
  (select count(*) from public.invoices where sale_id = t.sale('s1')) = 1
  and not exists (select 1 from public.sale_items where sale_id = t.sale('s1') and invoice_id is null));
select t.ok('S1f two post-sale sites are ticked', (select count(*) from public.sale_tasks where sale_id = t.sale('s1')) = 2);
select t.ok('S1g the candidate became a patient', (select record_type from public.patients where id = t.patient('Satış Hasta')) = 'patient');
select t.ok('S1h prices include VAT: total 61740 - 1000 discount = 60740',
  public.sale_total(t.sale('s1')) = 60740);
select t.ok('S1i the VAT inside a 120 TL pack at 20% is about 20 TL (after its discount share)',
  (select vat_amount between 19.5 and 20 from public.sale_item_values
    where sale_item_id = (select min(si.id) from public.sale_items si join public.stock_units u on u.id = si.stock_unit_id
                            where si.sale_id = t.sale('s1') and u.product_id = t.product('Satış Pil'))));
select t.ok('S1j the device keeps its side, ÜTS number and warranty',
  (select ear_side = 'right' and uts_report_no = 'UTS-1' and warranty_start = t.today() - 1 and warranty_end = t.today() + 729
     from public.sale_items where id = t.item('ST-R')));

select t.expect_error('S2 a hearing aid cannot carry VAT',
  t.sale_sql(jsonb_build_object('patient_id', t.patient('Satış Hasta')),
             jsonb_build_array(jsonb_build_object('stock_unit_id', t.unit('ST-W1'), 'unit_price', 1, 'tax_rate', 20))), 'hearing aid');
select t.expect_error('S3 more packs than the shelf has are refused',
  t.sale_sql(jsonb_build_object('patient_id', t.patient('Satış Hasta')),
             jsonb_build_array(jsonb_build_object('product_id', t.product('Satış Pil'), 'quantity', 5, 'unit_price', 1, 'tax_rate', 20))), 'enough');
select t.expect_error('S4 a sale date in the future is refused',
  t.sale_sql(jsonb_build_object('patient_id', t.patient('Satış Hasta'), 'sale_date', t.today() + 1),
             jsonb_build_array(jsonb_build_object('stock_unit_id', t.unit('ST-W1'), 'unit_price', 1, 'tax_rate', 0))), 'future');
select t.expect_error('S5 a payment above the patient share is refused',
  t.sale_sql(jsonb_build_object('patient_id', t.patient('Satış Hasta')),
             jsonb_build_array(jsonb_build_object('stock_unit_id', t.unit('ST-W1'), 'unit_price', 100, 'tax_rate', 0)),
             '[{"payment_method": "cash", "amount": 150}]'), 'exceed');
select t.expect_error('S6 an unknown tax rate is refused',
  t.sale_sql(jsonb_build_object('patient_id', t.patient('Satış Hasta')),
             jsonb_build_array(jsonb_build_object('service_id', t.service('Satış Servis'), 'unit_price', 1, 'tax_rate', 18))), 'tax');
select t.ok('S7 the refused sales left nothing behind',
  (select status from public.stock_units where serial_no = 'ST-W1') = 'in_stock'
  and (select count(*) from public.sales where patient_id = t.patient('Satış Hasta')) = 1);

\echo '--- W: wholesale sale'
insert into t.res select 'w1', to_jsonb(public.create_sale(
  jsonb_build_object('kind', 'wholesale', 'customer_name', 'Örnek İşitme Merkezi', 'customer_phone', '+902120000000',
                     'invoice_mode', 'per_item'),
  jsonb_build_array(
    jsonb_build_object('stock_unit_id', t.unit('ST-W1'), 'unit_price', 25000, 'tax_rate', 0, 'invoice_no', 'TF-1'),
    jsonb_build_object('stock_unit_id', t.unit('ST-W2'), 'unit_price', 25000, 'tax_rate', 0, 'invoice_no', 'TF-2')),
  '[]', '["kolaysoft"]'));
select t.ok('W1a a wholesale sale has no patient and keeps the customer',
  (select sale_kind = 'wholesale' and patient_id is null and customer_name = 'Örnek İşitme Merkezi' from public.sales where id = t.sale('w1')));
select t.ok('W1b one invoice per item', (select count(*) from public.invoices where sale_id = t.sale('w1')) = 2);
select t.ok('W1c it shows up in the sale report', exists (select 1 from public.sale_report where sale_id = t.sale('w1')));
select t.expect_error('W2 a wholesale sale takes no services',
  t.sale_sql('{"kind": "wholesale", "customer_name": "X"}',
             jsonb_build_array(jsonb_build_object('service_id', t.service('Satış Servis'), 'unit_price', 1, 'tax_rate', 20))), 'wholesale');
select t.expect_error('W3 a wholesale sale takes no SGK amount',
  t.sale_sql('{"kind": "wholesale", "customer_name": "X", "sgk_amount": 10}',
             jsonb_build_array(jsonb_build_object('product_id', t.product('Satış Kubbe'), 'quantity', 1, 'unit_price', 50, 'tax_rate', 20))), 'SGK');

\echo '--- F: post-sale follow-up'
select public.update_sale_followup(t.sale('s1'),
  jsonb_build_array(jsonb_build_object('sale_item_id', t.item('ST-L'), 'uts_report_no', 'UTS-2', 'warranty_end', t.today() + 700)),
  'SF-002', '{"kolaysoft": false, "wsa": true}');
select t.ok('F1a the item gets its ÜTS number and warranty',
  (select uts_report_no = 'UTS-2' and warranty_end = t.today() + 700 from public.sale_items where id = t.item('ST-L')));
select t.ok('F1b the single invoice number is corrected in place',
  (select array_agg(invoice_no) = array['SF-002'] from public.invoices where sale_id = t.sale('s1')));
select t.ok('F1c Kolaysoft is unticked and WSA ticked',
  (select array_agg(l.system_key order by l.system_key) from public.sale_tasks st join public.links l on l.id = st.link_id
    where st.sale_id = t.sale('s1')) = array['uts', 'wsa']);
select t.expect_error('F2 an item of another sale is refused',
  format('select public.update_sale_followup(%s, %L::jsonb, null, null)', t.sale('w1'),
         jsonb_build_array(jsonb_build_object('sale_item_id', t.item('ST-L'), 'uts_report_no', 'X'))), 'not part of');

\echo '--- R: refund'
insert into t.res select 'r1', to_jsonb(public.create_refund(t.item('ST-R'), 30000, 'card_pos', 'Memnun kalmadı', true, t.today()));
select t.ok('R1 the refunded device is back in stock', (select status from public.stock_units where serial_no = 'ST-R') = 'in_stock');
select t.expect_error('R2 a refund dated in the future is refused',
  format('select public.create_refund(%s, 1, ''cash'', null, true, %L::date)', t.item('ST-L'), t.today() + 1), 'future');
select t.expect_error('R3 a refund above the item value is refused',
  format('select public.create_refund(%s, 99999, ''cash'', null, true, null)', t.item('ST-L')), 'more than');

\echo '--- G: grants'
reset role;
select t.ok('G1 anon cannot run the three functions',
  not has_function_privilege('anon', 'public.create_sale(jsonb, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.update_sale_followup(bigint, jsonb, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.create_refund(bigint, numeric, text, text, boolean, date)', 'execute'));
