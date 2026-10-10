create index if not exists api_keys_workspace_id_idx on public.api_keys(workspace_id);
create index if not exists api_keys_plan_slug_idx on public.api_keys(plan_slug);
create index if not exists developer_subscriptions_plan_slug_idx on public.developer_subscriptions(plan_slug);
create index if not exists developer_webhook_endpoints_workspace_id_idx on public.developer_webhook_endpoints(workspace_id);
create index if not exists developer_workspace_invites_workspace_id_idx on public.developer_workspace_invites(workspace_id);
create index if not exists developer_workspace_invites_invited_by_idx on public.developer_workspace_invites(invited_by);
create index if not exists developer_workspace_members_user_id_idx on public.developer_workspace_members(user_id);
create index if not exists developer_workspaces_owner_user_id_idx on public.developer_workspaces(owner_user_id);
