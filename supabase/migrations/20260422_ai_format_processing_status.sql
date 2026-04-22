alter table public.search_ai_format_orders
  add column if not exists format_status text not null default 'idle',
  add column if not exists format_started_at timestamptz,
  add column if not exists format_finished_at timestamptz;

update public.search_ai_format_orders
set format_status = case
  when formatted_payload is not null then 'ready'
  when format_error is not null then 'error'
  else coalesce(format_status, 'idle')
end,
format_finished_at = case
  when formatted_payload is not null then coalesce(format_finished_at, formatted_at)
  when format_error is not null then coalesce(format_finished_at, updated_at)
  else format_finished_at
end
where format_status is null
   or format_status not in ('idle', 'processing', 'ready', 'error')
   or (formatted_payload is not null and format_status <> 'ready')
   or (format_error is not null and format_status <> 'error');

alter table public.search_ai_format_orders
  drop constraint if exists search_ai_format_orders_format_status_check;

alter table public.search_ai_format_orders
  add constraint search_ai_format_orders_format_status_check
  check (format_status in ('idle', 'processing', 'ready', 'error'));

create index if not exists idx_search_ai_format_orders_format_status
  on public.search_ai_format_orders (format_status);
