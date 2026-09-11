-- FadeUp — PLAT-1 (5/5) : les durcissements de la revue indépendante.
--
-- Six points, tous trouvés par la revue, tous corrigés ici.
--
-- 1. LE JOURNAL ÉTAIT TRONCABLE. Le déclencheur d'immuabilité est
--    `for each row` : il ne se déclenche PAS sur TRUNCATE, et `service_role`
--    conservait ce droit. Un journal qu'on peut vider d'un geste n'est pas un
--    journal. Ajout d'un déclencheur `for each statement` sur TRUNCATE, et
--    révocation des trois verbes destructeurs à `service_role`.
--
-- 2. « SEUL LE FONDATEUR GÈRE LES RÔLES » FUYAIT PAR LA RÉVOCATION.
--    `create_platform_invitation` est passée au fondateur, pas
--    `revoke_platform_invitation` : un admin pouvait donc annuler l'invitation
--    que le fondateur venait d'émettre. Fermé.
--
-- 3. LA GRILLE N'ÉTAIT PAS L'AUTORITÉ SUR SES PROPRES ÉCRANS. Le journal
--    d'audit se gardait encore par `is_platform_admin()` et le trombinoscope
--    aussi : donner `audit.read` à un rôle dans la grille aurait changé la
--    navigation sans changer les données. Les deux passent par la grille.
--
-- 4. LA CONSOLE MONTRAIT DE FAUX ÉTATS VIDES. Un modérateur ouvrant la fiche
--    d'une organisation lisait « No locations yet » sur un salon qui en a —
--    il n'avait simplement pas le droit de les lire. C'est de la donnée
--    opérationnelle fausse, l'interdit central de CLAUDE.md. Les quatre
--    policies de détail locataire passent par la grille avec
--    `tenant.read_detail`, accordé EXACTEMENT au même ensemble qu'avant
--    (fondateur + admin) : la sémantique ne bouge pas d'un pouce, mais
--    l'interface peut enfin POSER la question et ne rien rendre plutôt que de
--    mentir.
--
-- 5. LA LECTURE DU CRM ÉTAIT DEVENUE UNE SOUS-REQUÊTE CORRÉLÉE. Mesuré :
--    `platform_prospect_visible(id)` référence une colonne, donc le
--    planificateur l'exécute UNE FOIS PAR LIGNE (52 exécutions sur 52 lignes,
--    26 ms). À 20 000 prospects, l'écran d'acquisition devient inutilisable.
--    Ajout d'un premier terme non corrélé : pour un rôle à lecture complète,
--    le planificateur en fait un InitPlan évalué une seule fois et n'exécute
--    plus la sous-requête du tout. Sémantique inchangée —
--    `platform_prospect_visible` rendait déjà `true` dans ce cas.
--
-- 6. DES CONCESSIONS `anon` INUTILES SURVIVAIENT sur deux tables que ce lot
--    touche. La RLS les bloque, mais l'invariant X3 dit qu'un droit inutile
--    finit par servir — et `platform_notifications` portait les QUATRE verbes.
--
-- À APPLIQUER EN postgres (propriétaires vérifiés : les quatre tables de
-- détail locataire, platform_audit_log, platform_members,
-- platform_notifications et les deux fonctions lui appartiennent ;
-- concédant des droits retirés : postgres, vérifié par aclexplode).
-- Après 20260911100100. Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ============================================================================
-- 1. Le journal n'est plus tronçable
-- ============================================================================

drop trigger if exists platform_audit_log_append_only_truncate on public.platform_audit_log;
create trigger platform_audit_log_append_only_truncate
  before truncate on public.platform_audit_log
  for each statement execute function public.reject_platform_audit_mutation();

-- `service_role` est le rôle des fonctions de bord : il écrit, il ne réécrit
-- pas. INSERT et SELECT lui restent, le reste part.
revoke update, delete, truncate on public.platform_audit_log from service_role;

-- ============================================================================
-- 2 et 6. Concessions inutiles
-- ============================================================================

revoke all on public.platform_members from anon;
revoke all on public.platform_notifications from anon;

-- ============================================================================
-- 3. Les deux droits qui manquaient à la grille
-- ============================================================================

insert into public.platform_permissions (key, description) values
  ('internal_team.read',  'Voir le trombinoscope interne : qui est là, avec quel rôle et quelles zones.'),
  ('tenant.read_detail',  'Lire le détail d''une organisation : établissements, équipe, barbers, profils.')
on conflict (key) do update set description = excluded.description;

-- Accordés EXACTEMENT à l'ensemble que couvrait is_platform_admin() : aucun
-- rôle ne gagne ni ne perd quoi que ce soit aujourd'hui.
insert into public.platform_role_permissions (role, permission_key) values
  ('platform_owner', 'internal_team.read'),
  ('platform_admin', 'internal_team.read'),
  ('platform_owner', 'tenant.read_detail'),
  ('platform_admin', 'tenant.read_detail')
on conflict (role, permission_key) do nothing;

-- ============================================================================
-- 4. La grille devient l'autorité sur les écrans du lot
-- ============================================================================

