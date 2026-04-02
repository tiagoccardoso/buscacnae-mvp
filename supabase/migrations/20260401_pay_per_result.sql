alter table public.search_queries
  alter column profile_id drop not null;

alter table public.search_results
  alter column profile_id drop not null;

create table if not exists public.search_access_orders (
  id uuid primary key default gen_random_uuid(),
  access_token text not null unique,
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  provider text not null,
  search_query_id uuid not null references public.search_queries (id) on delete cascade,
  result_count integer not null default 0,
  unit_amount_cents integer not null default 5,
  total_amount_cents integer not null default 0,
  currency text not null default 'brl',
  status text not null default 'pending',
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  checkout_url text,
  paid_at timestamptz,
  unlocked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_search_access_orders_profile_created_at
  on public.search_access_orders (profile_id, created_at desc);

create index if not exists idx_search_access_orders_search_query_id
  on public.search_access_orders (search_query_id);

create trigger set_search_access_orders_updated_at
before update on public.search_access_orders
for each row execute function public.set_updated_at();

alter table public.search_access_orders enable row level security;

create policy "search_access_orders_select_own"
on public.search_access_orders
for select
to authenticated
using (auth.uid() = profile_id);
