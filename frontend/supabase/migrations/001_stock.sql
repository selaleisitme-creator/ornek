-- 001_stock.sql
-- Stock module tables (R1-R7, R33) and the payment method list (R24) that stock receipts need.
-- Design reference: ŞELALE/docs/veritabani-normalizasyon.md (section 4).
-- Run once in the Supabase SQL Editor. Wrapped in a transaction: if any line fails, nothing is created.

begin;

-- ---------------------------------------------------------------------------
-- Access helper
-- ---------------------------------------------------------------------------

-- is_active_admin() only lets role = 'admin' through, but every active staff member may use the
-- panel (see hasPanelAccess in src/lib/auth.js). Security definer so it can read profiles even
-- though profiles itself is protected by RLS.
create or replace function public.is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_mfa_verified()
     and exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

-- ---------------------------------------------------------------------------
-- R24 Payment methods
-- ---------------------------------------------------------------------------

-- A text code instead of a number: rows elsewhere read as 'cash' or 'paynet', and the list is fixed.
create table public.payment_methods (
  code         text primary key,
  name         text not null,
  ledger_label text not null,  -- what the cash ledger (Excel "NAKİT/KK" column) shows
  sort_order   integer not null default 0,
  active       boolean not null default true
);

insert into public.payment_methods (code, name, ledger_label, sort_order) values
  ('cash',        'Nakit',            'NAKİT',        1),
  ('card_pos',    'Kredi kartı (POS)', 'KK',           2),
  ('paynet',      'Paynet',           'PAYNET',       3),
  ('transfer',    'Havale/EFT',       'HAVALE/EFT',   4),
  ('installment', 'Taksit',           'TAKSİT',       5),
  ('other',       'Diğer',            'DİĞER',        6),
  ('unspecified', 'Belirtilmedi',     'BELİRTİLMEDİ', 7);

-- ---------------------------------------------------------------------------
-- R1 Brands
-- ---------------------------------------------------------------------------

