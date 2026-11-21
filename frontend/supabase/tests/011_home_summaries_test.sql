-- Tests for 011_home_summaries.sql (the home page's chart and table numbers). Each check prints PASS or FAIL;
-- an ERROR line is also a failure. Runs after the earlier tests in the same database, so its own records use
-- the year 2030 and new names, and the all-time numbers are checked as the change they cause.
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

create function t.patient(n text) returns bigint language sql stable as $$ select id from public.patients where full_name = n $$;
create function t.source(n text) returns bigint language sql stable as $$ select id from public.referral_sources where name = n $$;
create function t.service() returns bigint language sql stable as $$ select min(id) from public.services $$;
create function t.kind() returns bigint language sql stable as $$ select id from public.appointment_kinds where key = 'checkup' $$;

-- Numbers read before the 2030 records go in, to check the all-time results by their change.
create table t.res (k text primary key, v numeric);
grant all on t.res to authenticated;
grant execute on all functions in schema t to anon, authenticated;

select t.as_user('22222222-2222-2222-2222-222222222222');
insert into t.res select 'total_amount', amount from public.home_sales_total();
insert into t.res select 'total_sales', sale_count from public.home_sales_total();
insert into t.res values
  ('transfer', coalesce((select payments from public.home_payment_methods() where code = 'transfer'), 0)),
  ('cash',     coalesce((select payments from public.home_payment_methods() where code = 'cash'), 0));

\echo '--- setup: patients, appointments, sales in 2030'
insert into public.referral_sources (name) values ('Kaynak 011 A'), ('Kaynak 011 B');
insert into public.patients (full_name, phone, registered_on, referral_source_id) values
  ('Hasta 011 Yeni',    '05550110001', '2030-01-20', t.source('Kaynak 011 B')),  -- new patient
  ('Hasta 011 Eski',    '05550110002', '2020-01-01', null),                     -- typed in from before the panel
  ('Hasta 011 Gecmis',  '05550110003', '2030-02-01', null),                     -- has a past (legacy) device
  ('Hasta 011 Gelmedi', '05550110004', '2030-02-01', null);
insert into public.sales (patient_id, sale_kind, sale_date) values (t.patient('Hasta 011 Gecmis'), 'legacy', '2030-02-05');

insert into public.appointments (patient_id, kind_id, starts_at, ends_at, status, cancelled_at, referral_source_id) values
  -- First visit without a source on the appointment: the patient's source (B) counts.
  (t.patient('Hasta 011 Yeni'), t.kind(), '2030-02-01 10:00+03', '2030-02-01 10:30+03', 'attended', null, null),
  (t.patient('Hasta 011 Yeni'), t.kind(), '2030-03-05 10:00+03', '2030-03-05 10:30+03', 'attended', null, t.source('Kaynak 011 A')),
  -- A cancelled appointment is never the first one.
  (t.patient('Hasta 011 Eski'), t.kind(), '2030-02-10 10:00+03', '2030-02-10 10:30+03', 'cancelled', '2030-02-09 12:00+03', t.source('Kaynak 011 B')),
  -- 00:30 on 1 March in Istanbul is still 28 February in UTC: it belongs to March.
  (t.patient('Hasta 011 Eski'), t.kind(), '2030-03-01 00:30+03', '2030-03-01 01:00+03', 'attended', null, t.source('Kaynak 011 A')),
  (t.patient('Hasta 011 Gecmis'), t.kind(), '2030-02-15 10:00+03', '2030-02-15 10:30+03', 'attended', null, t.source('Kaynak 011 A')),
  (t.patient('Hasta 011 Gelmedi'), t.kind(), '2030-02-20 10:00+03', '2030-02-20 10:30+03', 'no_show', null, t.source('Kaynak 011 A'));

insert into public.sales (patient_id, sale_date) values (t.patient('Hasta 011 Yeni'), '2030-02-10');
insert into public.sales (patient_id, sale_date, sgk_amount) values (t.patient('Hasta 011 Eski'), '2030-03-31', 500);
insert into public.sale_items (sale_id, service_id, unit_price)
  select s.id, t.service(), p from public.sales s, unnest(array[1000, 500]) p
  where s.patient_id = t.patient('Hasta 011 Yeni') and s.sale_date = '2030-02-10';
insert into public.sale_items (sale_id, service_id, unit_price)
  select s.id, t.service(), 2000 from public.sales s where s.patient_id = t.patient('Hasta 011 Eski') and s.sale_date = '2030-03-31';
insert into public.sale_payments (sale_id, payment_method, amount, paid_on)
  select s.id, m, a, '2030-02-10' from public.sales s, (values ('transfer', 600), ('cash', 400)) v(m, a)
  where s.patient_id = t.patient('Hasta 011 Yeni') and s.sale_date = '2030-02-10';
insert into public.sale_payments (sale_id, payment_method, amount, paid_on, payer)
  select s.id, 'transfer', a, '2030-04-01', payer from public.sales s, (values (1500, 'patient'), (500, 'sgk')) v(a, payer)
  where s.patient_id = t.patient('Hasta 011 Eski') and s.sale_date = '2030-03-31';
-- A 300 TL money-only refund on the 500 TL item, in April.
insert into public.refunds (sale_item_id, amount, payment_method, refunded_on, returns_device)
  select si.id, 300, 'cash', '2030-04-02', false from public.sale_items si join public.sales s on s.id = si.sale_id
  where s.patient_id = t.patient('Hasta 011 Yeni') and si.unit_price = 500;

-- Everything below runs as the staff member without accounting rights, through RLS.
set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- S: monthly sales'
select t.ok('S1 February: 1500 TL in one sale',
  exists (select 1 from public.home_sales_monthly('2030-01-01') where month = '2030-02-01' and amount = 1500 and sale_count = 1));
select t.ok('S2 March: 2000 TL in one sale',
  exists (select 1 from public.home_sales_monthly('2030-01-01') where month = '2030-03-01' and amount = 2000 and sale_count = 1));
select t.ok('S3 the refund comes off in its own month (April: -300, no sale)',
  exists (select 1 from public.home_sales_monthly('2030-01-01') where month = '2030-04-01' and amount = -300 and sale_count = 0));
select t.ok('S4 the legacy sale is not counted and January has no row',
  (select count(*) from public.home_sales_monthly('2030-01-01')) = 3);
select t.ok('S5 all-time total grows by 3200 TL (1500 + 2000 - 300)',
  (select amount from public.home_sales_total()) - (select v from t.res where k = 'total_amount') = 3200);
select t.ok('S6 all-time sale count grows by 2',
  (select sale_count from public.home_sales_total()) - (select v from t.res where k = 'total_sales') = 2);

\echo '--- V: new and returning visits'
select t.ok('V1 February: one new patient, one returning (past device)',
  exists (select 1 from public.home_visits_monthly('2030-01-01') where month = '2030-02-01' and new_patients = 1 and returning_patients = 1));
select t.ok('V2 March: two returning (second visit; registered long before), the 00:30 visit included',
  exists (select 1 from public.home_visits_monthly('2030-01-01') where month = '2030-03-01' and new_patients = 0 and returning_patients = 2));
select t.ok('V3 a no-show is not a visit',
  (select sum(new_patients + returning_patients) from public.home_visits_monthly('2030-01-01')) = 4);

\echo '--- P: payment methods'
select t.ok('P1 two more patient transfers (the SGK transfer is not counted)',
  (select payments from public.home_payment_methods() where code = 'transfer') - (select v from t.res where k = 'transfer') = 2);
select t.ok('P2 one more cash payment',
  (select payments from public.home_payment_methods() where code = 'cash') - (select v from t.res where k = 'cash') = 1);
select t.ok('P3 names come with the codes',
  (select name from public.home_payment_methods() where code = 'cash') = 'Nakit');

\echo '--- R: referral sources (each patient once, by the first appointment)'
select t.ok('R1 source B: the new patient, through the patient record, attended',
  exists (select 1 from public.home_referral_counts() where source_id = t.source('Kaynak 011 B')
          and total = 1 and attended = 1 and no_show = 0 and waiting = 0));
select t.ok('R2 source A: three first appointments, two attended, one no-show (second visits and the cancelled one left out)',
  exists (select 1 from public.home_referral_counts() where source_id = t.source('Kaynak 011 A')
          and total = 3 and attended = 2 and no_show = 1 and waiting = 0));

\echo '--- G: who may call them'
reset role;
set role anon;
select t.expect_error('G1 signed-out visitors cannot read the sales summary', 'select * from public.home_sales_monthly(''2030-01-01'')', 'permission denied');
select t.expect_error('G2 signed-out visitors cannot read the referral counts', 'select * from public.home_referral_counts()', 'permission denied');
reset role;
