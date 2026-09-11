-- FadeUp — PLAT-2 (5/4) : les durcissements de la revue indépendante.
--
-- À APPLIQUER EN postgres. Aucun objet neuf ; six redéfinitions, une policy
-- resserrée, une ACL de séquence révoquée. `create or replace` partout : les
-- signatures ne changent pas, les ACL sont conservées.
--
-- Une revue indépendante et adversariale a été lancée sur ce lot avec pour
-- consigne de chercher des défauts. Elle en a trouvé, et ceux-ci sont réels.

begin;

-- ---------------------------------------------------------------------------
-- 1. UNE AFFICHE PARTIE PAR LA POSTE NE SE FAIT PLUS PRÉEMPTER
-- ---------------------------------------------------------------------------
--
-- LE DÉFAUT, MESURÉ PAR LA REVUE. `assign_poster` n'exigeait que
-- `state = 'free'`. Une affiche MISE À LA POSTE vers un prospect reste libre
-- des jours durant — le temps que l'enveloppe arrive. Pendant cette fenêtre,
-- n'importe quel porteur de `poster.assign` pouvait se l'attribuer. Le patron
-- destinataire ouvrait alors son enveloppe, scannait, et tombait sur la file
-- d'un AUTRE salon, sans recours (une affiche attribuée ne se détourne pas).
--
-- L'AMPLIFICATEUR, tout aussi réel : `posters_select` acceptait
-- `poster.assign`, si bien qu'un stagiaire pouvait ÉNUMÉRER par PostgREST
-- tous les codes libres AVEC leur `letter_prospect_id`, et choisir lequel
-- préempter — sans jamais passer par la RPC censée porter la garde.
--
-- Réparé aux DEUX étages, parce qu'une garde de RPC sans la policy qui va
-- avec n'est qu'une porte fermée dans un mur absent.

create or replace function public.assign_poster(
  p_code text,
  p_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_location public.locations;
  v_internal boolean;
  v_was_revoked boolean;
begin
  if v_actor is null then
    raise exception 'attribution non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=not_authenticated';
  end if;
  if v_code = '' or p_location_id is null then
    raise exception 'un code et un établissement sont attendus'
      using errcode = '22023', detail = 'fadeup_poster_refusal=arguments_required';
  end if;

  select * into v_poster from public.posters where code = v_code for update;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;

  v_internal := (select private.platform_can('poster.manage'));
  -- LU AVANT L'UPDATE. La version précédente lisait `v_poster.state` APRÈS le
  -- `returning into`, où il vaut déjà 'assigned' : le seul fait qui distingue
  -- une attribution d'une réattribution après révocation n'était donc JAMAIS
  -- journalisé — il valait `false` en toute circonstance.
  v_was_revoked := v_poster.state = 'revoked';

  if v_poster.state = 'assigned' then
    raise exception 'cette affiche est déjà attribuée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=already_assigned';
  end if;

  if v_poster.state = 'revoked' and not v_internal then
    raise exception 'cette affiche a été révoquée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=revoked';
  end if;

  -- UNE AFFICHE POSTÉE EST RÉSERVÉE À SON DESTINATAIRE. Deux chemins, et deux
  -- seulement : un interne porteur de `poster.manage` (qui a décidé de
  -- l'envoi et peut le défaire), ou le salon vers lequel le prospect a
  -- effectivement converti. Tout le reste est une préemption.
  if v_poster.letter_prospect_id is not null and not v_internal then
    if not exists (
      select 1
      from public.prospects p
      join public.locations l on l.id = p_location_id
      where p.id = v_poster.letter_prospect_id
        and p.converted_organization_id is not null
        and p.converted_organization_id = l.organization_id
    ) then
      raise exception 'cette affiche est réservée au salon à qui elle a été envoyée'
        using errcode = '42501', detail = 'fadeup_poster_refusal=reserved_for_addressee';
    end if;
  end if;

  if not (select private.poster_can_assign_to_location(p_location_id)) then
    raise exception 'cet établissement n''est pas le vôtre'
      using errcode = '42501', detail = 'fadeup_poster_refusal=location_not_mine';
  end if;

  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'établissement introuvable' using errcode = '42704';
  end if;

  update public.posters
     set state = 'assigned',
         organization_id = v_location.organization_id,
         location_id = v_location.id,
         assigned_by = v_actor,
         assigned_at = now(),
         revoked_by = null, revoked_at = null, revoke_reason = null,
         updated_at = now()
   where id = v_poster.id
  returning * into v_poster;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_assigned', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code,
                             'organization_id', v_location.organization_id,
                             'location_id', v_location.id,
                             'reassigned_after_revocation', v_was_revoked,
                             'was_mailed_to_prospect', v_poster.letter_prospect_id is not null));

  return jsonb_build_object(
    'code', v_poster.code, 'state', v_poster.state,
    'organization_id', v_poster.organization_id,
    'location_id', v_poster.location_id,
    'organization_slug', (select o.slug from public.organizations o where o.id = v_poster.organization_id)
  );