drop policy if exists platform_audit_log_select on public.platform_audit_log;
create policy platform_audit_log_select
  on public.platform_audit_log for select to authenticated
  using ((select private.platform_can('audit.read')));

comment on policy platform_audit_log_select on public.platform_audit_log is
  'Le journal est lu par les porteurs de audit.read — fondateur et admins. Passe par la grille et non par is_platform_admin(), pour qu''il n''existe qu''UN endroit où cette décision se lit.';

drop policy if exists locations_select on public.locations;
create policy locations_select
  on public.locations for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.platform_can('tenant.read_detail'))
  );

drop policy if exists memberships_select on public.memberships;
create policy memberships_select
  on public.memberships for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.platform_can('tenant.read_detail'))
  );

drop policy if exists barbers_select on public.barbers;
create policy barbers_select
  on public.barbers for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.platform_can('tenant.read_detail'))
  );

drop policy if exists staff_profiles_select on public.staff_profiles;
create policy staff_profiles_select
  on public.staff_profiles for select to authenticated
  using (
    (select private.is_org_member(organization_id))
    or (select private.platform_can('tenant.read_detail'))
  );

-- ============================================================================
-- 5. La lecture du CRM redevient un InitPlan pour les rôles à lecture complète
-- ============================================================================

drop policy if exists prospects_select_platform_staff on public.prospects;
create policy prospects_select_platform_staff
  on public.prospects for select to authenticated
  using (
    (select private.platform_can('crm.read'))
    or (select private.platform_prospect_visible(id))
  );

comment on policy prospects_select_platform_staff on public.prospects is
  'Lecture complète pour crm.read ; sinon, pour un rôle borné (le stagiaire), ses zones et ses propres saisies ; rien pour le support, le modérateur et l''extérieur. Le premier terme ne référence AUCUNE colonne : le planificateur en fait un InitPlan évalué une seule fois, et n''exécute la sous-requête corrélée que pour les rôles qui en ont besoin.';

drop policy if exists prospect_locations_select_platform_staff on public.prospect_locations;
create policy prospect_locations_select_platform_staff
  on public.prospect_locations for select to authenticated
  using (
    (select private.platform_can('crm.read'))
    or (select private.platform_prospect_visible(prospect_id))
  );

drop policy if exists prospect_contacts_select_platform_staff on public.prospect_contacts;
create policy prospect_contacts_select_platform_staff
  on public.prospect_contacts for select to authenticated
  using (
    (select private.platform_can('crm.read'))
    or (select private.platform_prospect_visible(prospect_id))
  );

drop policy if exists prospect_notes_select_platform_staff on public.prospect_notes;
create policy prospect_notes_select_platform_staff
  on public.prospect_notes for select to authenticated
  using (
    (select private.platform_can('crm.read'))
    or (select private.platform_prospect_visible(prospect_id))
  );

drop policy if exists prospect_events_select_platform_staff on public.prospect_events;
create policy prospect_events_select_platform_staff
  on public.prospect_events for select to authenticated
  using (
    (select private.platform_can('crm.read'))
    or (select private.platform_prospect_visible(prospect_id))
  );

commit;

-- ============================================================================
-- 2bis et 3bis. Les deux fonctions, corps repris verbatim, garde changée
-- ============================================================================

begin;

create or replace function public.revoke_platform_invitation(p_id uuid)
returns platform_invitations
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_invitation public.platform_invitations;
begin
  -- Révoquer une invitation est un geste de gestion des rôles internes au même
  -- titre que l'émettre : un admin ne doit pas pouvoir annuler ce que le
  -- fondateur vient d'émettre. (La création était déjà passée au fondateur ;
  -- la révocation avait été oubliée — trouvé par la revue.)
  if (select auth.uid()) is null or not (select private.platform_can('internal_roles.manage')) then
    raise exception 'seul le fondateur révoque une invitation interne'
      using errcode = '42501', detail = 'fadeup_platform_refusal=internal_roles_manage_required';
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

create or replace function public.list_platform_team()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role public.platform_role,
  note text,
  created_at timestamptz,
  zones jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    pm.user_id,
    u.email::text,
    nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
    pm.role,
    pm.note,
    pm.created_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'country', z.country, 'city', z.city) order by z.label)
        from public.platform_member_zones mz
        join public.platform_zones z on z.id = mz.zone_id
        where mz.user_id = pm.user_id
      ),
      '[]'::jsonb
    )
  from public.platform_members pm
  join auth.users u on u.id = pm.user_id
  where (select private.platform_can('internal_team.read'))
  order by pm.created_at;
$$;

comment on function public.list_platform_team() is
  'Le trombinoscope interne : qui est là, avec quel rôle, quelles zones, depuis quand. Gardée par internal_team.read — la grille, et non is_platform_admin(), pour qu''il n''existe qu''UN endroit où cette décision se lit. Rend zéro ligne à tout autre appelant plutôt que de lever : c''est une lecture de liste. L''e-mail vient de auth.users, hors de portée d''une policy — d''où le SECURITY DEFINER.';

revoke all on function public.list_platform_team() from public, anon;
grant execute on function public.list_platform_team() to authenticated;

commit;
