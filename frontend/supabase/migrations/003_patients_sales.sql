-- 003_patients_sales.sql
-- Referral sources, patients and sales: R8, R9, R10, R12, R13, R14, R15, R16, R17, R18.
-- Design reference: ŞELALE/docs/veritabani-normalizasyon.md (section 4, "Hasta ve satış").
-- Run once in the Supabase SQL Editor, after 002_general.sql.

begin;

-- ---------------------------------------------------------------------------
-- R8 Referral sources
-- ---------------------------------------------------------------------------

create table public.referral_sources (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> ''),
  icon_path  text,
  visible    boolean not null default true,
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index referral_sources_name_key on public.referral_sources (lower(btrim(name)));

insert into public.referral_sources (name, sort_order) values
  ('Uygulama', 1), ('Web sitesi', 2), ('Instagram', 3), ('Facebook', 4),
  ('YouTube', 5), ('LinkedIn', 6), ('Google', 7), ('Telefonla', 8);

-- ---------------------------------------------------------------------------
-- R9 Patients
-- ---------------------------------------------------------------------------

-- Readable numbers (H00001) for staff and printouts; the bigint id stays the real key.
create sequence public.patient_no_seq;

create table public.patients (
  id                      bigint generated always as identity primary key,
  patient_no              text not null unique
                          default 'H' || lpad(nextval('public.patient_no_seq')::text, 5, '0'),
  full_name               text not null check (btrim(full_name) <> ''),
  phone                   text not null check (phone ~ '^[0-9+ ]{7,20}$'),
  birth_date              date,
  address                 text,
  -- Encrypted and decrypted by the server code; the key never reaches the database.
  national_id_encrypted   text,
  -- Kept separately because it cannot be derived from the ciphertext; safe to show in lists.
  national_id_last4       text check (national_id_last4 ~ '^[0-9]{4}$'),
  record_type             text not null default 'patient' check (record_type in ('candidate', 'patient')),
  registered_on           date not null default current_date,
  whatsapp_consent_at     timestamptz,  -- consent given when filled
  referral_source_id      bigint references public.referral_sources (id),
  adaptation_start_manual date,
  active                  boolean not null default true,
  created_by              uuid default auth.uid() references public.profiles (id),
  created_at              timestamptz not null default now(),
  constraint patients_national_id_pair check ((national_id_encrypted is null) = (national_id_last4 is null))
);

alter sequence public.patient_no_seq owned by public.patients.patient_no;

create index patients_full_name_idx on public.patients (lower(full_name));
create index patients_phone_idx on public.patients (phone);

-- ---------------------------------------------------------------------------
-- R10 Patient notes
-- ---------------------------------------------------------------------------