end;
$function$;

-- LA POLICY, resserrée. Un porteur de `poster.assign` n'a plus besoin de LIRE
-- la table : il attribue en SCANNANT une affiche qu'il tient dans la main, et
-- `resolve_poster_code` lui répond. Lui laisser la table ouverte lui donnait
-- une capacité d'énumération dont son geste n'a aucun besoin.
drop policy if exists posters_select on public.posters;
create policy posters_select on public.posters
  for select to authenticated
  using (
    (select private.platform_can('poster.manage'))
    or (organization_id is not null
        and (select private.has_org_role(posters.organization_id,
                                         array['owner', 'manager']::public.membership_role[])))
  );

-- ---------------------------------------------------------------------------
-- 2. UNE RÉVOCATION N'ÉCRASE PLUS LE MOTIF DE LA PRÉCÉDENTE
-- ---------------------------------------------------------------------------

create or replace function public.revoke_poster(
  p_code text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_poster public.posters;
begin
  if v_actor is null or not (select private.platform_can('poster.manage')) then
    raise exception 'révocation non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=revoke_not_authorized';
  end if;
  if v_reason is null then
    raise exception 'une révocation a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_poster_refusal=reason_required';
  end if;

  select * into v_poster from public.posters where code = v_code for update;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;
  -- Révoquer une affiche DÉJÀ révoquée écrasait le motif d'origine par le
  -- nouveau. Une affiche hors service l'est déjà : le geste n'apporte rien et
  -- coûte la raison pour laquelle elle est sortie.
  if v_poster.state = 'revoked' then
    raise exception 'cette affiche est déjà révoquée'
      using errcode = '22023', detail = 'fadeup_poster_refusal=already_revoked';
  end if;

  update public.posters
     set state = 'revoked',
         revoked_by = v_actor, revoked_at = now(), revoke_reason = v_reason,
         updated_at = now()
   where id = v_poster.id
  returning * into v_poster;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_revoked', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'reason', v_reason,
                             'previous_organization_id', v_poster.organization_id));

  return jsonb_build_object('code', v_poster.code, 'state', v_poster.state);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. UNE LETTRE NE PART PLUS VERS UN SALON QUI N'EST PAS EN LIGNE
-- ---------------------------------------------------------------------------
--
-- Le corps générique de la lettre dit au patron que son salon a déjà une
-- fiche sur FadeUp. `prepare_poster_letter` ne le vérifiait pas : elle
-- n'exigeait que `poster.manage`, la visibilité du prospect et une affiche
-- libre. Une lettre pouvait donc affirmer une fiche qui n'existe pas — la
-- règle « données réelles » appliquée à l'envers, sur du papier qu'on ne
-- rattrape plus. La fonction savait pourtant distinguer : elle testait déjà
-- `is_published` pour décider de l'élément de preuve.

