-- =====================================================================
-- Tracker de Gastos — Schema de Supabase
-- Pegá TODO este archivo en: Supabase > tu proyecto > SQL Editor > Run
-- =====================================================================

-- ---------- Tabla: categorías ----------
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null default '#6366f1',
  icon text not null default '💸',
  kind text not null default 'expense' check (kind in ('expense', 'income')),
  monthly_budget numeric(14, 2),
  is_favorite boolean not null default false,
  created_at timestamptz not null default now()
);

-- Migración para bases ya existentes (sin la columna kind): agregala una sola vez.
alter table public.categories
  add column if not exists kind text not null default 'expense'
    check (kind in ('expense', 'income'));

-- ---------- Tabla: cuentas (efectivo, bancos, tarjetas) ----------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default '🏦',
  color text not null default '#6366f1',
  type text not null default 'bank' check (type in ('cash', 'bank', 'card')),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  initial_balance numeric(14, 2) not null default 0,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- Tabla: transacciones (gastos/ingresos reales) ----------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  ars_rate numeric(14, 4) not null default 1, -- cuántos ARS vale 1 unidad de la moneda (1 si ya es ARS)
  description text,
  transaction_date date not null default current_date,
  type text not null default 'expense' check (type in ('expense', 'income')),
  created_at timestamptz not null default now()
);

-- Migración para bases ya existentes: columnas nuevas de transacciones.
alter table public.transactions
  add column if not exists account_id uuid references public.accounts (id) on delete set null;
alter table public.transactions
  add column if not exists currency text not null default 'ARS'
    check (currency in ('ARS', 'USD'));
alter table public.transactions
  add column if not exists ars_rate numeric(14, 4) not null default 1;

-- ---------- Tabla: gastos recurrentes / recordatorios ----------
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  name text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('once', 'weekly', 'monthly', 'yearly')),
  next_due_date date not null default current_date,
  auto_post boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Migración: cuenta por defecto para recurrentes ya existentes.
alter table public.recurring_expenses
  add column if not exists account_id uuid references public.accounts (id) on delete set null;

-- ---------- Tabla: transferencias entre cuentas ----------
create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  from_account_id uuid not null references public.accounts (id) on delete cascade,
  to_account_id uuid not null references public.accounts (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),      -- sale de la cuenta origen (moneda origen)
  to_amount numeric(14, 2) not null check (to_amount > 0), -- entra a la cuenta destino (moneda destino)
  description text,
  transfer_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- ---------- Tabla: metas de ahorro ----------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  icon text not null default '🎯',
  color text not null default '#6366f1',
  target_amount numeric(14, 2) not null check (target_amount > 0),
  saved_amount numeric(14, 2) not null default 0 check (saved_amount >= 0),
  currency text not null default 'ARS' check (currency in ('ARS', 'USD')),
  target_date date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Índices ----------
create index if not exists idx_tx_user_date
  on public.transactions (user_id, transaction_date desc);
create index if not exists idx_tx_user_cat
  on public.transactions (user_id, category_id);
create index if not exists idx_cat_user
  on public.categories (user_id);
create index if not exists idx_rec_user_due
  on public.recurring_expenses (user_id, next_due_date);
create index if not exists idx_acc_user
  on public.accounts (user_id);
create index if not exists idx_tx_user_acc
  on public.transactions (user_id, account_id);
create index if not exists idx_tr_user
  on public.transfers (user_id);
create index if not exists idx_goal_user
  on public.goals (user_id);

-- ---------- Row Level Security ----------
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.accounts enable row level security;
alter table public.transfers enable row level security;
alter table public.goals enable row level security;

drop policy if exists "own accounts" on public.accounts;
create policy "own accounts" on public.accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transfers" on public.transfers;
create policy "own transfers" on public.transfers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own goals" on public.goals;
create policy "own goals" on public.goals
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Cada usuario solo accede a sus propias filas.
drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transactions" on public.transactions;
create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own recurring" on public.recurring_expenses;
create policy "own recurring" on public.recurring_expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Categorías iniciales automáticas para cada usuario nuevo ----------
create or replace function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Categorías de gasto
  insert into public.categories (user_id, name, color, icon, kind, is_favorite) values
    (new.id, 'Comida',           '#f97316', '🍔', 'expense', true),
    (new.id, 'Supermercado',     '#22c55e', '🛒', 'expense', true),
    (new.id, 'Transporte',       '#3b82f6', '🚌', 'expense', true),
    (new.id, 'Servicios',        '#eab308', '💡', 'expense', false),
    (new.id, 'Salud',            '#ef4444', '💊', 'expense', false),
    (new.id, 'Ocio',             '#a855f7', '🎉', 'expense', true),
    (new.id, 'Hogar',            '#14b8a6', '🏠', 'expense', false),
    (new.id, 'Otros',            '#64748b', '💸', 'expense', false),
    -- Categorías de ingreso
    (new.id, 'Sueldo',           '#22c55e', '💰', 'income', true),
    (new.id, 'Aurum',            '#eab308', '🥇', 'income', true),
    (new.id, 'Automatizaciones', '#6366f1', '🤖', 'income', true);
  -- Cuenta inicial de efectivo
  insert into public.accounts (user_id, name, icon, color, type, currency, sort_order) values
    (new.id, 'Efectivo', '💵', '#22c55e', 'cash', 'ARS', 0);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.seed_default_categories();

-- ---------- Categorías de ingreso para usuarios YA existentes ----------
-- (el trigger de arriba solo corre para usuarios nuevos). Idempotente.
insert into public.categories (user_id, name, color, icon, kind, is_favorite)
select u.id, v.name, v.color, v.icon, 'income', v.fav
from auth.users u
cross join (values
  ('Sueldo',           '#22c55e', '💰', true),
  ('Aurum',            '#eab308', '🥇', true),
  ('Automatizaciones', '#6366f1', '🤖', true)
) as v(name, color, icon, fav)
where not exists (
  select 1 from public.categories c
  where c.user_id = u.id and c.kind = 'income' and c.name = v.name
);

-- ---------- Cuenta "Efectivo" para usuarios YA existentes (idempotente) ----------
insert into public.accounts (user_id, name, icon, color, type, currency, sort_order)
select u.id, 'Efectivo', '💵', '#22c55e', 'cash', 'ARS', 0
from auth.users u
where not exists (
  select 1 from public.accounts a where a.user_id = u.id
);

-- ---------- Función: saldo actual de cada cuenta ----------
-- Saldo = saldo inicial + (ingresos - gastos con esa cuenta) + (transferencias
-- recibidas) - (transferencias enviadas). Todo en la moneda propia de la cuenta.
create or replace function public.account_balances()
returns table (account_id uuid, balance numeric)
language sql
security invoker
stable
as $$
  select
    a.id as account_id,
    a.initial_balance
    + coalesce((
        select sum(case when t.type = 'income' then t.amount else -t.amount end)
        from public.transactions t
        where t.account_id = a.id
      ), 0)
    + coalesce((
        select sum(tr.to_amount)
        from public.transfers tr
        where tr.to_account_id = a.id
      ), 0)
    - coalesce((
        select sum(tr.amount)
        from public.transfers tr
        where tr.from_account_id = a.id
      ), 0) as balance
  from public.accounts a
  where a.user_id = auth.uid();
$$;
