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

-- is_transfer: marca el lado "crédito" de una compra de moneda (ver
-- "Comprar moneda" en Cuentas). Ajusta el saldo de la cuenta destino pero se
-- excluye de los totales de ingreso/gasto en Reportes/Dashboard, para no
-- duplicar el monto que ya se contó como gasto en la cuenta origen.
alter table public.transactions
  add column if not exists is_transfer boolean not null default false;

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
    (new.id, 'Compra de moneda', '#0ea5e9', '💱', 'expense', false),
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

-- ---------- Categoría "Compra de moneda" para usuarios YA existentes ----------
insert into public.categories (user_id, name, color, icon, kind, is_favorite)
select u.id, 'Compra de moneda', '#0ea5e9', '💱', 'expense', false
from auth.users u
where not exists (
  select 1 from public.categories c
  where c.user_id = u.id and c.kind = 'expense' and c.name = 'Compra de moneda'
);

-- ---------- Cuenta "Efectivo" para usuarios YA existentes (idempotente) ----------
insert into public.accounts (user_id, name, icon, color, type, currency, sort_order)
select u.id, 'Efectivo', '💵', '#22c55e', 'cash', 'ARS', 0
from auth.users u
where not exists (
  select 1 from public.accounts a where a.user_id = u.id
);

-- ---------- Tarjetas de crédito: día de cierre y de vencimiento ----------
-- closing_day: día del mes en que cierra el resumen (ej: 28).
-- due_day: día del mes en que vence (para pagar). Ambos solo aplican a type='card'.
alter table public.accounts
  add column if not exists closing_day smallint check (closing_day between 1 and 31);
alter table public.accounts
  add column if not exists due_day smallint check (due_day between 1 and 31);

-- ---------- Cuotas: una compra en N cuotas se guarda como N transacciones ----------
-- group_id agrupa las cuotas de una misma compra; installment_n / _total indican
-- "cuota N de M". Cada cuota queda fechada en el ciclo que le corresponde.
alter table public.transactions
  add column if not exists group_id uuid;
alter table public.transactions
  add column if not exists installment_n smallint;
alter table public.transactions
  add column if not exists installment_total smallint;
create index if not exists idx_tx_group on public.transactions (group_id);

-- ---------- Pagos de resúmenes de tarjeta ----------
-- Cada fila = un resumen (identificado por cycle_close) marcado como pagado.
-- El pago descuenta de paid_from_account_id (ej: tu banco).
create table if not exists public.statement_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade, -- la tarjeta
  cycle_close date not null,        -- fecha de cierre que identifica el resumen
  amount numeric(14, 2) not null check (amount >= 0),
  paid_from_account_id uuid references public.accounts (id) on delete set null,
  paid_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (account_id, cycle_close)
);
create index if not exists idx_sp_user_acc
  on public.statement_payments (user_id, account_id);

alter table public.statement_payments enable row level security;
drop policy if exists "own statement_payments" on public.statement_payments;
create policy "own statement_payments" on public.statement_payments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Función: saldo actual de cada cuenta ----------
-- Saldo = saldo inicial + (ingresos - gastos con esa cuenta) + (transferencias
-- recibidas) - (transferencias enviadas) - (pagos de resúmenes que salen de ella).
-- Todo en la moneda propia de la cuenta. Nota: para las tarjetas este saldo no se
-- usa en pantalla (la deuda se calcula por ciclo en la app), pero el pago de un
-- resumen sí descuenta de la cuenta desde la que se paga.
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
      ), 0)
    - coalesce((
        select sum(sp.amount)
        from public.statement_payments sp
        where sp.paid_from_account_id = a.id
      ), 0) as balance
  from public.accounts a
  where a.user_id = auth.uid();
$$;

-- =====================================================================
-- v2 — Ajustes sincronizados, modo hogar, reglas, push, patrimonio.
-- Todo lo de acá abajo es idempotente: podés volver a correr el archivo
-- entero sobre una base que ya tiene datos.
-- =====================================================================

-- ---------- Modo hogar: varios usuarios comparten un mismo tracker ----------
create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Mi hogar',
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

-- Invitación pendiente: se guarda el email y se convierte en membresía cuando
-- esa persona inicia sesión (ver accept_pending_invites()).
create table if not exists public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  email text not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (household_id, email)
);

-- Hogares a los que pertenezco. SECURITY DEFINER para poder usarla dentro de
-- las políticas de household_members sin recursión infinita.
create or replace function public.my_household_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select household_id from public.household_members where user_id = auth.uid();
$$;

