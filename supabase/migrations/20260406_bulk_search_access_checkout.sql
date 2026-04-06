create table if not exists public.search_access_bulk_orders (
  id uuid primary key default gen_random_uuid(),
  access_token text not null unique,
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  order_ids jsonb not null default '[]'::jsonb,
  order_count integer not null default 0,
  total_amount_cents integer not null default 0,
  currency text not null default 'brl',
  status text not null default 'pending',
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  checkout_url text,
  paid_at timestamptz,
  unlocked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_search_access_bulk_orders_profile_created_at
  on public.search_access_bulk_orders (profile_id, created_at desc);

create trigger set_search_access_bulk_orders_updated_at
before update on public.search_access_bulk_orders
for each row execute function public.set_updated_at();

alter table public.search_access_bulk_orders enable row level security;

create policy "search_access_bulk_orders_select_own"
on public.search_access_bulk_orders
for select
to authenticated
using (auth.uid() = profile_id);
