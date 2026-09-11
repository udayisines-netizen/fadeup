-- Retour arrière — OS-2 équipe.
-- Rôle : postgres. Les policies `memberships` reviennent EXACTEMENT à leur
-- définition d'avant OS-2 (la faille d'escalade manager → owner revient
-- avec elles : c'est le prix d'un retour arrière fidèle, et c'est dit).
-- Aucune invitation, aucun membership, aucun profil n'est touché.
begin;

drop function if exists public.remove_team_member(uuid, uuid);
drop function if exists public.set_team_member_role(uuid, public.membership_role);
drop function if exists public.invite_team_member(uuid, text, public.membership_role, uuid);
drop function if exists public.list_team_invitations(uuid);
drop function if exists public.list_team_members(uuid);

drop policy if exists memberships_update on public.memberships;
create policy memberships_update
  on public.memberships
  for update
  to authenticated
  using ((select private.has_org_role(memberships.organization_id,
            array['owner', 'manager']::public.membership_role[])))
  with check (
    (select private.has_org_role(memberships.organization_id,
       array['owner', 'manager']::public.membership_role[]))
    and (role <> 'owner'::public.membership_role
         or (select private.has_org_role(memberships.organization_id,
               array['owner']::public.membership_role[])))
  );

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete
  on public.memberships
  for delete
  to authenticated
  using (
    (select private.has_org_role(memberships.organization_id,
       array['owner', 'manager']::public.membership_role[]))
    or user_id = (select auth.uid())
  );

commit;
