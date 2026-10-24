-- Surface quota exhaustion (and other bounded diagnostics) on the status rollup.
-- Nullable: all historical rows stay valid. CHECK keeps the column low-cardinality
-- and injection-proof at the DB layer, mirroring the telemetry allowlist.
alter table public.lookup_logs
  add column if not exists failure_reason text null;

alter table public.lookup_logs
  drop constraint if exists lookup_logs_failure_reason_check;

alter table public.lookup_logs
  add constraint lookup_logs_failure_reason_check
  check (failure_reason is null or failure_reason in (
    'missing_config', 'invalid_input', 'http_error', 'network_or_timeout',
    'unrecognized_response', 'provider_error', 'identity_echo', 'quota_exhausted'
  ));

create index if not exists lookup_logs_source_created_reason_idx
  on public.lookup_logs (source, created_at desc, failure_reason);
