alter table public.stripe_webhook_events
  add column if not exists status text not null default 'received',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists processed_at timestamptz,
  add column if not exists last_error text,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

update public.stripe_webhook_events
set
  status = coalesce(status, 'processed'),
  processed_at = coalesce(processed_at, created_at),
  updated_at = timezone('utc', now())
where status is null
   or status <> 'processed'
   or processed_at is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stripe_webhook_events_status_check'
  ) then
    alter table public.stripe_webhook_events
      add constraint stripe_webhook_events_status_check
      check (status in ('received', 'processing', 'processed', 'failed'));
  end if;
end $$;

drop trigger if exists set_stripe_webhook_events_updated_at on public.stripe_webhook_events;

create trigger set_stripe_webhook_events_updated_at
before update on public.stripe_webhook_events
for each row execute function public.set_updated_at();