create table public.brands (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> ''),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Case-insensitive: "Phonak" and "phonak" must not become two brands.
create unique index brands_name_key on public.brands (lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- R2 Products
-- ---------------------------------------------------------------------------

create table public.products (
  id               bigint generated always as identity primary key,
  brand_id         bigint not null references public.brands (id),
  category         text not null check (category in ('device', 'receiver', 'charger', 'battery', 'dome')),
  name             text not null check (btrim(name) <> ''),
  type             text,
  gtin             text unique check (gtin ~ '^[0-9]{8,14}$'),
  package_barcode  text,
  manufacturer_ref text,
  unit             text not null default 'piece' check (unit in ('piece', 'pack')),
  pack_size        integer check (pack_size > 0),         -- batteries in one pack
  packs_per_box    integer check (packs_per_box > 0),     -- packs in one box
  boxes_per_carton integer check (boxes_per_carton > 0),  -- boxes in one carton
  purchase_price   numeric(12, 2) not null default 0 check (purchase_price >= 0),
  sale_price       numeric(12, 2) not null default 0 check (sale_price >= 0),
  warranty_months  integer not null default 0 check (warranty_months >= 0),
  min_stock        integer not null default 0 check (min_stock >= 0),
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  -- A pack without a size would make the battery count impossible to compute.
  constraint products_pack_needs_size check (unit = 'piece' or pack_size is not null)
);

create index products_brand_id_idx on public.products (brand_id);

-- ---------------------------------------------------------------------------
-- R3 Product photos
-- ---------------------------------------------------------------------------

create table public.product_photos (
  id           bigint generated always as identity primary key,
  product_id   bigint not null references public.products (id) on delete cascade,
  storage_path text not null unique,
  uploaded_by  uuid not null default auth.uid() references public.profiles (id),
  created_at   timestamptz not null default now()
);

create index product_photos_product_id_idx on public.product_photos (product_id);

-- ---------------------------------------------------------------------------
-- R33 Suppliers
-- ---------------------------------------------------------------------------

create table public.suppliers (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> ''),
  tax_office text,
  -- 10 digits for a company tax number, 11 for a sole trader's national ID.
  tax_no     text unique check (tax_no ~ '^[0-9]{10,11}$'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- R4 Stock receipts
-- ---------------------------------------------------------------------------

create table public.stock_receipts (
  id             bigint generated always as identity primary key,
  supplier_id    bigint references public.suppliers (id),
  received_on    date not null default current_date,
  invoice_no     text,
  payment_method text not null references public.payment_methods (code),
  note           text,
  created_by     uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);

create index stock_receipts_supplier_id_idx on public.stock_receipts (supplier_id);

-- ---------------------------------------------------------------------------
-- R5 Stock units (one row per serial number; one battery pack is one unit)
-- ---------------------------------------------------------------------------

create table public.stock_units (
  id              bigint generated always as identity primary key,
  product_id      bigint not null references public.products (id),
  receipt_id      bigint references public.stock_receipts (id),
  serial_no       text not null unique check (btrim(serial_no) <> ''),
  wsa_code        text,
  production_date date,
  ear_side        text check (ear_side in ('right', 'left', 'both', 'none')),
  -- Overrides products.purchase_price when this unit was bought at a different price.
  purchase_price  numeric(12, 2) check (purchase_price >= 0),
  status          text not null default 'in_stock'
                  check (status in ('in_stock', 'sold', 'in_service', 'removed')),
  created_at      timestamptz not null default now()
);

-- The stock count ("how many in_stock units does this product have") runs on every stock page load.
create index stock_units_product_status_idx on public.stock_units (product_id, status);
create index stock_units_receipt_id_idx on public.stock_units (receipt_id);

-- ---------------------------------------------------------------------------
-- R6 Services
-- ---------------------------------------------------------------------------

create table public.services (
  id         bigint generated always as identity primary key,
  category   text not null check (category in ('service', 'audiology_exam')),
  name       text not null check (btrim(name) <> ''),
  price      numeric(12, 2) not null default 0 check (price >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- R7 Price changes (written only by the triggers below)
-- ---------------------------------------------------------------------------

create table public.price_changes (
  id          bigint generated always as identity primary key,
  product_id  bigint references public.products (id),
  service_id  bigint references public.services (id),
  price_field text not null check (price_field in ('sale', 'purchase')),
  old_price   numeric(12, 2) not null,
  new_price   numeric(12, 2) not null,
  changed_by  uuid references public.profiles (id),
  changed_at  timestamptz not null default now(),
  constraint price_changes_target_check check (num_nonnulls(product_id, service_id) = 1)
);

create index price_changes_product_id_idx on public.price_changes (product_id, changed_at desc);
create index price_changes_service_id_idx on public.price_changes (service_id, changed_at desc);

-- Price history is recorded by the database, so it cannot be skipped by a bug in the app code.
-- Security definer lets the trigger write rows that panel users themselves may not insert.
create or replace function public.log_product_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.sale_price is distinct from old.sale_price then
    insert into public.price_changes (product_id, price_field, old_price, new_price, changed_by)
    values (new.id, 'sale', old.sale_price, new.sale_price, auth.uid());
  end if;
  if new.purchase_price is distinct from old.purchase_price then
    insert into public.price_changes (product_id, price_field, old_price, new_price, changed_by)
    values (new.id, 'purchase', old.purchase_price, new.purchase_price, auth.uid());
  end if;
  return new;
end;
$$;

create trigger products_price_change
after update of sale_price, purchase_price on public.products
for each row execute function public.log_product_price_change();

create or replace function public.log_service_price_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_changes (service_id, price_field, old_price, new_price, changed_by)
    values (new.id, 'sale', old.price, new.price, auth.uid());
  end if;
  return new;
end;
$$;

create trigger services_price_change
after update of price on public.services
for each row execute function public.log_service_price_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
-- No delete policies anywhere: records are retired with active = false (or status = 'removed'),
-- so sales and the ledger never point at a row that has disappeared.

alter table public.payment_methods enable row level security;
alter table public.brands          enable row level security;
alter table public.products        enable row level security;
alter table public.product_photos  enable row level security;
alter table public.suppliers       enable row level security;
alter table public.stock_receipts  enable row level security;
alter table public.stock_units     enable row level security;
alter table public.services        enable row level security;
alter table public.price_changes   enable row level security;

-- Read-only lists: changed only through migrations or the triggers above.
create policy "staff read payment methods" on public.payment_methods
  for select to authenticated using (public.is_active_staff());
create policy "staff read price changes" on public.price_changes
  for select to authenticated using (public.is_active_staff());

-- Read, add and edit for the rest.
create policy "staff read brands"   on public.brands for select to authenticated using (public.is_active_staff());
create policy "staff add brands"    on public.brands for insert to authenticated with check (public.is_active_staff());
create policy "staff edit brands"   on public.brands for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read products" on public.products for select to authenticated using (public.is_active_staff());
create policy "staff add products"  on public.products for insert to authenticated with check (public.is_active_staff());
create policy "staff edit products" on public.products for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read product photos" on public.product_photos for select to authenticated using (public.is_active_staff());
create policy "staff add product photos"  on public.product_photos for insert to authenticated with check (public.is_active_staff());

create policy "staff read suppliers" on public.suppliers for select to authenticated using (public.is_active_staff());
create policy "staff add suppliers"  on public.suppliers for insert to authenticated with check (public.is_active_staff());
create policy "staff edit suppliers" on public.suppliers for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read stock receipts" on public.stock_receipts for select to authenticated using (public.is_active_staff());
create policy "staff add stock receipts"  on public.stock_receipts for insert to authenticated with check (public.is_active_staff());
create policy "staff edit stock receipts" on public.stock_receipts for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read stock units" on public.stock_units for select to authenticated using (public.is_active_staff());
create policy "staff add stock units"  on public.stock_units for insert to authenticated with check (public.is_active_staff());
create policy "staff edit stock units" on public.stock_units for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read services" on public.services for select to authenticated using (public.is_active_staff());
create policy "staff add services"  on public.services for insert to authenticated with check (public.is_active_staff());
create policy "staff edit services" on public.services for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

commit;
