-- FadeUp — OS-2 : l'équipe.
--
-- RÔLE D'APPLICATION : postgres (fonctions NEUVES + deux policies de
-- `memberships`, table possédée par postgres — vérifié avant écriture).
--
-- CE QUE TRANCHE CE FICHIER
--
-- 1. INVITER PAR E-MAIL, SANS SECOND SYSTÈME D'ENVOI. `invitations` existe,
--    son trigger `notify_new_invitation` dépose déjà une ligne dans
--    `email_outbox` avec le gabarit `team_invitation` (fr + en), et le
--    distributeur B2 y ajoute le jeton sous sa propre connexion. OS-2
--    n'ajoute donc RIEN à la chaîne d'envoi : il ajoute la RPC qui crée la
--    ligne proprement. Ce qu'elle corrige au passage : le jeton était
--    fabriqué DANS LE NAVIGATEUR (`src/lib/invitation-token.ts`, chemin
--    hérité). Un secret d'invitation se fabrique côté serveur,
--    `extensions.gen_random_bytes(32)`.
--
-- 2. L'EXPIRATION : SEPT JOURS, à usage unique. C'est le défaut déjà en
--    base (`invitations.expires_at`), et OS-2 le confirme plutôt que de le
--    changer. Sept jours couvre un week-end plus un jour férié — le cas
--    réel d'un barber qui commence un lundi et lit ses mails le mardi — et
--    reste assez court pour qu'une boîte mail compromise plus tard ne soit
--    pas une porte d'entrée permanente. Usage unique : `accept_invitation`
--    refuse un jeton déjà accepté ; renvoyer une invitation RÉVOQUE
--    l'ancienne et en émet une neuve (jeton neuf, échéance neuve), ce qui
--    rend un lien fuité inoffensif dès le renvoi.
--
-- 3. RETIRER UN BARBER NE SUPPRIME PAS SON PROFIL. Loi produit
--    (MASTER_SPEC §9 : identité à trois couches). `remove_team_member`
--    touche `memberships` (l'accès), `barbers` (le lien d'emploi) et
--    `staff_profiles` (le profil interne). Il ne touche JAMAIS
--    `professionals` : handle, abonnés, portfolio et historique public
--    survivent. Le sort du reste est tranché ici, pas laissé en suspens :
--      · rendez-vous futurs — RÉASSIGNÉS à un barber désigné (MASTER_SPEC
--        §14). Sans désignation, la RPC REFUSE en donnant le nombre : on
--        ne laisse pas un client avec un rendez-vous chez un absent, et on
--        ne l'annule pas non plus dans le dos du salon.
--      · file en cours — les personnes en attente passent au barber
--        désigné s'il tient une file, sinon à la file générale de
--        l'établissement. Elles ne sont jamais jetées. Chaque déplacement
--        est écrit dans `queue_entry_moves`.
--      · clients — `customer_professional_relationships` est indexé par
--        `professional_id`, pas par le lien d'emploi : les relations
--        SUIVENT la personne et restent lisibles par le salon pour son
--        historique. Rien à faire, et c'est délibéré.
--
-- 4. UNE FAILLE D'ESCALADE CORRIGÉE EN PASSANT. `memberships_update` et
--    `memberships_delete` laissaient un MANAGER modifier ou supprimer la
--    ligne d'un OWNER : le WITH CHECK n'interdisait que d'ATTRIBUER le rôle
--    owner, pas de le RETIRER. Un manager pouvait donc rétrograder son
--    propriétaire. Les deux policies gagnent la condition manquante sur
--    l'ANCIEN rôle. Trouvé en construisant l'écran équipe ; corrigé ici
--    parce que l'écran s'appuie dessus.
--
-- LE MOTIF NUL : chaque identifiant est testé `is null` avant usage ; les
-- gardes de rôle sont des EXISTENCE.

begin;

-- ---------------------------------------------------------------------------
-- 1. La faille d'escalade
-- ---------------------------------------------------------------------------

drop policy if exists memberships_update on public.memberships;
create policy memberships_update
  on public.memberships
  for update
  to authenticated
  using (
    (select private.has_org_role(memberships.organization_id,
       array['owner', 'manager']::public.membership_role[]))
    -- NEUF : la ligne d'un owner n'est modifiable que par un owner.
    and (
      memberships.role <> 'owner'::public.membership_role
      or (select private.has_org_role(memberships.organization_id,
            array['owner']::public.membership_role[]))
    )
  )
  with check (
    (select private.has_org_role(memberships.organization_id,
       array['owner', 'manager']::public.membership_role[]))
    and (
      role <> 'owner'::public.membership_role
      or (select private.has_org_role(memberships.organization_id,
            array['owner']::public.membership_role[]))
    )
  );