-- Usuarios cuyos datos puedo ver: yo mismo + el resto de mi hogar.
-- Si no estás en ningún hogar devuelve solo tu propio id, así el
-- comportamiento es idéntico al de siempre.
create or replace function public.shared_user_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select auth.uid()
  union
  select m.user_id
  from public.household_members m
  where m.household_id in (
    select household_id from public.household_members where user_id = auth.uid()
  );
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invites enable row level security;

drop policy if exists "households read" on public.households;
create policy "households read" on public.households
  for select using (owner_id = auth.uid() or id in (select public.my_household_ids()));

drop policy if exists "households write" on public.households;
create policy "households write" on public.households
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "members read" on public.household_members;
create policy "members read" on public.household_members
  for select using (household_id in (select public.my_household_ids()));

-- Alta de miembros: el dueño agrega a cualquiera; cualquiera puede darse de
-- alta a sí mismo al aceptar una invitación.
drop policy if exists "members insert" on public.household_members;
create policy "members insert" on public.household_members
  for insert with check (
    user_id = auth.uid()
    or household_id in (select id from public.households where owner_id = auth.uid())
  );

drop policy if exists "members delete" on public.household_members;
create policy "members delete" on public.household_members
  for delete using (
    user_id = auth.uid()
    or household_id in (select id from public.households where owner_id = auth.uid())
  );

drop policy if exists "invites owner" on public.household_invites;
create policy "invites owner" on public.household_invites
  for all using (household_id in (select id from public.households where owner_id = auth.uid()))
  with check (household_id in (select id from public.households where owner_id = auth.uid()));

drop policy if exists "invites mine" on public.household_invites;
create policy "invites mine" on public.household_invites
  for select using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Convierte en membresías las invitaciones dirigidas a mi email. La llama la
-- app al iniciar sesión; es idempotente.
create or replace function public.accept_pending_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  my_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  me uuid := auth.uid();
  n integer := 0;
  inv record;
begin
  if me is null or my_email = '' then
    return 0;
  end if;

  for inv in
    select * from public.household_invites where lower(email) = my_email
  loop
    insert into public.household_members (household_id, user_id, email, role)
    values (inv.household_id, me, my_email, 'member')
    on conflict (household_id, user_id) do nothing;
    delete from public.household_invites where id = inv.id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- El dueño de un hogar queda registrado como miembro automáticamente.
