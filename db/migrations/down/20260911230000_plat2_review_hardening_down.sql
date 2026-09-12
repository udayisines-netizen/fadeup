-- Retour arrière de 20260911230000_plat2_review_hardening.sql — EN postgres.
--
-- CE QU'IL REND : les cinq fonctions retrouvent leur corps d'avant la revue,
-- repris verbatim de `20260911200000` et `20260911200300`, la policy
-- `posters_select` retrouve sa forme large, et la séquence de référence
-- retrouve ses privilèges par défaut.
--
-- IL EST DONC MOINS STRICT QUE L'ÉTAT APRÈS CE FICHIER, sur cinq points
-- précis, et il faut le savoir avant de l'ordonner :
--   * une affiche mise à la poste redevient préemptable par n'importe quel
--     porteur de `poster.assign` ;
--   * un stagiaire peut de nouveau ÉNUMÉRER les codes libres par PostgREST ;
--   * une lettre peut de nouveau partir vers un salon dont la fiche n'est pas
--     publiée, en affirmant le contraire sur du papier ;
--   * un renvoi d'e-mail ne consulte plus la liste d'opposition ;
--   * `reassigned_after_revocation` redevient toujours faux au journal.
-- Aucune donnée n'est détruite.

begin;

grant usage, select, update on sequence public.support_ticket_reference_seq to anon, authenticated;

drop policy if exists posters_select on public.posters;
create policy posters_select on public.posters
  for select to authenticated
  using (
    (select private.platform_can('poster.manage'))
    or (select private.platform_can('poster.assign'))
    or (organization_id is not null
        and (select private.has_org_role(posters.organization_id,
                                         array['owner', 'manager']::public.membership_role[])))
  );

create or replace function public.assign_support_ticket(p_ticket_id uuid, p_assignee uuid)
returns public.support_tickets
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := (select private.assert_support_tickets());
  v_ticket public.support_tickets;
begin
  if p_assignee is not null and not exists (
    select 1 from public.platform_members pm
    join public.platform_role_permissions rp on rp.role = pm.role
    where pm.user_id = p_assignee and rp.permission_key = 'support.tickets'
  ) then
    raise exception 'ce compte ne traite pas les tickets'
      using errcode = '22023', detail = 'fadeup_support_refusal=assignee_not_support';
  end if;
  update public.support_tickets set assigned_to = p_assignee, updated_at = now()
   where id = p_ticket_id returning * into v_ticket;
  if not found then raise exception 'ticket introuvable' using errcode = '42704'; end if;
  insert into public.support_ticket_messages (ticket_id, kind, body, author_user_id, metadata)
  values (v_ticket.id, 'assignment',
          coalesce((select au.email::text from auth.users au where au.id = p_assignee), 'non assigné'),
          v_actor, jsonb_build_object('assigned_to', p_assignee));
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'support_ticket_assigned', 'support_tickets', v_ticket.id,
          jsonb_build_object('assigned_to', p_assignee, 'reference', v_ticket.reference));
  return v_ticket;
end;
$function$;

create or replace function public.resend_platform_email(p_email_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path to ''
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
  if not found then raise exception 'e-mail introuvable' using errcode = '42704'; end if;
  if v_source.bounced_at is not null then
    raise exception 'cet e-mail a rebondi, il ne se renvoie pas'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_bounced';
  end if;
  if v_source.stream <> 'transactional' then
    raise exception 'seul un e-mail transactionnel se renvoie'
      using errcode = '22023', detail = 'fadeup_platform_refusal=email_not_transactional';
  end if;
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values (v_source.to_email, v_source.template, v_source.locale, v_source.payload, v_source.stream,
          'resend:' || v_source.id::text || ':' || extract(epoch from now())::bigint::text)
  returning id into v_new_id;
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'platform_email_resent', 'email_outbox', v_new_id,
          jsonb_build_object('source_email_id', v_source.id, 'template', v_source.template, 'reason', v_reason));
  return v_new_id;
end;
$function$;

