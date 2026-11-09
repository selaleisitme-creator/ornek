-- Tests for 008_design_gaps.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
-- Runs after 007_integrity_test.sql in the same database, so every id is looked up by name.
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
create function t.patient(n text) returns bigint language sql stable as $$ select id from public.patients where full_name = n $$;

grant execute on all functions in schema t to anon, authenticated;

-- Users: 1111 staff, 2222 admin (from the stub), 3333 intern, 4444 staff whose access ended yesterday.
select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.profiles (id, full_name, role) values ('33333333-3333-3333-3333-333333333333', 'Stajyer 2', 'intern');
insert into public.profiles (id, full_name, role, access_until)
values ('44444444-4444-4444-4444-444444444444', 'Eski stajyer', 'staff', current_date - 1);

\echo '--- R: roles, access end date, permission guard'
select t.ok('R1 the intern role is accepted', exists (select 1 from public.profiles where role = 'intern'));
select t.expect_error('R2 an intern cannot get the accounting permission',
  'update public.profiles set can_view_accounting = true where role = ''intern''', 'profiles_intern_limits');
select t.expect_error('R3 an intern cannot get the national ID permission',
  'update public.profiles set can_view_national_id = true where role = ''intern''', 'profiles_intern_limits');
select t.ok('R4 profiles.last_login_at is gone',
  not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'last_login_at'));

set role authenticated;
select t.as_user('33333333-3333-3333-3333-333333333333');
select t.ok('R5 an intern counts as active staff', public.is_active_staff());
select t.as_user('44444444-4444-4444-4444-444444444444');
select t.ok('R6 a user whose access ended yesterday is no longer staff', not public.is_active_staff());
select t.ok('R7 ... and sees no data', (select count(*) from public.brands) = 0);

select t.as_user('11111111-1111-1111-1111-111111111111');
reset role;
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.expect_error('R8 staff cannot make themselves admin',
  'update public.profiles set role = ''admin'' where id = ''11111111-1111-1111-1111-111111111111''', 'only an admin');
select t.expect_error('R9 staff cannot give themselves the accounting permission',
  'update public.profiles set can_view_accounting = true where id = ''11111111-1111-1111-1111-111111111111''', 'only an admin');
select t.as_user('22222222-2222-2222-2222-222222222222');
update public.profiles set access_until = current_date + 30 where id = '33333333-3333-3333-3333-333333333333';
select t.ok('R10 an admin can set an intern''s access end date',
  (select access_until from public.profiles where id = '33333333-3333-3333-3333-333333333333') = current_date + 30);
set role authenticated;

\echo '--- ST: settings'
select t.as_user('33333333-3333-3333-3333-333333333333');
update public.settings set maintenance_interval_months = 12;
select t.ok('ST1 an intern can change settings', (select maintenance_interval_months from public.settings) = 12);
select t.expect_error('ST2 an intern cannot change the auto sign-out time',
  'update public.settings set idle_logout_minutes = 600', 'only an admin');
select t.as_user('22222222-2222-2222-2222-222222222222');
update public.settings set idle_logout_minutes = 15;
select t.ok('ST3 an admin can change the auto sign-out time', (select idle_logout_minutes from public.settings) = 15);
update public.settings set maintenance_interval_months = 6;

\echo '--- S: serial number policy'
insert into public.brands (name) values ('Rayovac');
insert into public.products (brand_id, category, name, unit, pack_size, packs_per_box, boxes_per_carton, serial_policy, min_stock)
select id, 'battery', 'Pil 312', 'pack', 6, 10, 10, 'required', 30 from public.brands where name = 'Rayovac';
insert into public.products (brand_id, category, name, serial_policy)
select id, 'dome', 'Open 8 mm', 'none' from public.brands where name = 'Rayovac';
insert into public.products (brand_id, category, name, serial_policy)
select id, 'receiver', 'Receiver M', 'optional' from public.brands where name = 'Rayovac';
select t.expect_error('S1 a required serial number cannot be left empty',
  format('insert into public.stock_units (product_id) values (%s)', t.product('Pil 312')), 'serial number');
