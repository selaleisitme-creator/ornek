-- 002_general.sql
-- Links (R28), settings (R29), backup runs (R30) and the accounting permission on profiles (R31).
-- Comes before 003 because post-sale tasks (R18) point at links.
-- Design reference: ŞELALE/docs/veritabani-normalizasyon.md (section 4, "Genel").
-- Run once in the Supabase SQL Editor, after 001_stock.sql.

begin;

-- ---------------------------------------------------------------------------
-- R31 Profiles: accounting permission
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column can_view_accounting boolean not null default false;

-- Accounting tables (005) use this instead of is_active_staff(): the design's separate accounting
-- password becomes a per-person permission.
create or replace function public.is_accounting_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_mfa_verified()
     and exists (
       select 1 from public.profiles
       where id = auth.uid() and active and can_view_accounting
     )
$$;

-- ---------------------------------------------------------------------------
-- R28 Links
-- ---------------------------------------------------------------------------

create table public.links (
  id           bigint generated always as identity primary key,
  name         text not null check (btrim(name) <> ''),
  -- Empty only for the seeded post-sale sites until their address is filled in on the Links page.
  url          text check (url ~ '^https?://'),
  icon_letter  text not null check (char_length(icon_letter) between 1 and 2),
  color        text not null default '#244d9c' check (color ~ '^#[0-9a-fA-F]{6}$'),
  sort_order   integer not null default 0,
  -- Marks the sites the sale wizard depends on, so the code finds them without hard-coding addresses.
  system_key   text unique check (system_key in ('uts', 'wsa', 'kolaysoft', 'medical_center')),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint links_url_required check (system_key is not null or url is not null)
);

insert into public.links (name, icon_letter, color, sort_order, system_key) values
  ('ÜTS',            'Ü', '#244d9c', 1, 'uts'),
  ('WSA',            'W', '#1f7a5a', 2, 'wsa'),
  ('Kolaysoft',      'K', '#b5561b', 3, 'kolaysoft'),
  ('Medikal Merkez', 'M', '#7a3fa0', 4, 'medical_center');

-- ---------------------------------------------------------------------------
-- R29 Settings (exactly one row)
-- ---------------------------------------------------------------------------

create table public.settings (
  id                          smallint primary key default 1 check (id = 1),
  whatsapp_number             text,
  contact_email               text,
  maintenance_interval_months integer not null default 6 check (maintenance_interval_months between 1 and 36),
  reminders_enabled           boolean not null default true,
  remind_3d                   boolean not null default true,
  remind_1d                   boolean not null default true,
  remind_1h                   boolean not null default true,
  backup_enabled              boolean not null default true,
  backup_weekday              smallint not null default 0 check (backup_weekday between 0 and 6),  -- 0 = Sunday
  backup_time                 time not null default '03:00',
  backup_keep_count           integer not null default 8 check (backup_keep_count between 1 and 52)
);

insert into public.settings (id) values (1);

-- ---------------------------------------------------------------------------
-- R30 Backup runs (written by the backup job with the secret key)
-- ---------------------------------------------------------------------------

create table public.backup_runs (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('scheduled', 'manual')),
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  file_path   text,
  size_bytes  bigint check (size_bytes >= 0)
);

create index backup_runs_started_at_idx on public.backup_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.links       enable row level security;
alter table public.settings    enable row level security;
alter table public.backup_runs enable row level security;

create policy "staff read links" on public.links for select to authenticated using (public.is_active_staff());
create policy "staff add links"  on public.links for insert to authenticated with check (public.is_active_staff());
create policy "staff edit links" on public.links for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- Settings change clinic-wide behaviour, so only admins edit them; everyone may read.
create policy "staff read settings"  on public.settings for select to authenticated using (public.is_active_staff());
create policy "admins edit settings" on public.settings for update to authenticated
  using (public.is_mfa_verified() and public.is_active_admin())
  with check (public.is_mfa_verified() and public.is_active_admin());

create policy "staff read backup runs" on public.backup_runs for select to authenticated using (public.is_active_staff());

commit;
