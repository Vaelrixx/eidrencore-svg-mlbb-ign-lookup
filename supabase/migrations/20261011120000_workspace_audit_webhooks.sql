create table if not exists public.developer_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 48),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.developer_workspace_members (
  workspace_id uuid not null references public.developer_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.developer_workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.developer_workspaces(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token_hash text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists developer_workspace_invites_email_idx on public.developer_workspace_invites(lower(email), expires_at) where accepted_at is null;

create table if not exists public.developer_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.developer_workspaces(id) on delete set null,
  action text not null check (char_length(action) between 1 and 80),
  resource_type text not null check (char_length(resource_type) between 1 and 60),
  resource_id text,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists developer_audit_logs_user_created_idx on public.developer_audit_logs(user_id, created_at desc);
create index if not exists developer_audit_logs_workspace_created_idx on public.developer_audit_logs(workspace_id, created_at desc);

create table if not exists public.developer_webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.developer_workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  url text not null check (char_length(url) <= 2048),
  secret_hash text not null,
  secret_ciphertext text not null,
  events text[] not null default array['api.key.created','api.key.revoked','billing.subscription.activated']::text[],
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists developer_webhook_endpoints_user_idx on public.developer_webhook_endpoints(user_id, created_at desc);

create table if not exists public.developer_webhook_deliveries (
  id bigint generated always as identity primary key,
  endpoint_id uuid not null references public.developer_webhook_endpoints(id) on delete cascade,
  event_id uuid not null,
  event_type text not null,
  response_status integer,
  response_ms integer,
  attempt integer not null default 1 check (attempt between 1 and 10),
  delivered boolean not null default false,
  error_code text,
  created_at timestamptz not null default now()
);
create index if not exists developer_webhook_deliveries_endpoint_created_idx on public.developer_webhook_deliveries(endpoint_id, created_at desc);

create table if not exists public.developer_api_request_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  api_key_id uuid references public.api_keys(id) on delete set null,
  request_id uuid not null,
  endpoint text not null default '/api/lookup',
  http_status integer not null,
  response_ms integer not null check (response_ms >= 0),
  created_at timestamptz not null default now()
);
create index if not exists developer_api_request_logs_user_created_idx on public.developer_api_request_logs(user_id, created_at desc);
create index if not exists developer_api_request_logs_key_created_idx on public.developer_api_request_logs(api_key_id, created_at desc);

alter table public.api_keys add column if not exists workspace_id uuid references public.developer_workspaces(id) on delete set null;

alter table public.developer_workspaces enable row level security;
alter table public.developer_workspace_members enable row level security;
alter table public.developer_workspace_invites enable row level security;
alter table public.developer_audit_logs enable row level security;
alter table public.developer_webhook_endpoints enable row level security;
alter table public.developer_webhook_deliveries enable row level security;
alter table public.developer_api_request_logs enable row level security;

revoke all on public.developer_workspaces, public.developer_workspace_members, public.developer_workspace_invites,
  public.developer_audit_logs, public.developer_webhook_endpoints, public.developer_webhook_deliveries,
  public.developer_api_request_logs from anon, authenticated, public;
grant select, insert, update, delete on public.developer_workspaces, public.developer_workspace_members,
  public.developer_workspace_invites, public.developer_audit_logs, public.developer_webhook_endpoints,
  public.developer_webhook_deliveries, public.developer_api_request_logs to service_role;
grant usage, select on sequence public.developer_audit_logs_id_seq, public.developer_webhook_deliveries_id_seq, public.developer_api_request_logs_id_seq to service_role;

-- The server uses the service role only after checking the authenticated user in application code.
-- Workspace owner rows are inserted alongside workspace creation and keep owner membership explicit.