insert into public.stock_units (product_id) values (t.product('Receiver M'));
select t.ok('S2 an optional serial number may be empty', exists (select 1 from public.stock_units where product_id = t.product('Receiver M') and serial_no is null));
insert into public.stock_units (product_id) values (t.product('Open 8 mm')), (t.product('Open 8 mm'));
select t.ok('S3 several units without a serial number are allowed', (select count(*) from public.stock_units where product_id = t.product('Open 8 mm')) = 2);
select t.expect_error('S4 a product without serial numbers refuses one',
  format('insert into public.stock_units (product_id, serial_no) values (%s, ''X1'')', t.product('Open 8 mm')), 'serial number');

\echo '--- V1: stock summary (25 battery packs, 10 per box, 10 boxes per carton, 6 batteries per pack)'
insert into public.stock_units (product_id, serial_no) select t.product('Pil 312'), 'PIL-' || g from generate_series(1, 25) g;
select t.ok('V1a 25 packs, 2 boxes, 0 cartons, 150 batteries',
  (select in_stock = 25 and boxes = 2 and cartons = 0 and total_batteries = 150 from public.stock_summary where product_id = t.product('Pil 312')));
select t.ok('V1b 25 packs is below the minimum of 30, so the level is low',
  (select stock_level from public.stock_summary where product_id = t.product('Pil 312')) = 'low');

