alter table public.search_ai_format_orders
  add column if not exists format_progress integer not null default 0,
  add column if not exists format_cursor integer not null default 0,
  add column if not exists format_attempts integer not null default 0,
  add column if not exists format_last_heartbeat_at timestamptz,
  add column if not exists format_job_payload jsonb,
  add column if not exists format_lock_token text,
  add column if not exists format_lock_acquired_at timestamptz;

create index if not exists idx_search_ai_format_orders_processing_heartbeat
  on public.search_ai_format_orders (format_status, format_last_heartbeat_at);