create or replace function public.add_household_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.household_members (household_id, user_id, email, role)
  values (new.id, new.owner_id, (select email from auth.users where id = new.owner_id), 'owner')
  on conflict (household_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_household_created on public.households;
create trigger on_household_created
  after insert on public.households
  for each row execute function public.add_household_owner();

-- ---------- Ajustes por usuario (antes vivían en localStorage) ----------
-- display_currency: moneda en la que se MUESTRAN los totales.
-- rates: cuántos ARS vale 1 unidad de cada moneda, ej {"USD": 1450, "EUR": 1600}.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_currency text not null default 'ARS',
  rates jsonb not null default '{"USD": 1000}'::jsonb,
  rate_source text not null default 'manual',
  rates_updated_at timestamptz,
  monthly_budget_total numeric(14, 2),
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Reglas de auto-categorización ----------
-- Si la descripción del movimiento contiene `pattern`, se le asigna category_id.
create table if not exists public.category_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pattern text not null,
  category_id uuid references public.categories (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_rules_user on public.category_rules (user_id, priority desc);

-- ---------- Suscripciones a notificaciones push ----------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_push_user on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "own push" on public.push_subscriptions;
create policy "own push" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Columnas nuevas ----------
-- Arrastre de presupuesto: lo que sobra del mes se suma al límite del siguiente.
alter table public.categories
  add column if not exists rollover boolean not null default false;

-- Foto del ticket (ruta dentro del bucket "receipts" de Storage).
alter table public.transactions
  add column if not exists receipt_path text;

-- Origen recurrente del movimiento. El índice único evita que el cron del
-- servidor y el catch-up del cliente generen la misma cuota dos veces.
alter table public.transactions
  add column if not exists recurring_id uuid references public.recurring_expenses (id) on delete set null;
create unique index if not exists uq_tx_recurring_occurrence
  on public.transactions (recurring_id, transaction_date)
  where recurring_id is not null;

-- ---------- Gastos compartidos: la parte que te tienen que devolver ----------
-- Pagás vos la cuenta de todos y después te devuelven. `reimbursable_amount`
-- es cuánto de ese gasto esperás recuperar, en la moneda del movimiento.
--
-- El gasto real (el que va a reportes y presupuestos) es
-- `amount - reimbursable_amount` desde el momento en que se carga, pero de la
-- cuenta salió el `amount` completo: la diferencia se recupera con las filas
-- de `reimbursements`.
alter table public.transactions
  add column if not exists reimbursable_amount numeric(14, 2) not null default 0;
alter table public.transactions
  add column if not exists reimbursable_note text;

-- No podés esperar recuperar más de lo que gastaste.
alter table public.transactions
  drop constraint if exists transactions_reimbursable_range;
alter table public.transactions
  add constraint transactions_reimbursable_range
  check (reimbursable_amount >= 0 and reimbursable_amount <= amount);

create index if not exists idx_tx_reimbursable
  on public.transactions (user_id)
  where reimbursable_amount > 0;

-- Cada cobro (total o parcial) de un gasto compartido.
create table if not exists public.reimbursements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  -- Cuenta donde entró la plata (para que el saldo lo refleje).
  account_id uuid references public.accounts (id) on delete set null,
  received_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_reimb_user_tx
  on public.reimbursements (user_id, transaction_id);

-- ---------- Monedas: se admiten las 8 que ofrece la pantalla de Ajustes ----------
-- Antes el CHECK solo permitía ARS/USD mientras la UI ofrecía 8 monedas.
do $$
declare c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in (
        'public.accounts'::regclass,
        'public.transactions'::regclass,
        'public.goals'::regclass
      )
      and pg_get_constraintdef(oid) like '%ARS%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end;
$$;

alter table public.accounts
  add constraint accounts_currency_allowed
  check (currency in ('ARS', 'USD', 'EUR', 'BRL', 'CLP', 'COP', 'MXN', 'UYU'));
alter table public.transactions
  add constraint transactions_currency_allowed
  check (currency in ('ARS', 'USD', 'EUR', 'BRL', 'CLP', 'COP', 'MXN', 'UYU'));
alter table public.goals
  add constraint goals_currency_allowed
  check (currency in ('ARS', 'USD', 'EUR', 'BRL', 'CLP', 'COP', 'MXN', 'UYU'));

-- ---------- RLS compartida por hogar ----------
-- SELECT/UPDATE/DELETE alcanzan a todo el hogar; INSERT siempre queda a tu
-- nombre (así se sabe quién cargó cada gasto). Sin hogar, esto es idéntico
-- a la política "solo mis filas" de antes.
do $$
declare
  t text;
  tables text[] := array[
    'categories', 'accounts', 'transactions', 'recurring_expenses',
    'transfers', 'goals', 'statement_payments', 'category_rules',
    'reimbursements'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    -- Políticas viejas de una sola tabla por usuario.
    execute format('drop policy if exists %I on public.%I', 'own ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'hh select ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'hh insert ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'hh update ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'hh delete ' || t, t);

    execute format(
      'create policy %I on public.%I for select using (user_id in (select public.shared_user_ids()))',
      'hh select ' || t, t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id)',
      'hh insert ' || t, t);
    execute format(
      'create policy %I on public.%I for update using (user_id in (select public.shared_user_ids())) with check (user_id in (select public.shared_user_ids()))',
      'hh update ' || t, t);
    execute format(
      'create policy %I on public.%I for delete using (user_id in (select public.shared_user_ids()))',
      'hh delete ' || t, t);
  end loop;
end;
$$;

-- La política de recurrentes se llamaba "own recurring", no "own recurring_expenses".
drop policy if exists "own recurring" on public.recurring_expenses;

-- ---------- Saldos: ahora alcanzan a todo el hogar ----------
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
      ), 0)
    - coalesce((
        select sum(sp.amount)
        from public.statement_payments sp
        where sp.paid_from_account_id = a.id
      ), 0)
    + coalesce((
        select sum(rb.amount)
        from public.reimbursements rb
        where rb.account_id = a.id
      ), 0) as balance
  from public.accounts a
  where a.user_id in (select public.shared_user_ids());
$$;