\echo '--- P: a bulk price change can be undone'
select set_config('app.price_batch', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false);
update public.products set sale_price = 150 where name = 'Pil 312';
update public.products set sale_price = 40 where name = 'Open 8 mm';
select set_config('app.price_batch', '', false);
select t.ok('P1 both changes carry the batch id',
  (select count(*) from public.price_changes where batch_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 2);
-- Separate statements: one SQL statement does not see the changes a function made inside it.
select t.ok('P2a undo reports two restored prices', public.undo_price_batch('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') = 2);
select t.ok('P2b both prices are back to 0',
  (select sale_price from public.products where name = 'Pil 312') = 0
  and (select sale_price from public.products where name = 'Open 8 mm') = 0);
select set_config('app.price_batch', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
update public.products set sale_price = 200 where name = 'Pil 312';
select set_config('app.price_batch', '', false);
update public.products set sale_price = 210 where name = 'Pil 312';
select t.expect_error('P3 undo refuses when the price was changed again later',
  'select public.undo_price_batch(''bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'')', 'changed again');

\echo '--- C, PM, L: customer fields, payment method, links'
insert into public.patients (full_name, phone) values ('Zeynep Ak', '05550001122');
select t.expect_error('C1 a patient sale cannot also carry a typed customer name',
  format('insert into public.sales (patient_id, customer_name) values (%s, ''Başka biri'')', t.patient('Zeynep Ak')), 'sales_customer_only_without_patient');
select t.ok('PM1 card payments are called "Kart (POS)"', (select name from public.payment_methods where code = 'card_pos') = 'Kart (POS)');
select t.ok('L1 the ten links from the design exist', (select count(*) from public.links) = 10);
select t.ok('L2 links follow the design names',
  (select name from public.links where system_key = 'uts') = 'Ürün Takip Sistemi'
  and (select name from public.links where system_key = 'wsa') = 'WSA Garanti Takip');

\echo '--- LG: legacy sales (devices sold before the panel)'
insert into public.brands (name) values ('Bernafon');
insert into public.products (brand_id, category, name, sale_price, active)
select id, 'device', 'Eski Model', 0, false from public.brands where name = 'Bernafon';
insert into public.stock_units (product_id, serial_no, ear_side) values (t.product('Eski Model'), 'OLD-1', 'right');
insert into public.sales (patient_id, sale_kind, sale_date) values (t.patient('Zeynep Ak'), 'legacy', '2024-03-01');
insert into public.sale_items (sale_id, stock_unit_id, unit_price, warranty_start, warranty_end)
select s.id, u.id, 25000, '2024-03-01', '2026-03-01'
from public.sales s, public.stock_units u where s.sale_kind = 'legacy' and u.serial_no = 'OLD-1';
select t.ok('LG1 the old device is now sold', (select status from public.stock_units where serial_no = 'OLD-1') = 'sold');
select t.ok('LG2 a legacy sale is not in the sales report', not exists (select 1 from public.sale_report where serial_no = 'OLD-1'));
select t.ok('LG3 a legacy sale is not a receivable', not exists (select 1 from public.receivables r join public.sales s on s.id = r.sale_id where s.sale_kind = 'legacy'));
select t.expect_error('LG4 a legacy sale takes no payments',
  'insert into public.sale_payments (sale_id, payment_method, amount) select id, ''cash'', 1 from public.sales where sale_kind = ''legacy''', 'legacy');

\echo '--- PO: patient overview'
insert into public.patients (full_name, phone) values ('Kemal Er', '05550003344'), ('Aday Kişi', '05550005566');
update public.patients set record_type = 'candidate' where full_name = 'Aday Kişi';
insert into public.products (brand_id, category, name, sale_price)
select id, 'device', 'Yeni Model', 30000 from public.brands where name = 'Bernafon';
insert into public.stock_units (product_id, serial_no, ear_side) values (t.product('Yeni Model'), 'NEW-R', 'right');
insert into public.sales (patient_id, sale_date) values (t.patient('Kemal Er'), current_date - 10);
insert into public.sale_items (sale_id, stock_unit_id, unit_price, warranty_end)
select s.id, u.id, 30000, current_date + 720 from public.sales s, public.stock_units u
where s.patient_id = t.patient('Kemal Er') and u.serial_no = 'NEW-R';
select t.ok('PO1 a device sold 10 days ago means adaptation',
  (select status from public.patient_overview where patient_id = t.patient('Kemal Er')) = 'adaptation');
select t.ok('PO2 the right ear device is listed',
  (select right_device from public.patient_overview where patient_id = t.patient('Kemal Er')) like 'Bernafon Yeni Model%NEW-R%');
select t.ok('PO3 an old device past its warranty and maintenance window',
  (select status from public.patient_overview where patient_id = t.patient('Zeynep Ak')) = 'maintenance_due');
select t.ok('PO4 a candidate stays a candidate',
  (select status from public.patient_overview where patient_id = t.patient('Aday Kişi')) = 'candidate');
-- Ayşe (from the 007 test) returned her only device, so she has none left.
select t.ok('PO5 a patient whose device was returned has no device and is new',
  (select status from public.patient_overview where patient_id = t.patient('Ayşe Kaya')) = 'new');

\echo '--- TC: national ID helpers are functions now (no Security Definer View warning)'
select t.ok('TC1 the two views are gone',
  to_regclass('public.patient_national_id_presence') is null and to_regclass('public.patient_national_id_last4') is null);
select t.ok('TC2 the admin gets last four digits', (select last4 from public.national_id_last4(array[1::bigint])) = '1234');
select t.as_user('33333333-3333-3333-3333-333333333333');
select t.ok('TC3 an intern sees whether an ID exists', (select count(*) from public.national_id_presence(array[1::bigint, 2::bigint])) = 2);
select t.expect_error('TC4 an intern cannot get last four digits', 'select * from public.national_id_last4(array[1::bigint])', 'not allowed');
set role anon;
select t.expect_error('TC5 anon cannot call the presence function', 'select * from public.national_id_presence(array[1::bigint])', 'permission denied');

\echo '--- SB: storage buckets'
reset role;
select t.ok('SB1 three buckets, two of them public',
  (select count(*) from storage.buckets where id in ('product-photos', 'source-icons', 'backups')) = 3
  and (select count(*) from storage.buckets where public) = 2);
set role authenticated;
select t.as_user('33333333-3333-3333-3333-333333333333');
insert into storage.objects (bucket_id, name) values ('product-photos', 'products/1/a.webp');
select t.ok('SB2 staff can upload a product photo', exists (select 1 from storage.objects where name = 'products/1/a.webp'));
select t.expect_error('SB3 staff cannot write into backups',
  'insert into storage.objects (bucket_id, name) values (''backups'', ''x.xlsx'')', 'row-level security');
set role anon;
select t.expect_error('SB4 anon cannot upload',
  'insert into storage.objects (bucket_id, name) values (''product-photos'', ''y.webp'')', 'row-level security');

reset role;
