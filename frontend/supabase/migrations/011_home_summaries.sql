-- 011: home page numbers computed in the database (plan 3.7: "Hesaplamalar veritabanında yapılır; sayfaya
-- yalnızca sonuçlar gelir"). The home page used to read every sale item, refund, visit, payment and
-- appointment and add them up in the server code; these functions return only the few rows the page draws.
--
--   home_sales_monthly(p_from)   sale value per month (by sale date) minus refunds (by refund date), and the
--                                number of sales; legacy sales and their refunds are left out
--   home_sales_total()           the same, all time
--   home_visits_monthly(p_from)  attended visits per month, new patient vs returning (Istanbul months)
--   home_payment_methods()       number of patient payments per method (SGK money is not a patient's choice)
--   home_referral_counts()       where patients came from: each patient once, by their first appointment that
--                                was not cancelled; source from that appointment, else from the patient
--
-- All are security invoker: they run with the caller's rights, so the tables' RLS (active staff at aal2)
-- still decides what is read. Signed-out visitors (anon) cannot call them. Run once in the SQL Editor.

begin;

create or replace function public.home_sales_monthly(p_from date)
returns table (month date, amount numeric, sale_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  with sold as (
    select date_trunc('month', sale_date)::date as month,
           sum(net_value)                       as amount,
           count(distinct sale_id)::integer     as sales
    from public.sale_report
    where sale_date >= p_from
    group by 1
  ),
  returned as (
    select date_trunc('month', r.refunded_on)::date as month, sum(r.amount) as amount
    from public.refunds r
    join public.sale_items si on si.id = r.sale_item_id
    join public.sales s       on s.id = si.sale_id and s.sale_kind <> 'legacy'
    where r.refunded_on >= p_from
    group by 1
  )
  select coalesce(s.month, r.month),
         coalesce(s.amount, 0) - coalesce(r.amount, 0),
         coalesce(s.sales, 0)
  from sold s
  full join returned r on r.month = s.month
  order by 1;
$$;

create or replace function public.home_sales_total()
returns table (amount numeric, sale_count integer)
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((select sum(net_value) from public.sale_report), 0)
         - coalesce((select sum(r.amount)
                     from public.refunds r
                     join public.sale_items si on si.id = r.sale_item_id
                     join public.sales s       on s.id = si.sale_id and s.sale_kind <> 'legacy'), 0),
         (select count(distinct sale_id)::integer from public.sale_report);
$$;

-- New patient: the visit is the patient's first attended one, the patient was registered at most
-- p_new_window days before it, and has no past (legacy) device. Patients typed in from before the panel
-- carry an old registration date or a past device, so their first visit in the panel counts as returning.
create or replace function public.home_visits_monthly(p_from date, p_new_window integer default 60)
returns table (month date, new_patients integer, returning_patients integer)
language sql
stable
security invoker
set search_path = public
as $$
  with attended as (
    select a.patient_id,
           (a.starts_at at time zone 'Europe/Istanbul') as local_at,
           a.starts_at = min(a.starts_at) over (partition by a.patient_id) as is_first
    from public.appointments a
    where a.status = 'attended'
  ),
  marked as (
    select date_trunc('month', v.local_at)::date as month,
           v.is_first
             and v.local_at::date - p.registered_on <= p_new_window
             and not exists (select 1 from public.sales s where s.patient_id = v.patient_id and s.sale_kind = 'legacy')
             as is_new
    from attended v
    join public.patients p on p.id = v.patient_id
    where v.local_at >= p_from
  )
  select month,
         (count(*) filter (where is_new))::integer,
         (count(*) filter (where not is_new))::integer
  from marked
  group by month
  order by month;
$$;

create or replace function public.home_payment_methods()
returns table (code text, name text, payments integer)
language sql
stable
security invoker
set search_path = public
as $$
  select pm.code, pm.name, count(*)::integer
  from public.sale_payments sp
  join public.payment_methods pm on pm.code = sp.payment_method
  where sp.payer = 'patient'
  group by pm.code, pm.name, pm.sort_order
  order by count(*) desc, pm.sort_order;
$$;

create or replace function public.home_referral_counts()
returns table (source_id bigint, total integer, attended integer, no_show integer, waiting integer)
language sql
stable
security invoker
set search_path = public
as $$
  with firsts as (
    select distinct on (a.patient_id) a.patient_id, a.status, a.referral_source_id
    from public.appointments a
    where a.status <> 'cancelled'
    order by a.patient_id, a.starts_at, a.id
  )
  select coalesce(f.referral_source_id, p.referral_source_id),
         count(*)::integer,
         (count(*) filter (where f.status = 'attended'))::integer,
         (count(*) filter (where f.status = 'no_show'))::integer,
         (count(*) filter (where f.status = 'waiting'))::integer
  from firsts f
  join public.patients p on p.id = f.patient_id
  where coalesce(f.referral_source_id, p.referral_source_id) is not null
  group by 1;
$$;

-- New functions are executable by PUBLIC (anon included) unless revoked (see 009).
revoke execute on function public.home_sales_monthly(date)            from public, anon;
revoke execute on function public.home_sales_total()                  from public, anon;
revoke execute on function public.home_visits_monthly(date, integer)  from public, anon;
revoke execute on function public.home_payment_methods()              from public, anon;
revoke execute on function public.home_referral_counts()              from public, anon;
grant execute on function public.home_sales_monthly(date)            to authenticated;
grant execute on function public.home_sales_total()                  to authenticated;
grant execute on function public.home_visits_monthly(date, integer)  to authenticated;
grant execute on function public.home_payment_methods()              to authenticated;
grant execute on function public.home_referral_counts()              to authenticated;

commit;
