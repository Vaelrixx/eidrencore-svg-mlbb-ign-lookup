-- Atomic fixed-window limiter. The API stores only an HMAC of the client address.
-- SECURITY INVOKER is intentional: only service_role may execute this RPC, and the
-- existing usage_limits table grants access only to service_role.
create or replace function public.consume_lookup_limit(
  p_client_hash text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window_start timestamptz;
  v_request_count integer;
begin
  if p_client_hash is null or length(p_client_hash) <> 64
    or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400
    or p_max_requests is null or p_max_requests < 1 or p_max_requests > 10000 then
    raise exception 'invalid rate limit arguments' using errcode = '22023';
  end if;

  insert into public.usage_limits as current_limit (client_hash, window_start, request_count, updated_at)
  values (p_client_hash, v_now, 1, v_now)
  on conflict (client_hash) do update
  set
    window_start = case
      when current_limit.window_start <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
        then v_now
      else current_limit.window_start
    end,
    request_count = case
      when current_limit.window_start <= v_now - pg_catalog.make_interval(secs => p_window_seconds)
        then 1
      else LEAST(current_limit.request_count + 1, p_max_requests + 1)
    end,
    updated_at = v_now
  returning current_limit.window_start, current_limit.request_count
  into v_window_start, v_request_count;

  return query select
    v_request_count <= p_max_requests,
    GREATEST(0, p_max_requests - v_request_count),
    v_window_start + pg_catalog.make_interval(secs => p_window_seconds);
end;
$function$;

revoke all on function public.consume_lookup_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_lookup_limit(text, integer, integer) to service_role;
