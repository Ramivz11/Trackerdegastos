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

-- ---------- Tabla: transacciones (gastos/ingresos reales) ----------
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  amount numeric(14, 2) not null check (amount >= 0),
  description text,
  transaction_date date not null default current_date,
  type text not null default 'expense' check (type in ('expense', 'income')),
  created_at timestamptz not null default now()
);

-- ---------- Tabla: gastos recurrentes / recordatorios ----------
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  name text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('once', 'weekly', 'monthly', 'yearly')),
  next_due_date date not null default current_date,
  auto_post boolean not null default false,
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

-- ---------- Row Level Security ----------
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.recurring_expenses enable row level security;

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