-- ---------- Patrimonio neto mes a mes ----------
-- Devuelve, por cada uno de los últimos N meses y por moneda, la suma de los
-- saldos de todas las cuentas al cierre de ese mes (para el mes en curso, a
-- hoy). Las tarjetas suman en negativo, así que la deuda ya está descontada.
create or replace function public.net_worth_series(months integer default 12)
returns table (month date, currency text, balance numeric)
language sql
security invoker
stable
as $$
  with bounds as (
    select least(
      (date_trunc('month', current_date) - ((n) || ' months')::interval
        + interval '1 month - 1 day')::date,
      current_date
    ) as cutoff
    from generate_series(greatest(months, 1) - 1, 0, -1) as n
  ),
  acc as (
    select id, currency, initial_balance
    from public.accounts
    where user_id in (select public.shared_user_ids())
  )
  select
    b.cutoff as month,
    a.currency,
    sum(
      a.initial_balance
      + coalesce((
          select sum(case when t.type = 'income' then t.amount else -t.amount end)
          from public.transactions t
          where t.account_id = a.id and t.transaction_date <= b.cutoff
        ), 0)
      + coalesce((
          select sum(tr.to_amount)
          from public.transfers tr
          where tr.to_account_id = a.id and tr.transfer_date <= b.cutoff
        ), 0)
      - coalesce((
          select sum(tr.amount)
          from public.transfers tr
          where tr.from_account_id = a.id and tr.transfer_date <= b.cutoff
        ), 0)
      - coalesce((
          select sum(sp.amount)
          from public.statement_payments sp
          where sp.paid_from_account_id = a.id and sp.paid_date <= b.cutoff
        ), 0)
      + coalesce((
          select sum(rb.amount)
          from public.reimbursements rb
          where rb.account_id = a.id and rb.received_date <= b.cutoff
        ), 0)
    ) as balance
  from bounds b
  cross join acc a
  group by b.cutoff, a.currency
  order by b.cutoff, a.currency;
$$;

-- ---------- Auto-posteo de recurrentes ----------
-- Genera las transacciones de las reglas con auto_post vencidas y avanza la
-- fecha. Idempotente gracias a uq_tx_recurring_occurrence.
create or replace function public.post_due_recurring(p_user_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  due date;
  posted integer;
  total integer := 0;
begin
  for r in
    select * from public.recurring_expenses
    where is_active and auto_post
      and (p_user_id is null or user_id = p_user_id)
  loop
    due := r.next_due_date;
    posted := 0;

    while due <= current_date loop
      insert into public.transactions
        (user_id, category_id, account_id, amount, description,
         transaction_date, type, recurring_id)
      values
        (r.user_id, r.category_id, r.account_id, r.amount, r.name,
         due, 'expense', r.id)
      on conflict do nothing;

      posted := posted + 1;
      exit when r.frequency = 'once';

      due := (case r.frequency
        when 'weekly' then due + interval '7 days'
        when 'monthly' then due + interval '1 month'
        when 'yearly' then due + interval '1 year'
        else due + interval '1 month'
      end)::date;
    end loop;

    if posted > 0 then
      total := total + posted;
      if r.frequency = 'once' then
        update public.recurring_expenses set is_active = false where id = r.id;
      else
        update public.recurring_expenses set next_due_date = due where id = r.id;
      end if;
    end if;
  end loop;

  return total;
end;
$$;

-- La versión sin argumentos (todos los usuarios) es solo para el cron.
revoke all on function public.post_due_recurring(uuid) from public, anon, authenticated;

-- Versión que puede llamar la app: solo pone al día tus propias reglas.
create or replace function public.post_due_recurring_me()
returns integer
language sql
security definer
set search_path = public
as $$
  select public.post_due_recurring(auth.uid());
$$;

grant execute on function public.post_due_recurring_me() to authenticated;

-- ---------- Storage: fotos de tickets ----------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

drop policy if exists "receipts read" on storage.objects;
create policy "receipts read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] in (
      select s::text from public.shared_user_ids() as s
    )
  );

drop policy if exists "receipts write" on storage.objects;
create policy "receipts write" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "receipts delete" on storage.objects;
create policy "receipts delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------- Tarea diaria: postear recurrentes vencidos ----------
-- Si tu proyecto no tiene pg_cron habilitado, esto no rompe el script: la app
-- sigue haciendo el catch-up al abrirse.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('post-due-recurring')
  where exists (select 1 from cron.job where jobname = 'post-due-recurring');
  perform cron.schedule(
    'post-due-recurring',
    '5 3 * * *',
    $cron$select public.post_due_recurring()$cron$
  );
exception when others then
  raise notice 'pg_cron no disponible (%). El auto-posteo queda a cargo de la app.', sqlerrm;
end;
$$;

-- ---------- Tarea diaria: avisos push de vencimientos ----------
-- Requiere tu URL de proyecto y tu service_role key, así que se activa a mano.
-- Copiá esto en el SQL Editor reemplazando los dos valores (ver README):
--
--   create extension if not exists pg_net;
--   select cron.schedule(
--     'due-notifications',
--     '0 12 * * *',
--     $$
--     select net.http_post(
--       url     := 'https://TU-PROYECTO.supabase.co/functions/v1/send-due-notifications',
--       headers := '{"Content-Type":"application/json","Authorization":"Bearer TU_SERVICE_ROLE_KEY"}'::jsonb,
--       body    := '{}'::jsonb
--     );
--     $$
--   );
