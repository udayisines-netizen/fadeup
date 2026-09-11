-- FadeUp — retour arrière de 20260911100100_plat1_permission_model.sql
--
-- Remet la console interne dans l'état d'avant PLAT-1 : deux niveaux
-- (is_platform_admin, has_platform_role) au lieu d'une grille de droits.
--
-- CE QUI N'EST PAS DÉFAIT, et pourquoi :
--   - les valeurs d'énumération platform_sales / platform_moderator /
--     platform_intern restent : PostgreSQL n'a pas d'« alter type drop value ».
--     Le retour arrière de 20260911100000 les neutralise autrement.
--   - les lignes déjà écrites dans platform_audit_log restent : le journal est
--     en ajout seul, et un retour arrière qui efface des traces n'en est pas un.
--   - les prospects saisis sur le terrain ne sont pas supprimés : seules les
--     colonnes qui les décrivent disparaissent. Si ce fichier tourne après une
--     saisie réelle, la contrainte de forme est retirée AVANT les colonnes,
--     et l'observation est perdue — c'est dit ici plutôt que découvert.
--
-- À APPLIQUER EN postgres.
--   docker exec -i fadeup-supabase-db psql -U postgres -d <base> \
--     -v ON_ERROR_STOP=1 < db/migrations/down/20260911100100_plat1_permission_model.down.sql

set lock_timeout = '5s';

begin;

