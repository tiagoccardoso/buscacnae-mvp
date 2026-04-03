update public.search_results sr
set profile_id = sq.profile_id
from public.search_queries sq
where sr.search_query_id = sq.id
  and sq.profile_id is not null
  and sr.profile_id is distinct from sq.profile_id;

update public.search_access_orders sao
set profile_id = sq.profile_id,
    email = case
      when coalesce(nullif(trim(sao.email), ''), '') = ''
        and coalesce(nullif(trim(p.email), ''), '') <> '' then p.email
      else sao.email
    end
from public.search_queries sq
left join public.profiles p on p.id = sq.profile_id
where sao.search_query_id = sq.id
  and (
    (sq.profile_id is not null and sao.profile_id is distinct from sq.profile_id)
    or coalesce(nullif(trim(sao.email), ''), '') = ''
  );

with ranked_orders as (
  select
    id,
    row_number() over (
      partition by search_query_id
      order by
        case
          when status = 'paid' then 0
          when status = 'free' then 1
          else 2
        end,
        coalesce(unlocked_at, paid_at, created_at) desc,
        created_at desc,
        id desc
    ) as rn
  from public.search_access_orders
)
delete from public.search_access_orders sao
using ranked_orders ranked
where sao.id = ranked.id
  and ranked.rn > 1;

with missing_orders as (
  select
    sq.id as search_query_id,
    sq.profile_id,
    p.email,
    sq.provider,
    case
      when sr.result_count > 0 then sr.result_count
      else coalesce(sq.total_results, 0)
    end::integer as result_count
  from public.search_queries sq
  join public.profiles p
    on p.id = sq.profile_id
  left join lateral (
    select count(*)::integer as result_count
    from public.search_results sr
    where sr.search_query_id = sq.id
  ) sr on true
  left join public.search_access_orders sao
    on sao.search_query_id = sq.id
  where sq.profile_id is not null
    and sao.id is null
    and coalesce(nullif(trim(p.email), ''), '') <> ''
)
insert into public.search_access_orders (
  access_token,
  profile_id,
  email,
  provider,
  search_query_id,
  result_count,
  unit_amount_cents,
  total_amount_cents,
  currency,
  status,
  paid_at,
  unlocked_at
)
select
  encode(gen_random_bytes(24), 'hex') as access_token,
  profile_id,
  email,
  provider,
  search_query_id,
  result_count,
  5 as unit_amount_cents,
  case
    when result_count > 0 then greatest(result_count * 5, 50)
    else 0
  end as total_amount_cents,
  'brl' as currency,
  case
    when result_count = 0 then 'free'
    else 'pending'
  end as status,
  case
    when result_count = 0 then timezone('utc', now())
    else null
  end as paid_at,
  case
    when result_count = 0 then timezone('utc', now())
    else null
  end as unlocked_at
from missing_orders;

create unique index if not exists idx_search_access_orders_search_query_unique
  on public.search_access_orders (search_query_id);
