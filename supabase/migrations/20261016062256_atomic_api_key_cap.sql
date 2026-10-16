-- Serialize the active-key cap with the insert so parallel requests cannot exceed ten keys.
create or replace function public.create_developer_api_key(
  p_actor_user_id uuid,
  p_user_id uuid,
  p_workspace_id uuid,
  p_name text,
  p_key_hash text,
  p_key_prefix text,
  p_plan_slug text
)
returns table (
  id uuid,
  name text,
  key_prefix text,
  plan_slug text,
  created_at timestamptz,
  user_id uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active_count bigint;
  v_owner_user_id uuid;
begin
  if p_actor_user_id is null
    or p_user_id is null
    or p_name is null
    or pg_catalog.char_length(p_name) < 1
    or pg_catalog.char_length(p_name) > 80
    or p_key_hash is null
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_key_prefix is null
    or p_key_prefix !~ '^eid_[A-Za-z0-9_-]{8,16}$'
    or p_plan_slug is null
  then
    raise exception 'invalid_api_key_arguments' using errcode = '22023';
  end if;

  if p_workspace_id is null then
    if p_actor_user_id <> p_user_id then
      raise exception 'personal_key_owner_mismatch' using errcode = '42501';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('eidrencore:api-key:user:' || p_user_id::text, 0)
    );

    select pg_catalog.count(*) into v_active_count
    from public.api_keys k
    where k.user_id = p_user_id
      and k.workspace_id is null
      and k.key_prefix <> 'eid_playground'
      and k.revoked_at is null;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('eidrencore:api-key:workspace:' || p_workspace_id::text, 0)
    );

    select w.owner_user_id into v_owner_user_id
    from public.developer_workspaces w
    where w.id = p_workspace_id;

    if v_owner_user_id is null or p_user_id <> v_owner_user_id then
      raise exception 'workspace_not_found_or_owner_mismatch' using errcode = '42501';
    end if;

    if p_actor_user_id <> v_owner_user_id and not exists (
      select 1
      from public.developer_workspace_members m
      where m.workspace_id = p_workspace_id
        and m.user_id = p_actor_user_id
        and m.role in ('owner', 'admin')
    ) then
      raise exception 'workspace_admin_required' using errcode = '42501';
    end if;

    select pg_catalog.count(*) into v_active_count
    from public.api_keys k
    where k.workspace_id = p_workspace_id
      and k.revoked_at is null;
  end if;

  if v_active_count >= 10 then
    raise exception 'active_api_key_limit_reached' using errcode = 'P0001';
  end if;

  return query
  insert into public.api_keys as inserted_key (
    user_id, workspace_id, name, key_hash, key_prefix, plan_slug
  ) values (
    p_user_id, p_workspace_id, p_name, p_key_hash, p_key_prefix, p_plan_slug
  )
  returning inserted_key.id, inserted_key.name, inserted_key.key_prefix,
    inserted_key.plan_slug, inserted_key.created_at, inserted_key.user_id;
end;
$function$;

revoke all on function public.create_developer_api_key(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_developer_api_key(uuid, uuid, uuid, text, text, text, text)
  to service_role;
