-- 009_hardening.sql
-- Clears the Supabase Security Advisor warnings that point at real loose ends (2026-11-09):
--   1. Three functions without a fixed search_path.
--   2. Anonymous visitors could call every SECURITY DEFINER function.
--   3. Signed-in users could call trigger functions directly.
-- Deliberately left open (the Advisor keeps listing them as "Signed-In Users Can Execute"):
--   - is_active_staff, is_active_admin, is_accounting_staff, can_view_national_ids: RLS rules run with the
--     user's rights, so signed-in users must be able to execute them or every rule would fail.
--   - save_national_id, reveal_national_id, national_id_presence, national_id_last4: called by the panel
--     on purpose; each checks the permission on its first line.
-- Tests: frontend/supabase/tests/009_hardening_test.sql.
-- Run once in the Supabase SQL Editor, after 008_design_gaps.sql.

begin;

-- ---------------------------------------------------------------------------
-- 1. Fixed search_path
-- ---------------------------------------------------------------------------
-- Without it, a function looks names up in whatever schemas the caller's search_path lists.

alter function public.is_mfa_verified() set search_path = public;
alter function public.sale_item_lock_target() set search_path = public;
alter function public.current_price_batch() set search_path = public;

-- ---------------------------------------------------------------------------
-- 2. Permission helpers and national ID functions: signed-in users only
-- ---------------------------------------------------------------------------
-- New functions are executable by PUBLIC (everyone, anon included) unless revoked.

revoke execute on function public.is_mfa_verified()       from public, anon;
revoke execute on function public.is_active_staff()       from public, anon;
revoke execute on function public.is_active_admin()       from public, anon;
revoke execute on function public.is_accounting_staff()   from public, anon;
revoke execute on function public.can_view_national_ids() from public, anon;

grant execute on function public.is_mfa_verified()       to authenticated, service_role;
grant execute on function public.is_active_staff()       to authenticated, service_role;
grant execute on function public.is_active_admin()       to authenticated, service_role;
grant execute on function public.is_accounting_staff()   to authenticated, service_role;
grant execute on function public.can_view_national_ids() to authenticated, service_role;

-- 007 and 008 already did this for the national ID functions; repeated so this file states the full rule.
revoke execute on function public.save_national_id(bigint, text, text)  from public, anon;
revoke execute on function public.reveal_national_id(bigint)            from public, anon;
revoke execute on function public.national_id_presence(bigint[])        from public, anon;
revoke execute on function public.national_id_last4(bigint[])           from public, anon;

-- ---------------------------------------------------------------------------
-- 3. Trigger functions: nobody calls them directly
-- ---------------------------------------------------------------------------
-- Postgres does not check EXECUTE when it fires a trigger, so the triggers keep working (tested).

revoke execute on function public.log_product_price_change()        from public, anon, authenticated;
revoke execute on function public.log_service_price_change()        from public, anon, authenticated;
revoke execute on function public.profile_permission_guard()        from public, anon, authenticated;
revoke execute on function public.settings_guard()                  from public, anon, authenticated;
revoke execute on function public.stock_unit_purchase_price_guard() from public, anon, authenticated;

commit;