create or replace function public.prepare_poster_letter(
  p_code text,
  p_prospect_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_prospect public.prospects;
  v_location public.prospect_locations;
  v_stats jsonb;
begin
  if v_actor is null or not (select private.platform_can('poster.manage')) then
    raise exception 'préparation de lettre non autorisée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=letter_not_authorized';
  end if;
  if p_prospect_id is null or not (select private.platform_prospect_visible(p_prospect_id)) then
    raise exception 'ce prospect n''est pas visible avec votre rôle'
      using errcode = '42501', detail = 'fadeup_poster_refusal=prospect_not_visible';
  end if;

  select * into v_poster from public.posters where code = v_code for update;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;
  if v_poster.state <> 'free' then
    raise exception 'seule une affiche libre part par la poste'
      using errcode = '22023', detail = 'fadeup_poster_refusal=not_free';
  end if;

  -- LA FICHE DOIT EXISTER AVANT QU'UNE LETTRE L'AFFIRME.
  if not exists (
    select 1
    from public.prospect_professionals pp
    join public.professionals pr on pr.id = pp.professional_id
    where pp.prospect_id = p_prospect_id and pr.is_public
  ) then
    raise exception 'la fiche de ce prospect n''est pas publiée : la lettre affirmerait ce qui n''existe pas'
      using errcode = '22023', detail = 'fadeup_poster_refusal=prospect_not_published';
  end if;

  select * into v_prospect from public.prospects where id = p_prospect_id;
  select * into v_location from public.prospect_locations
   where prospect_id = p_prospect_id order by is_primary desc limit 1;

  update public.posters
     set letter_prospect_id = p_prospect_id,
         letter_generated_at = now(),
         letter_generated_by = v_actor,
         updated_at = now()
   where id = v_poster.id;

  v_stats := (select public.get_prospect_acquisition_stats(p_prospect_id, 90));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_letter_prepared', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'prospect_id', p_prospect_id));

  return jsonb_build_object(
    'code', v_poster.code,
    'prospect_id', p_prospect_id,
    'business_name', v_prospect.canonical_name,
    'address', jsonb_build_object(
      'line', v_location.address_line, 'postal_code', v_location.postal_code,
      'city', v_location.city, 'country', coalesce(v_location.country, v_prospect.country)),
    -- L'ÉLÉMENT DE PREUVE, ou rien. Aucune phrase de repli chiffrée.
    'proof', case
      when coalesce((v_stats ->> 'profile_views_all_time')::integer, 0) > 0
           or coalesce((v_stats ->> 'interest_requests')::integer, 0) > 0
      then jsonb_build_object(
             'profile_views_all_time', v_stats -> 'profile_views_all_time',
             'profile_views_window', v_stats -> 'profile_views',
             'window_days', v_stats -> 'window_days',
             'interest_requests', v_stats -> 'interest_requests',
             'last_profile_view_at', v_stats -> 'last_profile_view_at')
      else null end,
    'stats', v_stats
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. UN RENVOI D'E-MAIL CONSULTE LA LISTE D'OPPOSITION
-- ---------------------------------------------------------------------------
--
-- La fonction ne testait que `bounced_at` SUR LA LIGNE DEMANDÉE. Une adresse
-- inscrite sur la liste d'opposition de X2 — parce qu'une AUTRE ligne avait
-- rebondi durement, ou parce que la personne s'est désabonnée — se voyait
-- réécrire sans que rien ne s'y oppose. Le rapport affirmait le contraire ;
-- la revue l'a mesuré.

create or replace function public.resend_platform_email(
  p_email_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_source public.email_outbox;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_new_id uuid;
begin
  if v_actor is null or not (select private.platform_can('email.resend')) then
    raise exception 'renvoi d''e-mail non autorisé'
      using errcode = '42501', detail = 'fadeup_platform_refusal=email_resend_required';
  end if;
  if v_reason is null then
    raise exception 'un renvoi a besoin de son motif'
      using errcode = '22023', detail = 'fadeup_platform_refusal=reason_required';
  end if;

  select * into v_source from public.email_outbox where id = p_email_id;
  if not found then
    raise exception 'e-mail introuvable' using errcode = '42704';
  end if;
  if v_source.bounced_at is not null then
    raise exception 'cet e-mail a rebondi, il ne se renvoie pas'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_bounced';
  end if;
  -- LA LISTE D'OPPOSITION, celle que X2 a construite, posée sur l'ADRESSE et
  -- non sur la ligne : un rebond dur ou un désabonnement vaut pour tout ce
  -- qui part vers cette adresse, pas seulement pour le message qui l'a causé.
  if (select private.is_prospect_value_suppressed('email', v_source.to_email)) then
    raise exception 'cette adresse est sur la liste d''opposition'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_suppressed';
  end if;
  if v_source.stream <> 'transactional' then
    raise exception 'seul un e-mail transactionnel se renvoie'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_not_transactional';
  end if;

  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values (v_source.to_email, v_source.template, v_source.locale, v_source.payload, v_source.stream,
          -- `extract(epoch from now())` est FIGÉ dans la transaction : deux
          -- renvois du même e-mail levaient un 23505 brut, affiché tel quel au
          -- support. `clock_timestamp()` avance, et le hasard ferme la fenêtre.
          'resend:' || v_source.id::text || ':' || extract(epoch from clock_timestamp())::bigint::text
            || ':' || substr(md5(gen_random_uuid()::text), 1, 8))
  returning id into v_new_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'platform_email_resent', 'email_outbox', v_new_id,
          jsonb_build_object('source_email_id', v_source.id, 'template', v_source.template, 'reason', v_reason));

  return v_new_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. PLUS DE FRANÇAIS EN DUR ÉCRIT EN BASE
-- ---------------------------------------------------------------------------
--
-- `assign_support_ticket` écrivait « non assigné » comme corps d'un message
-- de fil quand on désassignait — une chaîne française, EN BASE, donc
-- irrattrapable par l'interface, et rendue verbatim à un support qui lit en
-- japonais. Le corps porte désormais un JETON que l'écran traduit.

create or replace function public.assign_support_ticket(
  p_ticket_id uuid,
  p_assignee uuid
)
returns public.support_tickets
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
begin
  if p_assignee is not null and not exists (
    select 1
    from public.platform_members pm
    join public.platform_role_permissions rp on rp.role = pm.role
    where pm.user_id = p_assignee and rp.permission_key = 'support.tickets'
  ) then
    raise exception 'ce compte ne traite pas les tickets'
      using errcode = '22023', detail = 'fadeup_support_refusal=assignee_not_support';
  end if;

  update public.support_tickets
     set assigned_to = p_assignee, updated_at = now()
   where id = p_ticket_id
  returning * into v_ticket;
  if not found then
    raise exception 'ticket introuvable' using errcode = '42704';
  end if;

  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id, metadata)
  values (v_ticket.id, 'assignment',
          coalesce((select au.email::text from auth.users au where au.id = p_assignee), 'unassigned'),
          v_actor, jsonb_build_object('assigned_to', p_assignee));

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_assigned', 'support_tickets', v_ticket.id,
          jsonb_build_object('assigned_to', p_assignee, 'reference', v_ticket.reference));

  return v_ticket;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. LA SÉQUENCE DE RÉFÉRENCE N'EST PAS UN OBJET CLIENT
-- ---------------------------------------------------------------------------
--
-- `public.support_ticket_reference_seq` est la PREMIÈRE séquence de `public` :
-- le durcissement d'ACL par défaut de X3 ne couvre pas les séquences, et elle
-- est née `anon=rwU / authenticated=rwU`. `nextval`/`setval` ne sont pas
-- exposés par PostgREST, donc aucune porte anonyme — mais elle porte un
-- identifiant métier UNIQUE, et un `setval` en arrière ferait échouer toute
-- ouverture de ticket en 23505. Elle n'a rien à faire dans les mains d'un
-- client : seul `open_support_ticket`, SECURITY DEFINER, s'en sert.

revoke all on sequence public.support_ticket_reference_seq from anon, authenticated;

commit;
