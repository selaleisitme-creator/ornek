-- Minimal stand-ins for what the real Supabase project already has, so the migrations can run in a
-- throwaway Postgres container. Never run this against Supabase.

create role anon nologin;
create role authenticated nologin;
create schema auth;

-- Supabase reads the signed-in user from the request's JWT; the tests set it with set_config().
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create table public.profiles (
  id                   uuid primary key,
  full_name            text,
  role                 text not null default 'staff',
  active               boolean not null default true,
  can_view_national_id boolean not null default false
);

create function public.is_mfa_verified() returns boolean language sql stable as
  $$ select coalesce((auth.jwt() ->> 'aal') = 'aal2', false) $$;
create function public.is_active_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active) $$;

create table public.appointment_requests (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  phone            text not null,
  email            text not null,
  appointment_date date not null,
  appointment_time text not null,
  status           text not null default 'new' check (status in ('new', 'converted', 'rejected'))
);
alter table public.appointment_requests enable row level security;

grant usage on schema public, auth to anon, authenticated;

-- Supabase grants table rights to these roles by default and lets RLS decide; mirror that.
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant usage on sequences to anon, authenticated;

-- 1111…: staff without ID or accounting permission (like an intern). 2222…: admin with both.
insert into public.profiles (id, full_name, role, can_view_national_id) values
  ('11111111-1111-1111-1111-111111111111', 'Stajyer', 'staff', false),
  ('22222222-2222-2222-2222-222222222222', 'Yönetici', 'admin', true);
