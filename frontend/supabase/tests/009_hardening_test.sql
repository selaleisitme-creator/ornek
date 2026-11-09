-- Tests for 009_hardening.sql. Each check prints PASS or FAIL; an ERROR line is also a failure.
-- Runs after the 007 and 008 tests in the same database.
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

grant execute on all functions in schema t to anon, authenticated;

\echo '--- SP: fixed search_path'
select t.ok('SP1 the three functions now pin search_path',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_mfa_verified', 'sale_item_lock_target', 'current_price_batch')
      and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) = 3);

\echo '--- AN: anonymous visitors call no SECURITY DEFINER function'
select t.ok('AN1 no SECURITY DEFINER function in public is executable by anon',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.prosecdef
                 and has_function_privilege('anon', p.oid, 'execute')));
set role anon;
select t.expect_error('AN2 anon cannot call is_active_staff', 'select public.is_active_staff()', 'permission denied');
reset role;

\echo '--- TR: trigger functions are not callable, but the triggers still fire'
select t.ok('TR1 signed-in users cannot execute the trigger functions',
  not has_function_privilege('authenticated', 'public.log_product_price_change()', 'execute')
  and not has_function_privilege('authenticated', 'public.profile_permission_guard()', 'execute')
  and not has_function_privilege('authenticated', 'public.settings_guard()', 'execute'));
select t.ok('TR2 signed-in users can still execute the RLS helpers',
  has_function_privilege('authenticated', 'public.is_active_staff()', 'execute')
  and has_function_privilege('authenticated', 'public.can_view_national_ids()', 'execute'));

set role authenticated;
select t.as_user('22222222-2222-2222-2222-222222222222');
update public.products set sale_price = 777 where name = 'Open 8 mm';
select t.ok('TR3 the price trigger still logs a change',
  exists (select 1 from public.price_changes where new_price = 777));
select t.as_user('11111111-1111-1111-1111-111111111111');
select t.expect_error('TR4 the profile guard still refuses a self-promotion',
  'update public.profiles set role = ''admin'' where id = ''11111111-1111-1111-1111-111111111111''', 'only an admin');
select t.expect_error('TR5 the settings guard still protects the sign-out time',
  'update public.settings set idle_logout_minutes = 400', 'only an admin');
select t.ok('TR6 RLS still works for staff', (select count(*) from public.brands) > 0);

reset role;