create table public.patient_notes (
  id         bigint generated always as identity primary key,
  patient_id bigint not null references public.patients (id),
  title      text not null check (btrim(title) <> ''),
  body       text not null,
  noted_on   date not null default current_date,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create index patient_notes_patient_id_idx on public.patient_notes (patient_id, noted_on desc);

-- ---------------------------------------------------------------------------
-- R12 National ID views (audit log)
-- ---------------------------------------------------------------------------

create table public.national_id_views (
  id         bigint generated always as identity primary key,
  patient_id bigint not null references public.patients (id),
  viewed_by  uuid not null default auth.uid() references public.profiles (id),
  viewed_at  timestamptz not null default now()
);

create index national_id_views_patient_id_idx on public.national_id_views (patient_id, viewed_at desc);

-- ---------------------------------------------------------------------------
-- R13 Sales
-- ---------------------------------------------------------------------------

create sequence public.sale_no_seq;

create table public.sales (
  id               bigint generated always as identity primary key,
  sale_no          text not null unique
                   default 'S' || lpad(nextval('public.sale_no_seq')::text, 5, '0'),
  sale_kind        text not null default 'retail' check (sale_kind in ('retail', 'service')),
  patient_id       bigint references public.patients (id),
  customer_name    text,
  customer_phone   text,
  sale_date        date not null default current_date,
  discount         numeric(12, 2) not null default 0 check (discount >= 0),
  tax_rate         numeric(5, 2) not null default 0 check (tax_rate between 0 and 100),
  invoice_mode     text not null default 'single' check (invoice_mode in ('single', 'per_item')),
  sgk_amount       numeric(12, 2) check (sgk_amount >= 0),
  sgk_status       text check (sgk_status in ('pending', 'received')),
  sgk_received_on  date,
  created_by       uuid not null default auth.uid() references public.profiles (id),
  created_at       timestamptz not null default now(),
  -- Someone has to be on the sale: a patient, or a named walk-in customer.
  constraint sales_buyer_check check (patient_id is not null or btrim(coalesce(customer_name, '')) <> ''),
  -- SGK amount and status come together; a received date only once it is received.
  constraint sales_sgk_pair check ((sgk_amount is null) = (sgk_status is null)),
  constraint sales_sgk_received check ((sgk_status = 'received') = (sgk_received_on is not null))
);

alter sequence public.sale_no_seq owned by public.sales.sale_no;

create index sales_patient_id_idx on public.sales (patient_id);
create index sales_sale_date_idx on public.sales (sale_date);

-- ---------------------------------------------------------------------------
-- R15 Invoices (before sale items, which point at them)
-- ---------------------------------------------------------------------------

create table public.invoices (
  id         bigint generated always as identity primary key,
  sale_id    bigint not null references public.sales (id),
  invoice_no text not null unique check (btrim(invoice_no) <> ''),
  issued_on  date not null default current_date,
  created_at timestamptz not null default now(),
  -- Lets sale_items check that its invoice belongs to the same sale (composite foreign key below).
  unique (id, sale_id)
);

-- ---------------------------------------------------------------------------
-- R14 Sale items
-- ---------------------------------------------------------------------------

create table public.sale_items (
  id             bigint generated always as identity primary key,
  sale_id        bigint not null references public.sales (id),
  stock_unit_id  bigint references public.stock_units (id),
  service_id     bigint references public.services (id),
  quantity       integer not null default 1 check (quantity > 0),
  unit_price     numeric(12, 2) not null check (unit_price >= 0),
  -- Filled by the trigger below from the unit's purchase price at the moment of sale.
  cost_at_sale   numeric(12, 2) check (cost_at_sale >= 0),
  ear_side       text check (ear_side in ('right', 'left', 'both', 'none')),
  warranty_start date,
  warranty_end   date,
  uts_report_no  text,
  invoice_id     bigint,
  service_note   text,
  mold_type      text,
  created_at     timestamptz not null default now(),
  constraint sale_items_target_check check (num_nonnulls(stock_unit_id, service_id) = 1),
  constraint sale_items_unit_quantity check (stock_unit_id is null or quantity = 1),
  constraint sale_items_warranty_order check (warranty_end is null or warranty_start is null or warranty_end >= warranty_start),
  constraint sale_items_invoice_same_sale foreign key (invoice_id, sale_id) references public.invoices (id, sale_id)
);

create index sale_items_sale_id_idx on public.sale_items (sale_id);
create index sale_items_stock_unit_id_idx on public.sale_items (stock_unit_id);
create index sale_items_service_id_idx on public.sale_items (service_id);

-- Selling a unit marks it sold in the same transaction. The "status = 'in_stock'" condition locks
-- the row, so if two people sell the same device at once, the second one gets an error.
create or replace function public.sale_item_take_stock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  unit_cost numeric(12, 2);
begin
  if new.stock_unit_id is null then
    new.cost_at_sale := coalesce(new.cost_at_sale, 0);
    return new;
  end if;

  update public.stock_units u
     set status = 'sold'
    from public.products p
   where u.id = new.stock_unit_id
     and p.id = u.product_id
     and u.status = 'in_stock'
  returning coalesce(u.purchase_price, p.purchase_price) into unit_cost;

  if not found then
    raise exception 'Stock unit % is not in stock', new.stock_unit_id
      using errcode = 'P0001', hint = 'It may already be sold, in service or removed.';
  end if;

  new.cost_at_sale := coalesce(new.cost_at_sale, unit_cost);
  return new;
end;
$$;

create trigger sale_items_take_stock
before insert on public.sale_items
for each row execute function public.sale_item_take_stock();

-- Swapping the device or service on an existing item would leave stock statuses wrong;
-- such a correction is a refund plus a new item instead.
create or replace function public.sale_item_lock_target()
returns trigger
language plpgsql
as $$
begin
  if new.stock_unit_id is distinct from old.stock_unit_id
     or new.service_id is distinct from old.service_id
     or new.sale_id <> old.sale_id then
    raise exception 'The product, service or sale of a sale item cannot be changed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger sale_items_lock_target
before update on public.sale_items
for each row execute function public.sale_item_lock_target();

-- ---------------------------------------------------------------------------
-- R16 Sale payments
-- ---------------------------------------------------------------------------

create table public.sale_payments (
  id             bigint generated always as identity primary key,
  sale_id        bigint not null references public.sales (id),
  payment_method text not null references public.payment_methods (code),
  amount         numeric(12, 2) not null check (amount > 0),
  installments   integer check (installments > 1),
  paid_on        date not null default current_date,
  created_at     timestamptz not null default now()
);

create index sale_payments_sale_id_idx on public.sale_payments (sale_id);
create index sale_payments_paid_on_idx on public.sale_payments (paid_on);

-- ---------------------------------------------------------------------------
-- R17 Refunds
-- ---------------------------------------------------------------------------

create table public.refunds (
  id             bigint generated always as identity primary key,
  sale_item_id   bigint not null unique references public.sale_items (id),  -- at most one refund per item
  refunded_on    date not null default current_date,
  amount         numeric(12, 2) not null check (amount > 0),
  payment_method text not null references public.payment_methods (code),
  reason         text,
  created_by     uuid not null default auth.uid() references public.profiles (id),
  created_at     timestamptz not null default now()
);

-- A refunded device goes back on the shelf, and a refund cannot exceed what was charged.
create or replace function public.refund_return_stock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  item public.sale_items%rowtype;
begin
  select * into item from public.sale_items where id = new.sale_item_id;

  if new.amount > item.unit_price * item.quantity then
    raise exception 'Refund % is more than the item price %', new.amount, item.unit_price * item.quantity
      using errcode = 'P0001';
  end if;

  if item.stock_unit_id is not null then
    update public.stock_units set status = 'in_stock' where id = item.stock_unit_id;
  end if;

  return new;
end;
$$;

create trigger refunds_return_stock
before insert on public.refunds
for each row execute function public.refund_return_stock();

-- ---------------------------------------------------------------------------
-- R18 Post-sale tasks (ÜTS, WSA, Kolaysoft, Medikal Merkez ticked per sale)
-- ---------------------------------------------------------------------------

create table public.sale_tasks (
  sale_id      bigint not null references public.sales (id),
  link_id      bigint not null references public.links (id),
  completed_at timestamptz not null default now(),
  completed_by uuid not null default auth.uid() references public.profiles (id),
  primary key (sale_id, link_id)
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.referral_sources  enable row level security;
alter table public.patients          enable row level security;
alter table public.patient_notes     enable row level security;
alter table public.national_id_views enable row level security;
alter table public.sales             enable row level security;
alter table public.invoices          enable row level security;
alter table public.sale_items        enable row level security;
alter table public.sale_payments     enable row level security;
alter table public.refunds           enable row level security;
alter table public.sale_tasks        enable row level security;

create policy "staff read referral sources" on public.referral_sources for select to authenticated using (public.is_active_staff());
create policy "staff add referral sources"  on public.referral_sources for insert to authenticated with check (public.is_active_staff());
create policy "staff edit referral sources" on public.referral_sources for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read patients" on public.patients for select to authenticated using (public.is_active_staff());
create policy "staff add patients"  on public.patients for insert to authenticated with check (public.is_active_staff());
create policy "staff edit patients" on public.patients for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read patient notes" on public.patient_notes for select to authenticated using (public.is_active_staff());
create policy "staff add patient notes"  on public.patient_notes for insert to authenticated with check (public.is_active_staff());
create policy "staff edit patient notes" on public.patient_notes for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

-- Everyone may log their own view; the log itself is never edited.
create policy "staff read national id views" on public.national_id_views for select to authenticated using (public.is_active_staff());
create policy "staff log own national id view" on public.national_id_views for insert to authenticated
  with check (public.is_active_staff() and viewed_by = auth.uid());

create policy "staff read sales" on public.sales for select to authenticated using (public.is_active_staff());
create policy "staff add sales"  on public.sales for insert to authenticated with check (public.is_active_staff());
create policy "staff edit sales" on public.sales for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read invoices" on public.invoices for select to authenticated using (public.is_active_staff());
create policy "staff add invoices"  on public.invoices for insert to authenticated with check (public.is_active_staff());
create policy "staff edit invoices" on public.invoices for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read sale items" on public.sale_items for select to authenticated using (public.is_active_staff());
create policy "staff add sale items"  on public.sale_items for insert to authenticated with check (public.is_active_staff());
create policy "staff edit sale items" on public.sale_items for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read sale payments" on public.sale_payments for select to authenticated using (public.is_active_staff());
create policy "staff add sale payments"  on public.sale_payments for insert to authenticated with check (public.is_active_staff());
create policy "staff edit sale payments" on public.sale_payments for update to authenticated using (public.is_active_staff()) with check (public.is_active_staff());

create policy "staff read refunds" on public.refunds for select to authenticated using (public.is_active_staff());
create policy "staff add refunds"  on public.refunds for insert to authenticated with check (public.is_active_staff());

-- A ticked site can be unticked again, so this is the one table with a delete rule.
create policy "staff read sale tasks"   on public.sale_tasks for select to authenticated using (public.is_active_staff());
create policy "staff tick sale tasks"   on public.sale_tasks for insert to authenticated with check (public.is_active_staff());
create policy "staff untick sale tasks" on public.sale_tasks for delete to authenticated using (public.is_active_staff());

commit;
