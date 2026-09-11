-- FadeUp — retour arrière de 20260911100400_plat1_review_hardening.sql
--
-- Remet les gardes et les concessions d'avant les durcissements de la revue.
-- Ne RE-CONCÈDE pas à `anon` les droits retirés sur platform_members et
-- platform_notifications : ils étaient inutiles (la RLS ne les employait pas)
-- et un retour arrière n'a pas à rouvrir une porte. C'est déclaré ici plutôt
-- que découvert.
--
-- À passer AVANT le retour arrière de 20260911100100. À APPLIQUER EN postgres.

set lock_timeout = '5s';

begin;

drop trigger if exists platform_audit_log_append_only_truncate on public.platform_audit_log;
grant update, delete, truncate on public.platform_audit_log to service_role;

drop policy if exists platform_audit_log_select on public.platform_audit_log;
create policy platform_audit_log_select
  on public.platform_audit_log for select to authenticated
  using ((select private.is_platform_admin()));

drop policy if exists locations_select on public.locations;
create policy locations_select on public.locations for select to authenticated
  using ((select private.is_org_member(organization_id)) or (select private.is_platform_admin()));

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships for select to authenticated
  using ((select private.is_org_member(organization_id)) or (select private.is_platform_admin()));

drop policy if exists barbers_select on public.barbers;
create policy barbers_select on public.barbers for select to authenticated
  using ((select private.is_org_member(organization_id)) or (select private.is_platform_admin()));

drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select on public.staff_profiles for select to authenticated
  using ((select private.is_org_member(organization_id)) or (select private.is_platform_admin()));

drop policy if exists prospects_select_platform_staff on public.prospects;
create policy prospects_select_platform_staff on public.prospects for select to authenticated
  using ((select private.platform_prospect_visible(id)));

drop policy if exists prospect_locations_select_platform_staff on public.prospect_locations;
create policy prospect_locations_select_platform_staff on public.prospect_locations for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_contacts_select_platform_staff on public.prospect_contacts;
create policy prospect_contacts_select_platform_staff on public.prospect_contacts for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_notes_select_platform_staff on public.prospect_notes;
create policy prospect_notes_select_platform_staff on public.prospect_notes for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

drop policy if exists prospect_events_select_platform_staff on public.prospect_events;
create policy prospect_events_select_platform_staff on public.prospect_events for select to authenticated
  using ((select private.platform_prospect_visible(prospect_id)));

delete from public.platform_role_permissions where permission_key in ('internal_team.read', 'tenant.read_detail');
delete from public.platform_permissions where key in ('internal_team.read', 'tenant.read_detail');

commit;

begin;

-- revoke_platform_invitation : garde d'avant (admin).
create or replace function public.revoke_platform_invitation(p_id uuid)
returns platform_invitations
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_invitation public.platform_invitations;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may revoke a platform invitation';
  end if;

  update public.platform_invitations
  set revoked_at = now()
  where id = p_id and accepted_at is null and revoked_at is null
  returning * into v_invitation;

  if not found then
    raise exception 'platform invitation not found or already accepted/revoked';
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_revoked', 'platform_invitations', v_invitation.id, '{}'::jsonb);

  return v_invitation;
end;
$function$;

revoke all on function public.revoke_platform_invitation(uuid) from public, anon;
grant execute on function public.revoke_platform_invitation(uuid) to authenticated;

-- list_platform_team : garde d'avant (is_platform_admin).
create or replace function public.list_platform_team()
returns table (
  user_id uuid, email text, full_name text, role public.platform_role,
  note text, created_at timestamptz, zones jsonb
)
language sql security definer stable set search_path = ''
as $$
  select
    pm.user_id, u.email::text,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    pm.role, pm.note, pm.created_at,
    coalesce(
      (select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'country', z.country, 'city', z.city) order by z.label)
       from public.platform_member_zones mz join public.platform_zones z on z.id = mz.zone_id
       where mz.user_id = pm.user_id),
      '[]'::jsonb)
  from public.platform_members pm
  join auth.users u on u.id = pm.user_id
  where (select private.is_platform_admin())
  order by pm.created_at;
$$;

revoke all on function public.list_platform_team() from public, anon;
grant execute on function public.list_platform_team() to authenticated;

commit;
