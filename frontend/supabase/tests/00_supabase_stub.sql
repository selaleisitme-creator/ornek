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

-- Mirrors the live table (checked 2026-11-09). Live, profiles_role_check is (role = 'admin'); here it also lets
-- 'staff' in, because the tests need a non-admin user before 008 widens the rule. The name matches, so 008's
-- drop-and-recreate runs exactly as it will on Supabase.
create table public.profiles (
  id                   uuid primary key,
  full_name            text,
  role                 text not null default 'admin',
  active               boolean not null default true,
  can_view_national_id boolean not null default false,
  last_login_at        timestamptz,
  constraint profiles_role_check check (role in ('admin', 'staff'))
);

-- Supabase Storage keeps buckets and files in its own schema.
create schema storage;
create table storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

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
