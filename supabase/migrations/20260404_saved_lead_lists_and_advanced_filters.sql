create table if not exists public.saved_lead_lists (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (profile_id, name)
);

alter table public.saved_establishments
  add column if not exists list_id uuid references public.saved_lead_lists (id) on delete set null;

create index if not exists idx_saved_lead_lists_profile_id on public.saved_lead_lists (profile_id, created_at desc);
create index if not exists idx_saved_establishments_list_id on public.saved_establishments (list_id);

create trigger set_saved_lead_lists_updated_at
before update on public.saved_lead_lists
for each row execute function public.set_updated_at();

alter table public.saved_lead_lists enable row level security;

create policy "saved_lead_lists_select_own"
on public.saved_lead_lists
for select
using (auth.uid() = profile_id);

create policy "saved_lead_lists_insert_own"
on public.saved_lead_lists
for insert
with check (auth.uid() = profile_id);

create policy "saved_lead_lists_update_own"
on public.saved_lead_lists
for update
using (auth.uid() = profile_id)
with check (auth.uid() = profile_id);

create policy "saved_lead_lists_delete_own"
on public.saved_lead_lists
for delete
using (auth.uid() = profile_id);
