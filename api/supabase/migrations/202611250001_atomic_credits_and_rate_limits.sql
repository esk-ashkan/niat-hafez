-- Add database-backed per-user API rate limiting.
-- The existing consume_hafez_credit(bigint) function is intentionally preserved:
-- it returns JSON { ok, reason, profile } and already locks the profile row.
-- Do not drop or replace it from this migration.

create table if not exists public.api_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

create or replace function public.consume_api_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_key is null or length(p_key) = 0
     or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_arguments';
  end if;

  insert into public.api_rate_limits(rate_key, window_started_at, request_count)
  values (p_key, now(), 1)
  on conflict (rate_key) do update
  set
    window_started_at = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then now()
      else public.api_rate_limits.window_started_at
    end,
    request_count = case
      when public.api_rate_limits.window_started_at
        <= now() - make_interval(secs => p_window_seconds)
      then 1
      else public.api_rate_limits.request_count + 1
    end
  returning request_count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_hafez_credit(bigint) from public, anon, authenticated;
revoke all on function public.consume_api_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_hafez_credit(bigint) to service_role;
grant execute on function public.consume_api_rate_limit(text, integer, integer) to service_role;
revoke all on public.api_rate_limits from anon, authenticated;
grant select, insert, update, delete on public.api_rate_limits to service_role;

-- Restrict payment credit-granting RPC to the backend service role.
revoke all on function public.process_paid_payment(bigint) from public, anon, authenticated;
grant execute on function public.process_paid_payment(bigint) to service_role;