comment on policy memberships_update on public.memberships is
  'Owner/manager modifient l''équipe. La ligne d''un OWNER n''est modifiable que par un owner (USING), et attribuer le rôle owner exige d''être owner (WITH CHECK). Sans la première condition, un manager pouvait rétrograder son propriétaire — corrigé par OS-2.';

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete
  on public.memberships
  for delete
  to authenticated
  using (
    (
      (select private.has_org_role(memberships.organization_id,
         array['owner', 'manager']::public.membership_role[]))
      -- NEUF : seul un owner retire un owner.
      and (
        memberships.role <> 'owner'::public.membership_role
        or (select private.has_org_role(memberships.organization_id,
              array['owner']::public.membership_role[]))
      )
    )
    -- Un membre peut toujours quitter de lui-même.
    or user_id = (select auth.uid())
  );

comment on policy memberships_delete on public.memberships is
  'Owner/manager retirent un membre ; seul un owner retire un owner ; chacun peut partir de lui-même. La restriction sur le rôle owner est neuve (OS-2) : un manager pouvait retirer son propriétaire.';

-- ---------------------------------------------------------------------------
-- 2. Lire l'équipe
-- ---------------------------------------------------------------------------

create or replace function public.list_team_members(p_organization_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  role public.membership_role,
  can_view_revenue boolean,
  is_me boolean,
  staff_profile_id uuid,
  display_name text,
  title text,
  avatar_url text,
  location_id uuid,
  location_name text,
  is_active boolean,
  barber_id uuid,
  is_bookable boolean,
  queue_enabled boolean,
  professional_id uuid,
  professional_handle text,
  upcoming_appointments integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to read this team'
      using errcode = '42501', detail = 'fadeup_team_refusal=not_authorized';
  end if;

  return query
  select
    m.id,
    m.user_id,
    m.role,
    m.can_view_revenue,
    m.user_id is not distinct from v_actor,
    sp.id,
    coalesce(nullif(btrim(sp.display_name), ''), '—'),
    sp.title,
    sp.avatar_url,
    sp.location_id,
    l.name,
    coalesce(sp.is_active, false),
    b.id,
    b.is_bookable,
    b.queue_enabled,
    b.professional_id,
    pro.handle,
    coalesce((
      select count(*)::integer from public.appointments a
      where a.barber_id = b.id
        and a.starts_at > now()
        and a.status in ('pending', 'confirmed')
    ), 0),
    m.created_at
  from public.memberships m
  left join public.staff_profiles sp
    on sp.organization_id = m.organization_id and sp.user_id = m.user_id
  left join public.locations l on l.id = sp.location_id
  left join public.barbers b on b.staff_profile_id = sp.id
  left join public.professionals pro on pro.id = b.professional_id
  where m.organization_id = p_organization_id
  order by
    case m.role when 'owner' then 0 when 'manager' then 1 when 'receptionist' then 2 else 3 end,
    coalesce(nullif(btrim(sp.display_name), ''), ''),
    m.created_at;
end;
$$;

comment on function public.list_team_members(uuid) is
  'L''équipe d''une organisation, les trois couches d''identité réunies : membership (accès), staff_profile (profil interne), barber (lien d''emploi) et le handle du professionnel. Réservée aux rôles gestionnaires : un barber n''a pas d''écran équipe.';

revoke all on function public.list_team_members(uuid) from public, anon;
grant execute on function public.list_team_members(uuid) to authenticated;


create or replace function public.list_team_invitations(p_organization_id uuid)
returns table (
  id uuid,
  email text,
  role public.membership_role,
  location_id uuid,
  location_name text,
  invited_by uuid,
  invited_by_name text,
  expires_at timestamptz,
  is_expired boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to read these invitations'
      using errcode = '42501', detail = 'fadeup_team_refusal=not_authorized';
  end if;

  return query
  select
    i.id, i.email, i.role, i.location_id, l.name, i.invited_by,
    coalesce(nullif(btrim(sp.display_name), ''), nullif(btrim(pr.full_name), '')),
    i.expires_at, i.expires_at < now(), i.created_at
  from public.invitations i
  left join public.locations l on l.id = i.location_id
  left join public.staff_profiles sp
    on sp.organization_id = i.organization_id and sp.user_id = i.invited_by
  left join public.profiles pr on pr.id = i.invited_by
  where i.organization_id = p_organization_id
    and i.accepted_at is null
    and i.revoked_at is null
  order by i.created_at desc;
end;
$$;

comment on function public.list_team_invitations(uuid) is
  'Les invitations en attente d''une organisation. Le JETON n''est jamais rendu : il ne vit que dans l''e-mail.';

revoke all on function public.list_team_invitations(uuid) from public, anon;
grant execute on function public.list_team_invitations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Inviter
-- ---------------------------------------------------------------------------

create or replace function public.invite_team_member(
  p_organization_id uuid,
  p_email text,
  p_role public.membership_role,
  p_location_id uuid default null
)
returns table (
  id uuid,
  email text,
  role public.membership_role,
  expires_at timestamptz,
  replaced_previous boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text := lower(nullif(btrim(coalesce(p_email, '')), ''));
  v_previous uuid;
  v_row public.invitations;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_team_refusal=anonymous';
  end if;

  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to invite into this team'
      using errcode = '42501', detail = 'fadeup_team_refusal=not_authorized';
  end if;

  if p_role is null then
    raise exception 'a role is required'
      using errcode = '22023', detail = 'fadeup_team_refusal=role_required';
  end if;

  if p_role = 'owner'
     and not (select private.has_org_role(p_organization_id,
                array['owner']::public.membership_role[])) then
    raise exception 'only an owner may invite another owner'
      using errcode = '42501', detail = 'fadeup_team_refusal=owner_role_forbidden';
  end if;

  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'a valid email address is required'
      using errcode = '22023', detail = 'fadeup_team_refusal=email_invalid';
  end if;

  if exists (
    select 1 from public.memberships m
    join auth.users u on u.id = m.user_id
    where m.organization_id = p_organization_id and lower(u.email) = v_email
  ) then
    raise exception 'this person is already on the team'
      using errcode = '23505', detail = 'fadeup_team_refusal=already_member';
  end if;

  if p_location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.organization_id = p_organization_id
  ) then
    raise exception 'location does not belong to this organization'
      using errcode = '22023', detail = 'fadeup_team_refusal=location_foreign';
  end if;

  -- Un barber invité occupera un siège : le refus de capacité doit arriver
  -- MAINTENANT, pas à l'acceptation, où il humilierait l'invité.
  if p_role = 'barber' then
    perform private.assert_professional_capacity(p_organization_id);
  end if;

  -- Renvoyer une invitation révoque la précédente : un lien fuité devient
  -- inoffensif dès le renvoi, et l'index unique partiel
  -- (organization_id, email) WHERE pending reste satisfait.
  select i.id into v_previous
  from public.invitations i
  where i.organization_id = p_organization_id
    and i.email = v_email
    and i.accepted_at is null
    and i.revoked_at is null
  limit 1;

  if v_previous is not null then
    update public.invitations i set revoked_at = now() where i.id = v_previous;
  end if;

  insert into public.invitations (organization_id, email, role, token, invited_by, location_id)
  values (
    p_organization_id, v_email, p_role,
    -- Le secret naît ICI, pas dans le navigateur.
    encode(extensions.gen_random_bytes(32), 'hex'),
    v_actor, p_location_id
  )
  returning * into v_row;

  return query select v_row.id, v_row.email, v_row.role, v_row.expires_at, v_previous is not null;
end;
$$;

comment on function public.invite_team_member(uuid, text, public.membership_role, uuid) is
  'Invite une personne par e-mail. Le jeton est fabriqué côté serveur (32 octets aléatoires), l''envoi passe par le trigger notify_new_invitation → email_outbox → gabarit team_invitation : AUCUN second système d''envoi. Échéance : 7 jours, usage unique. Renvoyer révoque l''invitation précédente. Le JETON n''est jamais rendu à l''appelant.';

revoke all on function public.invite_team_member(uuid, text, public.membership_role, uuid) from public, anon;
grant execute on function public.invite_team_member(uuid, text, public.membership_role, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Changer un rôle
-- ---------------------------------------------------------------------------

create or replace function public.set_team_member_role(
  p_membership_id uuid,
  p_role public.membership_role
)
returns public.memberships
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_membership public.memberships;
  v_is_owner boolean;
  v_owner_count integer;
  v_row public.memberships;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_team_refusal=anonymous';
  end if;

  select * into v_membership from public.memberships m where m.id = p_membership_id;

  if v_membership.id is null
     or not (select private.has_org_role(v_membership.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to change this role'
      using errcode = '42501', detail = 'fadeup_team_refusal=not_authorized';
  end if;

  v_is_owner := (select private.has_org_role(v_membership.organization_id,
                   array['owner']::public.membership_role[]));

  -- La même règle que la policy : toucher un owner, ou en créer un, exige
  -- d'être owner.
  if (v_membership.role = 'owner' or p_role = 'owner') and not v_is_owner then
    raise exception 'only an owner may change an owner''s role'
      using errcode = '42501', detail = 'fadeup_team_refusal=owner_role_forbidden';
  end if;

  if v_membership.user_id is not distinct from v_actor then
    raise exception 'you cannot change your own role'
      using errcode = '42501', detail = 'fadeup_team_refusal=self_role';
  end if;

  if v_membership.role = 'owner' and p_role <> 'owner' then
    select count(*)::integer into v_owner_count
    from public.memberships m
    where m.organization_id = v_membership.organization_id and m.role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'an organization keeps at least one owner'
        using errcode = '22023', detail = 'fadeup_team_refusal=last_owner';
    end if;
  end if;

  if p_role = 'barber' and v_membership.role <> 'barber' then
    perform private.assert_professional_capacity(v_membership.organization_id);
  end if;

  update public.memberships m
     set role = p_role,
         -- Le revenu ne suit pas le rôle : un barber promu manager le voit
         -- par son rôle, un manager rétrogradé perd l'exception explicite.
         can_view_revenue = case when p_role = 'barber' then m.can_view_revenue else false end
   where m.id = p_membership_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.set_team_member_role(uuid, public.membership_role) is
  'Change le rôle d''un membre. Seul un owner touche un owner ou en crée un ; personne ne change son propre rôle ; une organisation garde au moins un owner ; passer quelqu''un barber consomme un siège et peut être refusé par le plan.';

revoke all on function public.set_team_member_role(uuid, public.membership_role) from public, anon;
grant execute on function public.set_team_member_role(uuid, public.membership_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retirer — sans rien détruire d'une identité
-- ---------------------------------------------------------------------------

create or replace function public.remove_team_member(
  p_membership_id uuid,
  p_reassign_to_barber_id uuid default null
)
returns table (
  removed_membership_id uuid,
  professional_id uuid,
  reassigned_appointments integer,
  moved_queue_entries integer,
  released_queue_entries integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_membership public.memberships;
  v_barber public.barbers;
  v_target public.barbers;
  v_owner_count integer;
  v_future integer := 0;
  v_reassigned integer := 0;
  v_moved integer := 0;
  v_released integer := 0;
  v_entry record;
begin
  if v_actor is null then
    raise exception 'authentication required'
      using errcode = '42501', detail = 'fadeup_team_refusal=anonymous';
  end if;

  select * into v_membership from public.memberships m where m.id = p_membership_id;

  if v_membership.id is null
     or not (select private.has_org_role(v_membership.organization_id,
               array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to remove this member'
      using errcode = '42501', detail = 'fadeup_team_refusal=not_authorized';
  end if;

  if v_membership.role = 'owner'
     and not (select private.has_org_role(v_membership.organization_id,
                array['owner']::public.membership_role[])) then
    raise exception 'only an owner may remove an owner'
      using errcode = '42501', detail = 'fadeup_team_refusal=owner_role_forbidden';
  end if;

  if v_membership.user_id is not distinct from v_actor then
    raise exception 'you cannot remove yourself from the team'
      using errcode = '42501', detail = 'fadeup_team_refusal=self_removal';
  end if;

  if v_membership.role = 'owner' then
    select count(*)::integer into v_owner_count
    from public.memberships m
    where m.organization_id = v_membership.organization_id and m.role = 'owner';
    if v_owner_count <= 1 then
      raise exception 'an organization keeps at least one owner'
        using errcode = '22023', detail = 'fadeup_team_refusal=last_owner';
    end if;
  end if;

  select b.* into v_barber
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where sp.organization_id = v_membership.organization_id
    and sp.user_id = v_membership.user_id;

  if p_reassign_to_barber_id is not null then
    select b.* into v_target
    from public.barbers b
    join public.staff_profiles sp on sp.id = b.staff_profile_id
    where b.id = p_reassign_to_barber_id
      and b.organization_id = v_membership.organization_id
      and b.is_bookable
      and sp.is_active;

    if v_target.id is null then
      raise exception 'the replacement must be an active, bookable barber of this organization'
        using errcode = '22023', detail = 'fadeup_team_refusal=target_invalid';
    end if;

    if v_barber.id is not null and v_target.id = v_barber.id then
      raise exception 'the replacement cannot be the person being removed'
        using errcode = '22023', detail = 'fadeup_team_refusal=target_is_self';
    end if;
  end if;

  if v_barber.id is not null then
    select count(*)::integer into v_future
    from public.appointments a
    where a.barber_id = v_barber.id
      and a.starts_at > now()
      and a.status in ('pending', 'confirmed');

    -- On ne laisse pas un client devant un fauteuil vide, et on n'annule pas
    -- dans le dos du salon : le remplaçant est OBLIGATOIRE dès qu'il reste
    -- un rendez-vous à venir.
    if v_future > 0 and v_target.id is null then
      raise exception 'this barber still has % upcoming appointment(s); name a replacement', v_future
        using errcode = '22023',
              detail = format('fadeup_team_refusal=has_future_appointments count=%s', v_future),
              hint = 'Choisissez le barber qui les reprend, ou annulez-les d''abord depuis l''agenda.';
    end if;

    if v_future > 0 then
      begin
        update public.appointments a
           set barber_id = v_target.id
         where a.barber_id = v_barber.id
           and a.starts_at > now()
           and a.status in ('pending', 'confirmed');
        get diagnostics v_reassigned = row_count;
      exception
        when exclusion_violation or check_violation then
          -- La contrainte d'exclusion a parlé : le remplaçant est déjà pris
          -- sur l'un de ces créneaux. On refuse en le disant, on ne force
          -- pas un chevauchement dans le dos du salon.
          raise exception 'the replacement is already booked over at least one of these appointments'
            using errcode = '23P01',
                  detail = 'fadeup_team_refusal=reassign_conflict',
                  hint = 'Déplacez d''abord les créneaux en conflit depuis l''agenda, puis réessayez.';
      end;
    end if;

    -- La file en cours : les personnes en attente ne sont jamais jetées.
    for v_entry in
      select q.id, q.organization_id, q.location_id, q.barber_id
      from public.queue_entries q
      where q.barber_id = v_barber.id
        and q.status in ('waiting', 'called', 'in_service')
    loop
      perform set_config('fadeup.queue_move', '1', true);
      if v_target.id is not null and v_target.queue_enabled then
        update public.queue_entries q set barber_id = v_target.id where q.id = v_entry.id;
        v_moved := v_moved + 1;
      else
        update public.queue_entries q set barber_id = null where q.id = v_entry.id;
        v_released := v_released + 1;
      end if;

      insert into public.queue_entry_moves
        (organization_id, location_id, entry_id, from_barber_id, to_barber_id, kind, moved_by)
      values
        (v_entry.organization_id, v_entry.location_id, v_entry.id, v_entry.barber_id,
         case when v_target.id is not null and v_target.queue_enabled then v_target.id else null end,
         'staff_move', v_actor);
    end loop;

    -- Le lien d'emploi se ferme. `professionals` n'est PAS touché : handle,
    -- abonnés, portfolio et historique public appartiennent à la personne.
    update public.barbers b
       set is_bookable = false, queue_enabled = false
     where b.id = v_barber.id;

    update public.staff_profiles sp
       set is_active = false, is_public = false
     where sp.id = v_barber.staff_profile_id;
  else
    -- Pas de siège barber (réceptionniste, manager) : seul le profil interne
    -- se désactive.
    update public.staff_profiles sp
       set is_active = false, is_public = false
     where sp.organization_id = v_membership.organization_id
       and sp.user_id = v_membership.user_id;
  end if;

  delete from public.memberships m where m.id = p_membership_id;

  return query select
    p_membership_id,
    v_barber.professional_id,
    v_reassigned,
    v_moved,
    v_released;
end;
$$;

comment on function public.remove_team_member(uuid, uuid) is
  'Retire quelqu''un de l''équipe. Ferme l''accès (memberships), le lien d''emploi (barbers) et le profil interne (staff_profiles) ; ne touche JAMAIS professionals — handle, abonnés, portfolio et historique public survivent au départ (MASTER_SPEC §9). Les rendez-vous à venir exigent un remplaçant nommé ; la file en cours le suit, ou retombe dans la file générale ; les relations client restent attachées au professionnel.';

revoke all on function public.remove_team_member(uuid, uuid) from public, anon;
grant execute on function public.remove_team_member(uuid, uuid) to authenticated;

commit;
