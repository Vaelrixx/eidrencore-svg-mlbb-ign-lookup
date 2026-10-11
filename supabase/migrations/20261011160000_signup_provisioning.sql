-- Provision the developer account row the moment an auth user is created, so
-- every sign-up path (email, Google, GitHub, Discord, Telegram) starts on the
-- free plan with a consistent subscription record.
--
-- The function never blocks sign-up: any failure is downgraded to a warning and
-- the application re-provisions lazily (ensureDeveloperAccount in src/lib/platform.ts).
create or replace function public.handle_new_developer_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.developer_subscriptions (user_id, plan_slug, status)
  values (new.id, 'free', 'free')
  on conflict (user_id) do nothing;
  return new;
exception when others then
  raise warning 'developer provisioning failed for user %: %', new.id, sqlerrm;
  return new;
end;
$function$;

revoke all on function public.handle_new_developer_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_developer on auth.users;
create trigger on_auth_user_created_developer
  after insert on auth.users
  for each row execute function public.handle_new_developer_user();

-- Backfill accounts created before this trigger existed.
insert into public.developer_subscriptions (user_id, plan_slug, status)
select u.id, 'free', 'free' from auth.users u
on conflict (user_id) do nothing;