create or replace function public.prepare_poster_letter(p_code text, p_prospect_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
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
  select * into v_prospect from public.prospects where id = p_prospect_id;
  select * into v_location from public.prospect_locations
   where prospect_id = p_prospect_id order by is_primary desc limit 1;
  update public.posters
     set letter_prospect_id = p_prospect_id, letter_generated_at = now(),
         letter_generated_by = v_actor, updated_at = now()
   where id = v_poster.id;
  v_stats := (select public.get_prospect_acquisition_stats(p_prospect_id, 90));
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_letter_prepared', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'prospect_id', p_prospect_id));
  return jsonb_build_object(
    'code', v_poster.code, 'prospect_id', p_prospect_id,
    'business_name', v_prospect.canonical_name,
    'address', jsonb_build_object('line', v_location.address_line, 'postal_code', v_location.postal_code,
                                  'city', v_location.city, 'country', coalesce(v_location.country, v_prospect.country)),
    'proof', case
      when coalesce((v_stats ->> 'is_published')::boolean, false)
           and (coalesce((v_stats ->> 'profile_views_all_time')::integer, 0) > 0
                or coalesce((v_stats ->> 'interest_requests')::integer, 0) > 0)
      then jsonb_build_object('profile_views_all_time', v_stats -> 'profile_views_all_time',
                              'profile_views_window', v_stats -> 'profile_views',
                              'window_days', v_stats -> 'window_days',
                              'interest_requests', v_stats -> 'interest_requests',
                              'last_profile_view_at', v_stats -> 'last_profile_view_at')
      else null end,
    'stats', v_stats);
end;
$function$;

create or replace function public.revoke_poster(p_code text, p_reason text)
returns jsonb
language plpgsql security definer set search_path to ''
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
  update public.posters
     set state = 'revoked', revoked_by = v_actor, revoked_at = now(),
         revoke_reason = v_reason, updated_at = now()
   where code = v_code returning * into v_poster;
  if not found then
    raise exception 'affiche inconnue'
      using errcode = '42704', detail = 'fadeup_poster_refusal=unknown_code';
  end if;
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_revoked', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'reason', v_reason,
                             'previous_organization_id', v_poster.organization_id));
  return jsonb_build_object('code', v_poster.code, 'state', v_poster.state);
end;
$function$;

create or replace function public.assign_poster(p_code text, p_location_id uuid)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_poster public.posters;
  v_location public.locations;
  v_internal boolean;
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
  if v_poster.state = 'assigned' then
    raise exception 'cette affiche est déjà attribuée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=already_assigned';
  end if;
  if v_poster.state = 'revoked' and not v_internal then
    raise exception 'cette affiche a été révoquée'
      using errcode = '42501', detail = 'fadeup_poster_refusal=revoked';
  end if;
  if not (select private.poster_can_assign_to_location(p_location_id)) then
    raise exception 'cet établissement n''est pas le vôtre'
      using errcode = '42501', detail = 'fadeup_poster_refusal=location_not_mine';
  end if;
  select * into v_location from public.locations where id = p_location_id;
  if not found then raise exception 'établissement introuvable' using errcode = '42704'; end if;
  update public.posters
     set state = 'assigned', organization_id = v_location.organization_id,
         location_id = v_location.id, assigned_by = v_actor, assigned_at = now(),
         revoked_by = null, revoked_at = null, revoke_reason = null, updated_at = now()
   where id = v_poster.id returning * into v_poster;
  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'poster_assigned', 'posters', v_poster.id,
          jsonb_build_object('code', v_poster.code, 'organization_id', v_location.organization_id,
                             'location_id', v_location.id,
                             'reassigned_after_revocation', v_poster.state = 'revoked'));
  return jsonb_build_object('code', v_poster.code, 'state', v_poster.state,
    'organization_id', v_poster.organization_id, 'location_id', v_poster.location_id,
    'organization_slug', (select o.slug from public.organizations o where o.id = v_poster.organization_id));
end;
$function$;

commit;
