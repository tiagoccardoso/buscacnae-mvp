create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  stripe_customer_id text unique,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'not_started',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.provider_cache (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  cache_key text not null unique,
  request_payload jsonb not null,
  response_payload jsonb not null,
  normalized_payload jsonb,
  fetched_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  provider text not null,
  cache_key text not null,
  cnae_code text not null,
  city_name text not null,
  state_code text not null,
  city_ibge text,
  query_payload jsonb not null,
  total_results integer not null default 0,
  cached boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.establishments (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null unique,
  cnpj_root text,
  company_name text not null,
  trade_name text,
  registration_status text,
  opened_at text,
  primary_cnae_code text,
  primary_cnae_description text,
  secondary_cnaes jsonb,
  legal_nature_code text,
  legal_nature_description text,
  company_size text,
  simples_opt_in boolean,
  mei_opt_in boolean,
  capital_social numeric(18,2),
  email text,
  phone text,
  website text,
  country text,
  state_code text,
  city_name text,
  city_ibge text,
  neighborhood text,
  cep text,
  address_line text,
  address_number text,
  complement text,
  provider_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.search_results (
  id uuid primary key default gen_random_uuid(),
  search_query_id uuid not null references public.search_queries (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  position integer not null,
  provider_payload jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  unique (search_query_id, establishment_id)
);

create table if not exists public.saved_establishments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  establishment_id uuid not null references public.establishments (id) on delete cascade,
  notes text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (profile_id, establishment_id)
);

create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_subscriptions_profile_id on public.subscriptions (profile_id);
create index if not exists idx_provider_cache_expires_at on public.provider_cache (expires_at);
create index if not exists idx_search_queries_profile_id_created_at on public.search_queries (profile_id, created_at desc);
create index if not exists idx_search_results_profile_id_search_query_id on public.search_results (profile_id, search_query_id);
create index if not exists idx_saved_establishments_profile_id on public.saved_establishments (profile_id);
create index if not exists idx_establishments_cnpj_root on public.establishments (cnpj_root);
create index if not exists idx_establishments_city_state on public.establishments (state_code, city_name);
create index if not exists idx_establishments_primary_cnae on public.establishments (primary_cnae_code);

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row execute function public.set_updated_at();

create trigger set_provider_cache_updated_at
before update on public.provider_cache
for each row execute function public.set_updated_at();

create trigger set_search_queries_updated_at
before update on public.search_queries
for each row execute function public.set_updated_at();

create trigger set_establishments_updated_at
before update on public.establishments
for each row execute function public.set_updated_at();

create trigger set_saved_establishments_updated_at
before update on public.saved_establishments
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.provider_cache enable row level security;
alter table public.search_queries enable row level security;
alter table public.establishments enable row level security;
alter table public.search_results enable row level security;
alter table public.saved_establishments enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = profile_id);

create policy "search_queries_select_own"
on public.search_queries
for select
to authenticated
using (auth.uid() = profile_id);

create policy "search_queries_insert_own"
on public.search_queries
for insert
to authenticated
with check (auth.uid() = profile_id);

create policy "search_results_select_own"
on public.search_results
for select
to authenticated
using (auth.uid() = profile_id);

create policy "saved_establishments_select_own"
on public.saved_establishments
for select
to authenticated
using (auth.uid() = profile_id);

create policy "saved_establishments_insert_own"
on public.saved_establishments
for insert
to authenticated
with check (auth.uid() = profile_id);

create policy "saved_establishments_delete_own"
on public.saved_establishments
for delete
to authenticated
using (auth.uid() = profile_id);

create policy "saved_establishments_update_own"
on public.saved_establishments
for update
to authenticated
using (auth.uid() = profile_id)
with check (auth.uid() = profile_id);

create policy "establishments_select_authenticated"
on public.establishments
for select
to authenticated
using (true);
