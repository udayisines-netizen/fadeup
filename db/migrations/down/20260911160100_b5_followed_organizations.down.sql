-- B5 — retour arrière du chantier 2 : list_my_followed_organizations revient
-- à son contrat d'origine (organization_id, followed_at), corps VERBATIM tel
-- que mesuré en production avant migration.
--
-- À APPLIQUER EN postgres. ACL rematérialisée à l'identique après le DROP.

begin;

drop function if exists public.list_my_followed_organizations();

create function public.list_my_followed_organizations()
returns table (
  organization_id uuid,
  followed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  return query
  select
    f.organization_id,
    f.followed_at
  from public.organization_follows f
  join public.organizations o
    on o.id = f.organization_id
  where f.follower_user_id = v_user_id
    and f.is_following = true
    and exists (
      select 1
      from public.get_public_organization(o.slug::text)
    )
  order by f.followed_at desc nulls last;
end;
$$;

comment on function public.list_my_followed_organizations() is
  'Returns the authenticated customer current active barbershop follows.';

grant execute on function public.list_my_followed_organizations() to authenticated;
grant execute on function public.list_my_followed_organizations() to service_role;

commit;
