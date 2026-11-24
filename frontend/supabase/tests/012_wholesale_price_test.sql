-- Tests for 012_wholesale_price.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
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
create function t.wholesale(n text) returns numeric language sql stable as $$ select wholesale_price from public.products where name = n $$;
create function t.sale(n text) returns numeric language sql stable as $$ select sale_price from public.products where name = n $$;

create table t.res (k text primary key, v jsonb);
grant all on t.res to authenticated;
grant execute on all functions in schema t to anon, authenticated;

select t.as_user('22222222-2222-2222-2222-222222222222');
insert into public.brands (name) values ('Toptan Test');

set role authenticated;
select t.as_user('11111111-1111-1111-1111-111111111111');

\echo '--- W: the wholesale price column'
insert into public.products (brand_id, category, name, sale_price, wholesale_price, serial_policy)
select id, 'dome', 'Toptan A', 1000, 800, 'none' from public.brands where name = 'Toptan Test';
insert into public.products (brand_id, category, name, sale_price, serial_policy)
select id, 'dome', 'Toptan B', 500, 'none' from public.brands where name = 'Toptan Test';
select t.ok('W1a a model keeps its wholesale price', t.wholesale('Toptan A') = 800);
select t.ok('W1b a model may have no wholesale price yet', t.wholesale('Toptan B') is null);
select t.expect_error('W1c a negative wholesale price is refused',
  format('update public.products set wholesale_price = -1 where id = %s', t.product('Toptan A')), 'check');

\echo '--- WE: a new model from the stock entry keeps its wholesale price'
insert into t.res select 'we1', public.create_stock_receipt(
  jsonb_build_object('brand_id', (select id from public.brands where name = 'Toptan Test'), 'category', 'dome',
                     'name', 'Toptan Giriş', 'sale_price', 300, 'wholesale_price', 240, 'serial_policy', 'none'),
  '{"opening": true}', '[{}]');
select t.ok('WE1 the new model has wholesale price 240', t.wholesale('Toptan Giriş') = 240);
insert into t.res select 'we2', public.create_stock_receipt(
  jsonb_build_object('brand_id', (select id from public.brands where name = 'Toptan Test'), 'category', 'dome',
                     'name', 'Toptan Boş', 'sale_price', 300, 'serial_policy', 'none'),
  '{"opening": true}', '[{}]');
select t.ok('WE2 without a wholesale price the column stays empty', t.wholesale('Toptan Boş') is null);

\echo '--- WP: bulk wholesale price update'
insert into t.res select 'wp1', to_jsonb(public.update_prices_bulk(array[t.product('Toptan A')], 'percent', 10, 10, 'wholesale'));
select t.ok('WP1a +10% on the wholesale price: 800 -> 880', t.wholesale('Toptan A') = 880);
select t.ok('WP1b ... and the sale price is untouched', t.sale('Toptan A') = 1000);
select t.ok('WP1c the change is logged as a wholesale price change in the batch',
  (select count(*) from public.price_changes
    where batch_id = (select (v #>> '{}')::uuid from t.res where k = 'wp1')
      and price_field = 'wholesale' and old_price = 800 and new_price = 880) = 1);

select public.update_prices_bulk(array[t.product('Toptan A')], 'percent', 10, 10);
select t.ok('WP2 without the new argument the sale price changes, as before: 1000 -> 1100',
  t.sale('Toptan A') = 1100 and t.wholesale('Toptan A') = 880);

select t.ok('WP3a undo puts the wholesale price back',
  public.undo_price_batch((select (v #>> '{}')::uuid from t.res where k = 'wp1')) = 1);
select t.ok('WP3b ... to 800, the sale price stays 1100', t.wholesale('Toptan A') = 800 and t.sale('Toptan A') = 1100);

select t.expect_error('WP4a a percent change on a model without a wholesale price is refused',
  format('select public.update_prices_bulk(array[%s, %s], ''percent'', 5, 0, ''wholesale'')', t.product('Toptan A'), t.product('Toptan B')),
  'no wholesale price');
select t.ok('WP4b ... and no wholesale price changed', t.wholesale('Toptan A') = 800 and t.wholesale('Toptan B') is null);

select public.update_prices_bulk(array[t.product('Toptan A'), t.product('Toptan B')], 'set', 450, 0, 'wholesale');
select t.ok('WP5 "set" gives every chosen model the price, an empty one included',
  t.wholesale('Toptan A') = 450 and t.wholesale('Toptan B') = 450);

select t.expect_error('WP6 an unknown price field is refused',
  format('select public.update_prices_bulk(array[%s], ''set'', 1, 0, ''purchase'')', t.product('Toptan A')), 'price field');

\echo '--- WS: stock summary'
select t.ok('WS1 stock_summary shows the wholesale price',
  (select wholesale_price from public.stock_summary where name = 'Toptan Giriş') = 240);

reset role;
