create table if not exists public.search_ai_format_orders (
  id uuid primary key default gen_random_uuid(),
  access_token text not null unique,
  profile_id uuid references public.profiles (id) on delete set null,
  email text not null,
  search_query_id uuid not null references public.search_queries (id) on delete cascade,
  amount_cents integer not null default 1000,
  currency text not null default 'brl',
  status text not null default 'pending',
  stripe_customer_id text,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  checkout_url text,
  formatted_payload jsonb,
  format_error text,
  formatted_at timestamptz,
  paid_at timestamptz,
  unlocked_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (search_query_id)
);

create index if not exists idx_search_ai_format_orders_profile_created_at
  on public.search_ai_format_orders (profile_id, created_at desc);

create index if not exists idx_search_ai_format_orders_search_query_id
  on public.search_ai_format_orders (search_query_id);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_search_ai_format_orders_updated_at'
  ) then
    create trigger set_search_ai_format_orders_updated_at
    before update on public.search_ai_format_orders
    for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.search_ai_format_orders enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'search_ai_format_orders'
      and policyname = 'search_ai_format_orders_select_own'
  ) then
    create policy "search_ai_format_orders_select_own"
    on public.search_ai_format_orders
    for select
    to authenticated
    using (auth.uid() = profile_id);
  end if;
end $$;