-- 1. Les corps de fonctions d'avant PLAT-1 -----------------------------------
-- ---- publish_external_professional : corps d'avant PLAT-1, repris verbatim
create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_reason text;
  v_professional_id uuid;
  v_existing uuid;
  v_name text;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can publish an external professional identity'
      using errcode = '42501';
  end if;

  perform 1 from public.prospects where id = p_prospect_id for update;
  if not found then
    raise exception 'prospect not found' using errcode = '42704';
  end if;

  select pp.professional_id into v_existing
  from public.prospect_professionals pp
  where pp.prospect_id = p_prospect_id;

  if v_existing is not null then
    -- Idempotente et auto-réparatrice (B1) — mais plus jamais au mépris d'un
    -- retrait ou d'une suppression. LE MÊME garde que la branche neuve
    -- (publication_block_reason), en ignorant seulement already_published,
    -- vrai par construction ici : deux définitions de l'éligibilité avaient
    -- déjà divergé une fois (revue X2, suppressed_email ignoré).
    v_reason := public.publication_block_reason(p_prospect_id);
    if v_reason is not null and v_reason <> 'already_published' then
      perform 1 from public.professionals p
      where p.id = v_existing and not p.is_public;
      if found then
        raise exception 'prospect is not eligible for publication: %', v_reason
          using errcode = '42501';
      end if;
      -- Déjà public ET bloqué : état hérité — on ne dépublie pas en douce
      -- depuis un chemin de publication, on rend l'identité telle qu'elle
      -- est. Le retrait a son propre circuit. Et on n'informe PAS : les
      -- gardes de contact de l'enqueue refuseront de toute façon.
    end if;

    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    perform private.enqueue_publication_information(v_existing);

    return v_existing;
  end if;

  v_reason := public.publication_block_reason(p_prospect_id);
  if v_reason is not null then
    raise exception 'prospect is not eligible for publication: %', v_reason
      using errcode = '42501';
  end if;

  select p.canonical_name into v_name from public.prospects p where p.id = p_prospect_id;

  v_professional_id := public.create_external_professional(p_prospect_id);

  update public.professionals
  set is_public = true
  where id = v_professional_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_published',
    'prospect_professionals',
    v_professional_id,
    jsonb_build_object(
      'prospect_id', p_prospect_id,
      'professional_id', v_professional_id,
      'published_name', v_name,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  perform public.refresh_prospect_publication_eligibility(p_prospect_id);

  -- Publier, puis informer — dans la même transaction : si la mise en file
  -- échoue, la publication échoue avec elle. On ne publie pas sans informer.
  perform private.enqueue_publication_information(v_professional_id);

  return v_professional_id;
end;
$function$;

-- ---- withdraw_external_professional : corps d'avant PLAT-1, repris verbatim
create or replace function public.withdraw_external_professional(p_professional_id uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can withdraw an external professional identity'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p
  where p.id = p_professional_id
  for update;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  -- A claimed identity belongs to its owner. Removing it from public view is
  -- a moderation act with its own review path, not a side door on the
  -- acquisition tooling.
  if v_claim_state = 'claimed' then
    raise exception 'this identity is claimed; withdrawing a claimed profile is not an acquisition action'
      using errcode = '42501';
  end if;

  update public.professionals
  set is_public = false
  where id = p_professional_id and is_public;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_actor,
    'external_professional_withdrawn',
    'professionals',
    p_professional_id,
    jsonb_build_object(
      'professional_id', p_professional_id,
      'note', nullif(btrim(coalesce(p_note, '')), '')
    )
  );

  return p_professional_id;
end;
$function$;

-- ---- request_marketplace_withdrawal : corps d'avant PLAT-1, repris verbatim
create or replace function public.request_marketplace_withdrawal(p_professional_id uuid, p_requested_via text, p_requester_note text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, deadline_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
  v_claim_state public.professional_claim_state;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can record a withdrawal request'
      using errcode = '42501';
  end if;

  select p.claim_state into v_claim_state
  from public.professionals p where p.id = p_professional_id;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  if v_claim_state = 'claimed' then
    -- Un profil revendiqué se retire tout seul : son propriétaire contrôle sa
    -- visibilité depuis Pro. Passer par ce chemin serait retirer le profil de
    -- quelqu'un à sa place.
    raise exception 'this profile is claimed; its owner controls its visibility'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=professional_is_claimed';
  end if;

  insert into public.marketplace_withdrawal_requests
    (professional_id, requested_via, requester_note)
  values
    (p_professional_id, p_requested_via, nullif(btrim(coalesce(p_requester_note, '')), ''))
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_requested', 'professionals', p_professional_id,
          jsonb_build_object('request_id', v_row.id, 'requested_via', p_requested_via,
                             'deadline_at', v_row.deadline_at));

  return query select v_row.id, v_row.deadline_at;
end;
$function$;

-- ---- complete_marketplace_withdrawal : corps d'avant PLAT-1, repris verbatim
create or replace function public.complete_marketplace_withdrawal(p_request_id uuid, p_decision_note text DEFAULT NULL::text)
 RETURNS TABLE(professional_id uuid, completed_at timestamp with time zone, hours_taken numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_row public.marketplace_withdrawal_requests;
begin
  v_actor := (select auth.uid());
  if v_actor is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform administrators can complete a withdrawal'
      using errcode = '42501';
  end if;

  select * into v_row from public.marketplace_withdrawal_requests
  where id = p_request_id for update;

  if not found then
    raise exception 'withdrawal request not found' using errcode = '42704';
  end if;

  if v_row.status <> 'pending' then
    raise exception 'this withdrawal request is already %', v_row.status
      using errcode = '42501';
  end if;

  -- 1. Dépublier. B1 a écrit cette fonction, elle audite déjà son geste.
  perform public.withdraw_external_professional(v_row.professional_id, p_decision_note);

  -- 2. Couper toute relance future. C'est la moitié du retrait que la simple
  --    dépublication ne couvre pas : un profil invisible qui continue de
  --    recevoir des e-mails de prospection n'est pas retiré, il est caché.
  update public.prospects pr
  set do_not_contact = true
  from public.prospect_professionals pp
  where pp.prospect_id = pr.id
    and pp.professional_id = v_row.professional_id
    and not pr.do_not_contact;

  insert into public.prospect_suppressions (scope, prospect_id, reason)
  select 'prospect', pp.prospect_id, 'marketplace_withdrawal'
  from public.prospect_professionals pp
  where pp.professional_id = v_row.professional_id
  on conflict do nothing;

  -- 3. Les demandes d'intérêt en cours n'ont plus de destinataire. Les laisser
  --    « pending » ferait attendre un client une réponse qui ne viendra
  --    jamais, et la troisième relance partirait vers quelqu'un qui a demandé
  --    à sortir.
  -- La table est nommée en entier dans le WHERE : la clause RETURNS TABLE de
  -- cette fonction déclare une variable `professional_id`, qui masquerait la
  -- colonne et ferait échouer l'UPDATE sur « column reference is ambiguous ».
  update public.professional_interest_requests r
  set status = 'withdrawn', resolved_at = now()
  where r.professional_id = v_row.professional_id and r.status = 'pending';

  update public.marketplace_withdrawal_requests
  set status = 'completed', decided_at = now(), decided_by = v_actor,
      decision_note = nullif(btrim(coalesce(p_decision_note, '')), '')
  where id = p_request_id
  returning * into v_row;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_actor, 'marketplace_withdrawal_completed', 'professionals', v_row.professional_id,
          jsonb_build_object('request_id', v_row.id,
                             'requested_at', v_row.requested_at,
                             'deadline_at', v_row.deadline_at,
                             'within_deadline', v_row.decided_at <= v_row.deadline_at));

  return query select
    v_row.professional_id,
    v_row.decided_at,
    round(extract(epoch from (v_row.decided_at - v_row.requested_at)) / 3600.0, 1);
end;
$function$;

-- ---- list_marketplace_withdrawal_requests : corps d'avant PLAT-1, repris verbatim
create or replace function public.list_marketplace_withdrawal_requests(p_include_completed boolean DEFAULT false)
 RETURNS TABLE(id uuid, professional_id uuid, professional_display_name text, professional_handle text, is_still_public boolean, requested_via text, requested_at timestamp with time zone, deadline_at timestamp with time zone, hours_remaining numeric, is_overdue boolean, status marketplace_withdrawal_status, decided_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    w.id, w.professional_id, p.display_name, p.handle, p.is_public,
    w.requested_via, w.requested_at, w.deadline_at,
    round(extract(epoch from (w.deadline_at - now())) / 3600.0, 1),
    w.status = 'pending' and w.deadline_at < now(),
    w.status, w.decided_at
  from public.marketplace_withdrawal_requests w
  join public.professionals p on p.id = w.professional_id
  where (select private.is_platform_admin())
    and (p_include_completed or w.status = 'pending')
  -- Les retards en premier : une liste triée par date de demande enterre
  -- l'urgence sous l'historique.
  order by (w.status = 'pending' and w.deadline_at < now()) desc, w.deadline_at;
$function$;

-- ---- review_professional_application : corps d'avant PLAT-1, repris verbatim
create or replace function public.review_professional_application(p_application_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL::text, p_internal_note text DEFAULT NULL::text)
 RETURNS professional_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reviewer uuid;
  v_application public.professional_applications;
  v_org public.organizations;
  v_slug text;
  v_slug_base text;
  v_suffix integer := 0;
  v_country text;
  v_timezone text;
  v_business_type public.business_type;
  v_location_id uuid;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional applications';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject';
  end if;

  -- Row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a status that is no longer pending and returns without
  -- repeating any side effect.
  select * into v_application
    from public.professional_applications a
    where a.id = p_application_id
    for update;

  if not found then
    raise exception 'application not found';
  end if;

  if v_application.status <> 'pending_review' then
    return v_application;
  end if;

  if p_decision = 'reject' then
    update public.professional_applications a
      set status = 'rejected',
          reviewed_at = now(),
          reviewed_by = v_reviewer,
          rejection_reason = nullif(btrim(coalesce(p_rejection_reason, '')), ''),
          internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
      where a.id = v_application.id
      returning * into v_application;

    insert into public.email_outbox (to_email, template, payload)
    values (
      v_application.email,
      'professional_application_rejected',
      jsonb_build_object(
        'business_name', v_application.business_name,
        'first_name', v_application.first_name,
        'rejection_reason', v_application.rejection_reason
      )
    );

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (
      v_reviewer, 'professional_application_rejected', 'professional_applications', v_application.id,
      jsonb_build_object('business_name', v_application.business_name, 'has_reason', v_application.rejection_reason is not null)
    );

    return v_application;
  end if;

  -- ---- approve ----------------------------------------------------------
  v_slug_base := regexp_replace(lower(btrim(v_application.business_name)), '[^a-z0-9]+', '-', 'g');
  v_slug_base := btrim(regexp_replace(v_slug_base, '(^-+)|(-+$)', '', 'g'), '-');
  if v_slug_base = '' then
    v_slug_base := 'shop';
  end if;
  v_slug_base := left(v_slug_base, 40);
  v_slug := v_slug_base;
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_suffix := v_suffix + 1;
    v_slug := v_slug_base || '-' || v_suffix::text;
  end loop;

  v_country := nullif(btrim(upper(coalesce(v_application.country, ''))), '');
  if v_country is not null and char_length(v_country) <> 2 then
    -- The application form accepts free text; only a clean alpha-2 code is
    -- trustworthy enough to drive a timezone. Anything else is left for
    -- onboarding to ask about rather than guessed at.
    v_country := null;
  end if;

  -- professional_type is the applicant's own description of their business
  -- and maps cleanly onto the two solo shapes; barbershop maps to barbershop.
  -- Anything a salon-shaped applicant needs is chosen in onboarding step 1,
  -- which is why an unmapped type is left NULL rather than defaulted.
  v_business_type := case v_application.professional_type
    when 'barbershop' then 'barbershop'::public.business_type
    when 'independent_barber' then 'solo_professional'::public.business_type
    when 'private_studio' then 'solo_professional'::public.business_type
    when 'mobile_barber' then 'solo_professional'::public.business_type
    else null
  end;

  perform set_config('fadeup.skip_org_owner_membership', 'on', true);
  perform set_config('fadeup.org_creation_authorized', 'on', true);
  insert into public.organizations (name, slug, business_type, country_code, currency)
  values (
    v_application.business_name,
    v_slug,
    v_business_type,
    v_country,
    public.suggested_currency_for_country(v_country)
  )
  returning * into v_org;
  perform set_config('fadeup.org_creation_authorized', 'off', true);
  perform set_config('fadeup.skip_org_owner_membership', 'off', true);

  insert into public.memberships (organization_id, user_id, role)
  values (v_org.id, v_application.user_id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  -- First location, from data the applicant already gave us. Creating it
  -- here is what stops an approved shop from starting with zero locations
  -- and the owner retyping an address FadeUp already holds.
  v_timezone := coalesce(public.suggested_timezone_for_country(v_country), 'UTC');
  insert into public.locations (
    organization_id, name, address_line1, city, postal_code, country, timezone
  )
  values (
    v_org.id,
    v_application.business_name,
    nullif(btrim(coalesce(v_application.address_line1, '')), ''),
    nullif(btrim(coalesce(v_application.city, '')), ''),
    nullif(btrim(coalesce(v_application.postal_code, '')), ''),
    v_country,
    v_timezone
  )
  returning id into v_location_id;

  update public.professional_applications a
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_reviewer,
        organization_id = v_org.id,
        internal_note = coalesce(nullif(btrim(coalesce(p_internal_note, '')), ''), a.internal_note)
    where a.id = v_application.id
    returning * into v_application;

  insert into public.email_outbox (to_email, template, payload)
  values (
    v_application.email,
    'professional_application_approved',
    jsonb_build_object(
      'business_name', v_application.business_name,
      'first_name', v_application.first_name
    )
  );

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_reviewer, 'professional_application_approved', 'professional_applications', v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'organization_id', v_org.id,
      'organization_slug', v_org.slug,
      'location_id', v_location_id
    )
  );

  return v_application;
end;
$function$;

-- ---- review_professional_claim : corps d'avant PLAT-1, repris verbatim
create or replace function public.review_professional_claim(p_claim_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS professional_claims
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_reviewer uuid;
  v_claim public.professional_claims;
  v_professional public.professionals;
  v_org_id uuid;
  v_org_count integer;
  v_converted boolean := false;
begin
  v_reviewer := (select auth.uid());
  if v_reviewer is null or not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff can review professional claims'
      using errcode = '42501';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  -- The row lock is what makes a double-clicked Approve safe: the second call
  -- waits, then sees a state that is no longer pending and returns without
  -- repeating a single side effect.
  select * into v_claim from public.professional_claims where id = p_claim_id for update;
  if not found then
    raise exception 'claim not found' using errcode = '42704';
  end if;

  if v_claim.state <> 'pending' then
    return v_claim;
  end if;

  if p_decision = 'reject' then
    update public.professional_claims
    set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
        decision_note = nullif(btrim(coalesce(p_note, '')), '')
    where id = v_claim.id
    returning * into v_claim;

    insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
    values (v_reviewer, 'professional_claim_rejected', 'professional_claims', v_claim.id,
            jsonb_build_object('professional_id', v_claim.professional_id,
                               'claimant_user_id', v_claim.claimant_user_id));
    return v_claim;
  end if;

  -- ---- approve ----------------------------------------------------------
  -- Lock the IDENTITY, not just the claim. Two reviewers approving two
  -- different claims for the same professional serialise here; the loser
  -- re-reads a row that is already claimed and refuses below.
  select * into v_professional from public.professionals
  where id = v_claim.professional_id for update;

  if v_professional.claim_state = 'claimed' then
    raise exception 'this professional identity is already claimed and cannot be transferred'
      using errcode = '42501';
  end if;

  -- Re-checked under the lock: the claimant may have acquired an identity
  -- between submitting and being reviewed.
  if exists (select 1 from public.professionals p where p.user_id = v_claim.claimant_user_id) then
    raise exception 'the claimant already has a professional identity; merging identities is not yet supported'
      using errcode = '42501';
  end if;

  perform set_config('fadeup.professional_claim_write', 'on', true);
  update public.professionals
  set claim_state = 'claimed', user_id = v_claim.claimant_user_id, claimed_at = now()
  where id = v_professional.id;
  perform set_config('fadeup.professional_claim_write', 'off', true);

  update public.professional_claims
  set state = 'approved', decided_at = now(), decided_by = v_reviewer,
      decision_note = nullif(btrim(coalesce(p_note, '')), '')
  where id = v_claim.id
  returning * into v_claim;

  -- Every other live claim on this identity is now moot. Closing them is not
  -- housekeeping: leaving them pending would let a later reviewer approve a
  -- second one and hit 23505 on the one-approval index, which is a confusing
  -- way to discover the profile was already taken.
  update public.professional_claims
  set state = 'rejected', decided_at = now(), decided_by = v_reviewer,
      decision_note = 'another claim for this professional identity was approved'
  where professional_id = v_professional.id
    and state = 'pending'
    and id <> v_claim.id;

  -- Close the acquisition loop. The organization is DERIVED, never supplied:
  -- a caller-provided organization_id would let a reviewer attribute someone
  -- else's conversion. Exactly one owner membership is unambiguous; zero or
  -- several is not, and this declines to guess rather than picking one.
  select count(*) into v_org_count
  from public.memberships m
  where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

  if v_org_count = 1 then
    select m.organization_id into v_org_id
    from public.memberships m
    where m.user_id = v_claim.claimant_user_id and m.role = 'owner';

    v_converted := private.record_prospect_conversion(v_professional.id, v_org_id);
  end if;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (v_reviewer, 'professional_claim_approved', 'professional_claims', v_claim.id,
          jsonb_build_object('professional_id', v_professional.id,
                             'claimant_user_id', v_claim.claimant_user_id,
                             'owner_organization_count', v_org_count,
                             'prospect_conversion_recorded', v_converted));

  return v_claim;
end;
$function$;

-- ---- moderate_review : corps d'avant PLAT-1, repris verbatim
create or replace function public.moderate_review(p_review_id uuid, p_status text, p_reason text DEFAULT NULL::text)
 RETURNS reviews
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_review public.reviews;
begin
  if not private.is_platform_admin() then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('published','under_review','removed') then
    raise exception 'invalid moderation status';
  end if;
  -- « La note est mauvaise » n'est pas un motif : seuls les cinq motifs de
  -- la contrainte reviews_moderation_reason_valid sont représentables.
  update public.reviews
     set status = p_status,
         moderation_reason = case when p_status = 'published' then null else p_reason end,
         moderated_at = case when p_status = 'published' then null else now() end,
         moderated_by = case when p_status = 'published' then null else (select auth.uid()) end
   where id = p_review_id
  returning * into v_review;
  if not found then
    raise exception 'review not found';
  end if;
  return v_review;
end;
$function$;

-- ---- resolve_review_report : corps d'avant PLAT-1, repris verbatim
create or replace function public.resolve_review_report(p_report_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.is_platform_admin() then
    raise exception 'platform moderation only' using errcode = '42501';
  end if;
  if p_status not in ('reviewed','dismissed','actioned') then
    raise exception 'invalid report resolution';
  end if;
  update public.review_reports
     set status = p_status,
         resolved_at = now(),
         resolved_by = (select auth.uid())
   where id = p_report_id;
  if not found then
    raise exception 'report not found';
  end if;
end;
$function$;

-- ---- assign_commercial_plan : corps d'avant PLAT-1, repris verbatim
create or replace function public.assign_commercial_plan(p_organization_id uuid, p_plan_key text, p_status commercial_status DEFAULT 'active'::commercial_status, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid;
  v_old_plan text;
  v_old_status public.commercial_status;
  v_max_est integer;
  v_max_pro integer;
  v_used_est integer;
  v_used_pro integer;
  v_change_id uuid;
begin
  v_actor := (select auth.uid());

  if v_actor is null then
    raise exception 'changing a commercial plan requires an authenticated session'
      using errcode = '42501';
  end if;

  -- The whole authorization decision, in one line, resolved from the session
  -- and never from an argument. An owner of the organization is NOT sufficient:
  -- the organization is the party being charged, and a party cannot decide what
  -- it owes.
  if not (select private.is_platform_admin()) then
    raise exception 'only FadeUp platform staff may change an organization commercial plan'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;

  -- Unknown plan fails closed and says so, rather than being coerced into
  -- something plausible. is_available is checked too: a withdrawn plan may be
  -- kept for the organizations already on it, and must not be newly assignable.
  select p.max_establishments, p.max_operational_professionals
    into v_max_est, v_max_pro
  from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available;

  if v_max_est is null then
    raise exception 'unknown or unavailable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023',
            hint = 'Plan keys are free, solo, salon_essential, salon_pro, salon_business, multi_growth, multi_pro, multi_scale.';
  end if;

  perform private.ensure_organization_commercial_state(p_organization_id);

  -- Serialise against concurrent assignment AND against concurrent location or
  -- roster creation: this is the same row those triggers lock, so "downgrade
  -- while another location is being created" cannot interleave into a state
  -- where both succeeded.
  select s.plan_key, s.status into v_old_plan, v_old_status
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id
  for update;

  if v_old_plan is null then
    raise exception 'organization not found' using errcode = '42704';
  end if;

  if v_old_plan = p_plan_key and v_old_status = p_status then
    raise exception 'organization is already on % with status %', p_plan_key, p_status
      using errcode = 'P0001';
  end if;

  -- Counted AFTER the lock, so the numbers in the error message are the
  -- numbers the decision was made on.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  -- The same rule the trigger enforces, checked here so the caller gets an
  -- explanation rather than a constraint violation. Defence in depth, not a
  -- substitute: the trigger still runs on the UPDATE below.
  if v_used_est > v_max_est then
    raise exception
      'cannot move to %: it covers % establishment(s) and this organization operates %. Nothing has been changed.',
      p_plan_key, v_max_est, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first. FadeUp does not remove establishments to satisfy a plan change.';
  end if;

  if v_max_pro is not null and v_used_pro > v_max_pro then
    raise exception
      'cannot move to %: it covers % operational professional(s) and this organization rosters %. Nothing has been changed.',
      p_plan_key, v_max_pro, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first. Their identity, followers and appointment history are preserved either way.';
  end if;

  update public.organization_commercial_state
  set plan_key = p_plan_key,
      status = p_status,
      -- Hard-coded. A staff decision is a staff decision, and no argument to
      -- this function can make it look like a payment.
      entitlement_source = 'platform_grant',
      assigned_at = now(),
      assigned_by = v_actor,
      assignment_note = p_note
  where organization_id = p_organization_id;

  insert into public.commercial_plan_changes
    (organization_id, previous_plan_key, new_plan_key,
     previous_status, new_status, entitlement_source, changed_by, change_reason)
  values
    (p_organization_id, v_old_plan, p_plan_key,
     v_old_status, p_status, 'platform_grant', v_actor, p_note)
  returning id into v_change_id;

  return v_change_id;
end;
$function$;

-- ---- prepare_billing_checkout : corps d'avant PLAT-1, repris verbatim
create or replace function public.prepare_billing_checkout(p_organization_id uuid, p_plan_key text, p_interval stripe_billing_interval DEFAULT 'month'::stripe_billing_interval)
 RETURNS TABLE(organization_id uuid, organization_name text, stripe_customer_id text, stripe_price_id text, owner_email text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_sub_status text;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_plan from public.commercial_plans p
  where p.plan_key = p_plan_key and p.is_available and p.price_minor > 0;

  if v_plan.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_plan_key, '(null)')
      using errcode = '22023';
  end if;

  -- Un abonnement vivant ne se double pas : on en change.
  select b.subscription_status into v_sub_status
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_sub_status in ('active', 'trialing', 'past_due') then
    raise exception 'this organization already has a subscription — use request_plan_change or the customer portal'
      using errcode = 'P0001';
  end if;

  -- La faisabilité, AVANT le paiement : souscrire un plan qui ne couvre pas
  -- l'activité réelle produirait une organisation en infraction dès la
  -- première seconde.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_plan.max_establishments then
    raise exception 'cannot subscribe to %: it covers % establishment(s) and this organization operates %',
      p_plan_key, v_plan.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Pick a Multi-salons tier that covers every active establishment.';
  end if;

  if v_plan.max_operational_professionals is not null
     and v_used_pro > v_plan.max_operational_professionals then
    raise exception 'cannot subscribe to %: it covers % professional(s) and this organization rosters %',
      p_plan_key, v_plan.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Pick a plan that covers the whole team — team size is included in shop plans.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_plan_key
    and sp.billing_interval = p_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / % — run the catalog sync first', p_plan_key, p_interval
      using errcode = 'P0001';
  end if;

  return query
  select
    p_organization_id,
    o.name,
    b.stripe_customer_id,
    v_price,
    (select r.email from private.org_owner_recipient(p_organization_id) r),
    private.billing_livemode()
  from public.organizations o
  left join public.organization_billing b on b.organization_id = o.id
  where o.id = p_organization_id;
end;
$function$;

-- ---- prepare_billing_portal : corps d'avant PLAT-1, repris verbatim
create or replace function public.prepare_billing_portal(p_organization_id uuid)
 RETURNS TABLE(stripe_customer_id text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer text;
begin
  perform private.assert_billing_owner(p_organization_id);

  select b.stripe_customer_id into v_customer
  from public.organization_billing b
  where b.organization_id = p_organization_id;

  if v_customer is null then
    raise exception 'no Stripe customer for this organization yet — subscribe first'
      using errcode = 'P0001';
  end if;

  return query select v_customer, private.billing_livemode();
end;
$function$;

-- ---- request_billing_cancellation : corps d'avant PLAT-1, repris verbatim
create or replace function public.request_billing_cancellation(p_organization_id uuid)
 RETURNS TABLE(stripe_subscription_id text, effective_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_billing public.organization_billing;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to cancel' using errcode = 'P0001';
  end if;

  -- La fonction Edge pose cancel_at_period_end chez Stripe ; le webhook
  -- confirmera. À l'échéance : retour au Free — profil, réputation, relations
  -- et historique conservés. La suppression définitive est une procédure
  -- RGPD distincte, hors de ce chantier.
  return query select v_billing.stripe_subscription_id, v_billing.current_period_end;
end;
$function$;

-- ---- request_plan_change : corps d'avant PLAT-1, repris verbatim
create or replace function public.request_plan_change(p_organization_id uuid, p_new_plan_key text, p_new_interval stripe_billing_interval DEFAULT 'month'::stripe_billing_interval)
 RETURNS TABLE(decision text, effective_at timestamp with time zone, stripe_subscription_id text, stripe_subscription_item_id text, stripe_price_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_billing public.organization_billing;
  v_new public.commercial_plans;
  v_current public.commercial_plans;
  v_price text;
  v_used_est integer;
  v_used_pro integer;
  v_upgrade boolean;
begin
  perform private.assert_billing_owner(p_organization_id);

  select * into v_billing from public.organization_billing b
  where b.organization_id = p_organization_id
  for update;

  if v_billing.stripe_subscription_id is null
     or v_billing.subscription_status not in ('active', 'trialing', 'past_due') then
    raise exception 'no live subscription to change — subscribe first'
      using errcode = 'P0001';
  end if;

  select * into v_new from public.commercial_plans p
  where p.plan_key = p_new_plan_key and p.is_available and p.price_minor > 0;

  if v_new.plan_key is null then
    raise exception 'unknown, unavailable or non-payable plan: %', coalesce(p_new_plan_key, '(null)')
      using errcode = '22023';
  end if;

  select * into v_current from public.commercial_plans p
  where p.plan_key = v_billing.plan_key;

  if v_new.plan_key = v_billing.plan_key and p_new_interval = v_billing.billing_interval then
    raise exception 'the organization is already on % (%)', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA FAISABILITÉ, AVANT TOUT. Un refus est un motif, jamais une donnée
  -- cassée : rien n'a été écrit quand on lève ici.
  v_used_est := private.org_active_establishments(p_organization_id);
  v_used_pro := private.org_active_professionals(p_organization_id);

  if v_used_est > v_new.max_establishments then
    raise exception 'cannot move to %: it covers % establishment(s) and this organization operates %',
      p_new_plan_key, v_new.max_establishments, v_used_est
      using errcode = 'P0001',
            hint = 'Deactivate the establishments no longer in use first, or pick a tier that covers them. FadeUp never removes an establishment to satisfy a plan change.';
  end if;

  if v_new.max_operational_professionals is not null
     and v_used_pro > v_new.max_operational_professionals then
    raise exception 'cannot move to %: it covers % professional(s) and this organization rosters %',
      p_new_plan_key, v_new.max_operational_professionals, v_used_pro
      using errcode = 'P0001',
            hint = 'Offboard the professionals no longer working here first — their identity, followers and history are preserved either way.';
  end if;

  select sp.stripe_price_id into v_price
  from public.billing_stripe_prices sp
  where sp.plan_key = p_new_plan_key
    and sp.billing_interval = p_new_interval
    and sp.livemode = private.billing_livemode()
    and sp.is_active;

  if v_price is null then
    raise exception 'no active Stripe price for % / %', p_new_plan_key, p_new_interval
      using errcode = 'P0001';
  end if;

  -- LA DIRECTION. Montée = prix mensuel supérieur, ou passage à l'annuel à
  -- plan égal ou supérieur. Tout le reste attend la fin de la période payée.
  v_upgrade :=
    v_new.price_minor > v_current.price_minor
    or (v_new.price_minor >= v_current.price_minor
        and p_new_interval = 'year' and v_billing.billing_interval = 'month');

  if v_upgrade then
    -- Immédiat. La fonction Edge applique chez Stripe avec proratisation ;
    -- le webhook subscription.updated mettra l'état à jour. Un programmé
    -- antérieur (une descente en attente) est annulé : la dernière décision
    -- du propriétaire gagne.
    update public.organization_billing
    set scheduled_plan_key = null, scheduled_interval = null,
        scheduled_effective_at = null, scheduled_dispatched_at = null,
        scheduled_reason = null
    where organization_id = p_organization_id;

    return query select
      'immediate'::text, now(),
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  else
    -- Fin de période. Il a payé jusqu'au bout, il garde jusqu'au bout — une
    -- descente qui coupe une capacité déjà payée est un litige.
    update public.organization_billing
    set scheduled_plan_key = p_new_plan_key,
        scheduled_interval = p_new_interval,
        scheduled_effective_at = v_billing.current_period_end,
        scheduled_dispatched_at = null,
        scheduled_reason = 'owner_request'
    where organization_id = p_organization_id;

    return query select
      'scheduled'::text, v_billing.current_period_end,
      v_billing.stripe_subscription_id, v_billing.stripe_subscription_item_id, v_price;
  end if;
end;
$function$;

-- ---- request_billing_quote : corps d'avant PLAT-1, repris verbatim
create or replace function public.request_billing_quote(p_organization_id uuid, p_establishments integer, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform private.assert_billing_owner(p_organization_id);

  if p_establishments is null or p_establishments <= 0 then
    raise exception 'establishments must be a positive number' using errcode = '22023';
  end if;

  insert into public.billing_quote_requests
    (organization_id, requested_by, establishments_requested, note)
  values
    (p_organization_id, (select auth.uid()), p_establishments, p_note)
  on conflict (organization_id) where status = 'open' do nothing
  returning id into v_id;

  if v_id is null then
    select q.id into v_id from public.billing_quote_requests q
    where q.organization_id = p_organization_id and q.status = 'open';
  end if;

  return v_id;
end;
$function$;

-- ---- start_platform_support_session : corps d'avant PLAT-1, repris verbatim
create or replace function public.start_platform_support_session(p_organization_id uuid, p_target_type text, p_target_user_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS platform_support_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_session public.platform_support_sessions;
begin
  if not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may start a support-view session';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization not found';
  end if;

  -- Close any session this actor left open — starting a new one always
  -- means "I'm switching what I'm looking at now", not stacking contexts.
  update public.platform_support_sessions
  set ended_at = now()
  where platform_actor_id = (select auth.uid()) and ended_at is null;

  insert into public.platform_support_sessions (platform_actor_id, organization_id, target_type, target_user_id, reason)
  values ((select auth.uid()), p_organization_id, p_target_type, p_target_user_id, nullif(btrim(p_reason), ''))
  returning * into v_session;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    (select auth.uid()),
    'platform_support_session_started',
    'organizations',
    p_organization_id,
    jsonb_build_object('session_id', v_session.id, 'target_type', p_target_type, 'target_user_id', p_target_user_id)
  );

  return v_session;
end;
$function$;

-- ---- create_platform_invitation : corps d'avant PLAT-1, repris verbatim
create or replace function public.create_platform_invitation(p_role platform_role, p_invited_email text DEFAULT NULL::text, p_expires_in interval DEFAULT '7 days'::interval)
 RETURNS TABLE(id uuid, raw_token text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_raw_token text;
  v_id uuid;
  v_expires_at timestamptz;
  v_is_owner boolean;
begin
  if p_role = 'platform_owner' then
    raise exception 'platform_owner cannot be granted through an invitation';
  end if;

  v_is_owner := (select private.is_platform_owner());

  if p_role = 'platform_admin' and not v_is_owner then
    raise exception 'only a platform owner may invite a platform_admin';
  end if;

  if p_role = 'platform_support' and not (select private.is_platform_admin()) then
    raise exception 'only a platform owner or platform_admin may invite platform_support';
  end if;

  v_raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + p_expires_in;

  insert into public.platform_invitations (token_hash, role, invited_email, invited_by, expires_at)
  values (
    encode(extensions.digest(v_raw_token, 'sha256'), 'hex'),
    p_role,
    nullif(lower(btrim(p_invited_email)), ''),
    (select auth.uid()),
    v_expires_at
  )
  returning platform_invitations.id into v_id;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values ((select auth.uid()), 'platform_invitation_created', 'platform_invitations', v_id, jsonb_build_object('role', p_role));

  return query select v_id, v_raw_token, v_expires_at;
end;
$function$;

-- ---- submit_professional_application : corps d'avant PLAT-1, repris verbatim
create or replace function public.submit_professional_application(p_first_name text, p_last_name text, p_phone text, p_business_name text, p_professional_type professional_type, p_city text DEFAULT NULL::text, p_address_line1 text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_country text DEFAULT NULL::text, p_staff_count integer DEFAULT NULL::integer, p_website text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_business_identifier text DEFAULT NULL::text)
 RETURNS professional_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid;
  v_email text;
  v_application public.professional_applications;
  v_existing public.professional_applications;
  v_phone text;
begin
  v_user_id := (select auth.uid());
  if v_user_id is null then
    raise exception 'authentication required to submit a professional application';
  end if;

  -- The email is taken from the verified auth identity, never from the form:
  -- a reviewer must be able to trust that the address they see is the one
  -- that actually owns the account.
  select u.email into v_email from auth.users u where u.id = v_user_id;
  if v_email is null or btrim(v_email) = '' then
    raise exception 'this account has no email address';
  end if;

  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'first and last name are required';
  end if;
  if btrim(coalesce(p_business_name, '')) = '' then
    raise exception 'business name is required';
  end if;

  -- Phone is the qualification channel — the reviewer calls this number — so
  -- it is required and normalized here rather than trusted from the client.
  v_phone := public.normalize_phone_number(p_phone);
  if v_phone is null then
    raise exception 'a valid phone number is required';
  end if;

  -- Resubmission is idempotent rather than an error: a double-submit (or a
  -- refresh mid-request) should land the applicant on their status screen,
  -- not on a unique-violation stack trace.
  select * into v_existing
    from public.professional_applications a
    where a.user_id = v_user_id and a.status in ('pending_review', 'approved')
    limit 1;
  if found then
    return v_existing;
  end if;

  insert into public.professional_applications (
    user_id, first_name, last_name, email, phone,
    business_name, professional_type, city, address_line1, postal_code, country,
    staff_count, website, instagram, business_identifier, status
  )
  values (
    v_user_id, btrim(p_first_name), btrim(p_last_name), lower(btrim(v_email)), v_phone,
    btrim(p_business_name), p_professional_type,
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address_line1, '')), ''),
    nullif(btrim(coalesce(p_postal_code, '')), ''),
    nullif(btrim(coalesce(p_country, '')), ''),
    p_staff_count,
    nullif(btrim(coalesce(p_website, '')), ''),
    nullif(btrim(coalesce(p_instagram, '')), ''),
    nullif(btrim(coalesce(p_business_identifier, '')), ''),
    'pending_review'
  )
  returning * into v_application;

  -- Fan out to every platform member. Body carries only what a reviewer needs
  -- to decide whether to open the item — no phone, no address.
  insert into public.platform_notifications (recipient_user_id, type, title, body, target_type, target_id)
  select
    pm.user_id,
    'professional_application_submitted',
    v_application.business_name,
    v_application.first_name || ' ' || v_application.last_name,
    'professional_applications',
    v_application.id
  from public.platform_members pm;

  insert into public.platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  values (
    v_user_id,
    'professional_application_submitted',
    'professional_applications',
    v_application.id,
    jsonb_build_object(
      'business_name', v_application.business_name,
      'professional_type', v_application.professional_type
    )
  );

  return v_application;
end;
$function$;

-- 2. Les policies CRM (tables postgres) --------------------------------------

do $$
declare
  v_tables text[] := array[
    'api_source_health', 'api_source_limits', 'api_usage',
    'prospect_contacts', 'prospect_duplicates', 'prospect_events',
    'prospect_job_sources', 'prospect_jobs', 'prospect_locations',
    'prospect_notes', 'prospect_outreach', 'prospect_professionals',
    'prospect_publication_eligibility', 'prospect_scores',
    'prospect_social_profiles', 'prospect_source_records', 'prospect_sources',
    'prospect_suppressions', 'prospect_tags', 'prospects'
  ];
  v_staff text := '(select private.has_platform_role(array[''platform_owner'', ''platform_admin'', ''platform_support'']::public.platform_role[]))';
  v_admin text := '(select private.is_platform_admin())';
  r record;
  v_done integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = any(v_tables)
      and (p.policyname like '%\_select\_platform\_staff' or p.policyname like '%\_select\_platform'
        or p.policyname like '%\_write\_platform\_admin' or p.policyname like '%\_insert\_platform\_admin'
        or p.policyname like '%\_update\_platform\_admin' or p.policyname like '%\_delete\_platform\_admin')
    order by p.tablename, p.policyname
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    if r.cmd = 'SELECT' then
      execute format('create policy %I on public.%I for select to authenticated using (%s)', r.policyname, r.tablename, v_staff);
    elsif r.cmd = 'INSERT' then
      execute format('create policy %I on public.%I for insert to authenticated with check (%s)', r.policyname, r.tablename, v_admin);
    elsif r.cmd = 'UPDATE' then
      execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', r.policyname, r.tablename, v_admin, v_admin);
    elsif r.cmd = 'DELETE' then
      execute format('create policy %I on public.%I for delete to authenticated using (%s)', r.policyname, r.tablename, v_admin);
    end if;
    v_done := v_done + 1;
  end loop;
  raise notice 'retour arrière PLAT-1 : % policies CRM (postgres)', v_done;
end $$;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select
  on public.organizations for select to authenticated
  using (
    (select private.is_org_member(id))
    or (select private.is_platform_admin())
  );

drop policy if exists platform_notifications_select on public.platform_notifications;
create policy platform_notifications_select
  on public.platform_notifications for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (select private.has_platform_role(array['platform_owner', 'platform_admin', 'platform_support']::public.platform_role[]))
  );

drop policy if exists platform_notifications_update_own on public.platform_notifications;
create policy platform_notifications_update_own
  on public.platform_notifications for update to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (select private.has_platform_role(array['platform_owner', 'platform_admin', 'platform_support']::public.platform_role[]))
  )
  with check (
    recipient_user_id = (select auth.uid())
    and (select private.has_platform_role(array['platform_owner', 'platform_admin', 'platform_support']::public.platform_role[]))
  );

-- 3. La vue en tant que redevient sans échéance ------------------------------

drop policy if exists platform_support_sessions_select on public.platform_support_sessions;
create policy platform_support_sessions_select
  on public.platform_support_sessions for select to authenticated
  using (
    platform_actor_id = (select auth.uid())
    or (select private.is_platform_admin())
  );

alter table public.platform_support_sessions
  drop constraint if exists platform_support_sessions_expiry_after_start;
alter table public.platform_support_sessions drop column if exists expires_at;

grant select on public.platform_support_sessions to anon;

-- 4. Le journal redevient protégé par les seuls privilèges -------------------

drop trigger if exists platform_audit_log_append_only on public.platform_audit_log;
drop function if exists public.reject_platform_audit_mutation();
grant select on public.platform_audit_log to anon;

-- 5. Les gestes que PLAT-1 a ajoutés -----------------------------------------

drop function if exists public.capture_field_prospect(public.prospect_type, text, text, text, text, text, text, text, text);
drop function if exists public.cancel_appointment_as_platform(uuid, text);
drop function if exists public.delete_barber_as_platform(uuid, text);
drop function if exists public.moderate_post(uuid, text, text);
drop function if exists public.list_organization_support_sessions(uuid);
drop function if exists public.list_platform_team();
drop function if exists public.set_platform_member_role(uuid, public.platform_role, text);
drop function if exists public.revoke_platform_member(uuid, text);
drop function if exists public.create_platform_zone(text, text, text, text);
drop function if exists public.set_platform_member_zones(uuid, uuid[]);
drop function if exists public.get_my_platform_permissions();

-- 6. Les zones et l'origine des prospects ------------------------------------

alter table public.prospects drop constraint if exists prospects_field_origin_shape;
drop index if exists public.prospects_origin_idx;
drop index if exists public.prospects_field_captured_by_idx;
alter table public.prospects
  drop column if exists origin,
  drop column if exists field_captured_by,
  drop column if exists field_captured_at,
  drop column if exists field_observation;
drop type if exists public.prospect_origin;

drop table if exists public.platform_member_zones;
drop table if exists public.platform_zones;

-- 7. La grille elle-même ------------------------------------------------------

drop function if exists private.platform_prospect_visible(uuid);
drop function if exists private.platform_is_zone_limited();
drop function if exists private.platform_zone_key(text);
drop function if exists private.assert_not_in_support_view(text);
drop function if exists private.platform_active_support_session();
drop function if exists private.platform_can(text);
drop table if exists public.platform_role_permissions;
drop table if exists public.platform_permissions;

commit;

do $$ begin raise notice 'PLAT-1 : retour arrière appliqué'; end $$;
