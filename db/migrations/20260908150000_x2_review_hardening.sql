-- FadeUp — X2 : durcissements issus de la revue indépendante (opus-reviewer).
--
-- À APPLIQUER EN postgres.
--
-- QUATRE DÉFAUTS RÉELS, PROUVÉS PAR LA REVUE, CORRIGÉS ICI
--
--   1. `private.enqueue_publication_information` n'avait AUCUNE des gardes de
--      contact de B2 : un re-clic Publier sur un profil déjà public dont le
--      prospect s'était DÉSABONNÉ mettait en file un e-mail vers l'adresse
--      qui a dit non (prouvé en transaction rollback). Désormais :
--      do_not_contact, suppression prospect ou adresse supprimée → PAS
--      d'e-mail, trace `public_page_only` (le devoir d'information subsiste,
--      la page publique est la mesure appropriée — et la personne a déjà
--      manifesté qu'elle ne veut pas de nos messages).
--   2. La garde de non-republication de la branche idempotente de
--      `publish_external_professional` divergeait de `publication_block_reason`
--      (elle ignorait `suppressed_email` et les autres motifs). Une seule
--      définition désormais : le garde authoritatif, en ignorant seulement
--      `already_published` (vrai par construction dans cette branche).
--   3. `submit_marketplace_withdrawal_request` acceptait une fiche NON
--      publiée (échéance 72 h factice dans l'écran opérateur), sa garde de
--      volume était inopérante (l'index « une pending par professionnel »
--      plafonne déjà le compte sous 200 — elle est RETIRÉE, et c'est dit),
--      la branche de course pouvait lever un 23505 nu, et `already_pending`
--      révélait l'existence d'une demande entrée par un AUTRE canal
--      (opérateur). Corrigés — le demandeur public n'apprend jamais rien
--      d'une demande qu'il n'a pas faite : il reçoit l'engagement générique.
--   4. `apply_resend_webhook_feedback` perdait DÉFINITIVEMENT un événement
--      passé `failed` (rien ne relisait jamais ce statut), et un
--      `created_at` non castable levait — précisément le genre d'accident
--      qui perdrait un rebond dur. Horodatage défensif + reprise des
--      `failed` tant que `attempts < 5`.
--
-- ET DEUX AMÉLIORATIONS DE MÊME ORIGINE
--
--   5. Heures calmes pour l'e-mail d'information : B2 les applique à la
--      prospection ; une publication à 3 h du matin envoyait la notice à
--      3 h. `next_attempt_at` est posé au prochain 08:00 local du
--      destinataire quand la publication a lieu hors 08:00–21:00.
--   6. Le désabonnement en un clic (RFC 8058) : l'URL des e-mails pointe
--      désormais la fonction Edge `unsubscribe` (GET → redirection vers la
--      page humaine ; POST machine → désabonnement immédiat). L'ancienne
--      page `/unsubscribe/:token` reste la destination humaine.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ===========================================================================
-- 1 + 5. La mise en file de l'information, avec les gardes de contact
-- ===========================================================================

create or replace function private.enqueue_publication_information(p_professional_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_locale text;
  v_info_url text;
  v_outbox_id uuid;
  v_tz text;
  v_local_hour integer;
  v_next_attempt timestamptz;
begin
  select
    p.handle,
    p.display_name,
    pr.id as prospect_id,
    nullif(btrim(coalesce(pr.email, '')), '') as email,
    pr.country,
    pr.do_not_contact,
    pr.outreach_unsubscribe_token as token,
    exists (select 1 from public.prospect_suppressions s
            where s.scope = 'prospect' and s.prospect_id = pr.id) as prospect_suppressed
  into v
  from public.professionals p
  left join public.prospect_professionals pp on pp.professional_id = p.id
  left join public.prospects pr on pr.id = pp.prospect_id
  where p.id = p_professional_id
    and p.claim_state = 'unclaimed';

  if not found then
    -- Revendiqué ou inexistant : l'information article 14 ne concerne que les
    -- identités créées sans la personne.
    return;
  end if;

  -- Les gardes de contact de B2, TOUTES (revue X2) : une personne qui s'est
  -- désabonnée, opposée, ou dont l'adresse a rebondi dur ne reçoit PLUS RIEN
  -- — y compris une notice légale. Son information repose sur la page
  -- publique (article 14(5)(b)), et la trace le dit.
  if v.email is null
     or coalesce(v.do_not_contact, false)
     or coalesce(v.prospect_suppressed, false)
     or (v.email is not null and private.is_prospect_value_suppressed('email', v.email)) then
    insert into public.professional_information_notices
      (professional_id, prospect_id, channel)
    values (p_professional_id, v.prospect_id, 'public_page_only')
    on conflict (professional_id, channel) do nothing;
    return;
  end if;

  v_locale := case
    when v.country in ('FR', 'BE', 'LU', 'MC', 'CH') then 'fr'
    else 'en'
  end;

  v_info_url := 'https://fade-up.com/professionals-data'
    || '?pro=' || coalesce(v.handle, p_professional_id::text)
    || case when v.token is not null then '&t=' || v.token else '' end;

  -- Heures calmes (motif B2, 08:00–21:00 heure locale du destinataire) : la
  -- publication n'attend pas, l'e-mail si. next_attempt_at retient le
  -- message jusqu'au prochain matin — le scheduler ne dispatche que les
  -- messages dont l'heure est venue.
  v_tz := coalesce(public.suggested_timezone_for_country(v.country), 'Europe/Paris');
  v_local_hour := extract(hour from now() at time zone v_tz)::integer;
  if v_local_hour between 8 and 20 then
    v_next_attempt := now();
  elsif v_local_hour >= 21 then
    v_next_attempt := ((now() at time zone v_tz)::date + 1 + time '08:00') at time zone v_tz;
  else
    v_next_attempt := ((now() at time zone v_tz)::date + time '08:00') at time zone v_tz;
  end if;

  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key, next_attempt_at)
  values (
    v.email,
    'external_profile_published',
    v_locale,
    jsonb_build_object(
      'display_name', v.display_name,
      'profile_url', case when v.handle is not null
                          then 'https://fade-up.com/pro/' || v.handle
                          else v_info_url end,
      'info_url', v_info_url,
      'withdrawal_url', v_info_url || '#withdraw',
      -- La fonction Edge : GET → page humaine, POST machine (RFC 8058
      -- One-Click) → désabonnement immédiat. Même jeton, même RPC.
      'unsubscribe_url', 'https://fade-up.com/functions/v1/unsubscribe/' || coalesce(v.token, '')
    ),
    'prospecting',
    'publication_notice:' || p_professional_id::text,
    v_next_attempt
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    return;
  end if;

  insert into public.professional_information_notices
    (professional_id, prospect_id, channel, email, outbox_id)
  values (p_professional_id, v.prospect_id, 'email', v.email, v_outbox_id)
  on conflict (professional_id, channel) do nothing;
end;
$$;

comment on function private.enqueue_publication_information(uuid) is
  'Met en file l''e-mail d''information article 14 pour une identité externe non revendiquée, au moment de sa publication. Refuse d''écrire à quiconque s''est désabonné/opposé ou dont l''adresse est supprimée (gardes B2, revue X2) et trace alors public_page_only. Heures calmes 08:00–21:00 locales via next_attempt_at. Idempotente par dedupe_key — un professionnel n''est informé qu''une fois.';

revoke all on function private.enqueue_publication_information(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 2. Une seule définition de l'éligibilité à la (re)publication
-- ===========================================================================

create or replace function public.publish_external_professional(p_prospect_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- ===========================================================================
-- 3. La demande de retrait publique, resserrée
-- ===========================================================================

create or replace function public.submit_marketplace_withdrawal_request(
  p_professional_id uuid,
  p_requester_email text default null,
  p_requester_note text default null,
  p_token text default null
)
returns table (request_id uuid, deadline_at timestamptz, already_pending boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_state public.professional_claim_state;
  v_is_public boolean;
  v_channel text := 'public_form';
  v_email text;
  v_note text;
  v_row public.marketplace_withdrawal_requests;
  v_attempt integer;
begin
  select p.claim_state, p.is_public into v_claim_state, v_is_public
  from public.professionals p where p.id = p_professional_id;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  if v_claim_state = 'claimed' then
    raise exception 'this profile is claimed; its owner controls its visibility'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=professional_is_claimed';
  end if;

  -- Revue X2 : une fiche non publiée n'a rien à retirer — accepter la
  -- demande ouvrirait une échéance de 72 h factice dans l'écran opérateur
  -- (et permettrait d'en ouvrir une par identité jamais publiée). Le refus
  -- est nommé ; la page explique et renvoie au désabonnement/contact.
  if not v_is_public then
    raise exception 'this profile is not published on the marketplace'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=profile_not_published';
  end if;

  v_email := nullif(btrim(coalesce(p_requester_email, '')), '');
  if v_email is not null
     and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'requester email is not a valid address'
      using errcode = '22023',
            detail = 'fadeup_withdrawal_refusal=invalid_email';
  end if;

  -- La garde de volume « 200/24 h » de la première version est RETIRÉE, et
  -- c'est une décision, pas un oubli : l'index unique « une demande en cours
  -- par professionnel » plafonne déjà le total au nombre d'identités
  -- publiées non revendiquées — la garde était inatteignable, et globale
  -- elle aurait permis à un attaquant de fermer le canal d'opposition RGPD
  -- aux personnes légitimes.

  if nullif(btrim(coalesce(p_token, '')), '') is not null then
    perform 1
    from public.prospects pr
    join public.prospect_professionals pp on pp.prospect_id = pr.id
    where pp.professional_id = p_professional_id
      and pr.outreach_unsubscribe_token = btrim(p_token);
    if found then
      v_channel := 'email_link';
    end if;
  end if;

  v_note := nullif(left(btrim(coalesce(p_requester_note, '')), 2000), '');

  -- Deux tentatives : la première perd si une demande en cours existe (index
  -- unique partiel) ; la seconde ne court que si cette demande vient d'être
  -- décidée dans l'intervalle — et porte son propre on conflict (revue X2 :
  -- la première version pouvait lever un 23505 nu dans cette fenêtre).
  for v_attempt in 1..2 loop
    insert into public.marketplace_withdrawal_requests
      (professional_id, requested_via, requester_note, requester_email)
    values (p_professional_id, v_channel, v_note, v_email)
    on conflict (professional_id) where status = 'pending' do nothing
    returning * into v_row;

    if v_row.id is not null then
      return query select v_row.id, v_row.deadline_at, false;
      return;
    end if;

    select * into v_row
    from public.marketplace_withdrawal_requests w
    where w.professional_id = p_professional_id and w.status = 'pending';

    if v_row.id is not null then
      if v_row.requested_via in ('public_form', 'email_link') then
        -- La re-soumission du même formulaire : dite telle quelle.
        return query select v_row.id, v_row.deadline_at, true;
        return;
      end if;
      -- Une demande EXISTE mais elle est entrée par un autre canal
      -- (opérateur, e-mail, légal). Le demandeur public n'a pas à apprendre
      -- que quelqu'un a déjà demandé le retrait de ce commerce : il reçoit
      -- l'engagement GÉNÉRIQUE (« au plus tard 72 h après validation »),
      -- jamais l'échéance réelle — qui est plus proche, l'engagement est
      -- donc tenu a fortiori. Sa note/adresse ne sont pas perdues pour
      -- l'opérateur : la demande existante est déjà dans sa file.
      return query select v_row.id, now() + interval '72 hours', false;
      return;
    end if;
    -- Aucune pending : la demande concurrente vient d'être décidée — la
    -- boucle retente une insertion.
  end loop;

  raise exception 'could not record the withdrawal request' using errcode = '40001';
end;
$$;

comment on function public.submit_marketplace_withdrawal_request(uuid, text, text, text) is
  'Anon-callable — le formulaire public de la page d''information RGPD. ENREGISTRE une demande de retrait dans le circuit B2 pour une fiche PUBLIÉE non revendiquée ; l''opérateur vérifie l''identité puis complete_marketplace_withdrawal exécute, sous l''engagement des 72 h. Canal email_link quand le jeton de l''e-mail prouve le contrôle de la boîte. Refus nommés : professional_is_claimed, profile_not_published, invalid_email. Ne révèle jamais l''existence d''une demande entrée par un autre canal.';

revoke all on function public.submit_marketplace_withdrawal_request(uuid, text, text, text) from public;
grant execute on function public.submit_marketplace_withdrawal_request(uuid, text, text, text)
  to anon, authenticated, service_role;

-- ===========================================================================
-- 4. Le traitement des événements : horodatage défensif, reprise des failed
-- ===========================================================================

create or replace function private.apply_resend_webhook_feedback(p_limit integer default 100)
returns table (events_processed integer, addresses_suppressed integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_evt record;
  v_email_id text;
  v_event_at timestamptz;
  v_class text;
  v_addr text;
  v_status text;
  v_error text;
  v_processed integer := 0;
  v_suppressed integer := 0;
  v_suppress boolean;
  v_reason text;
begin
  for v_evt in
    -- Les failed REVIENNENT tant que attempts < 5 (revue X2 : la première
    -- version les perdait pour toujours — un deadlock aurait suffi à perdre
    -- un rebond dur). Un événement vraiment intraitable s'arrête à 5, avec
    -- son erreur en clair.
    select e.event_id, e.event_type, e.payload, e.received_at
    from public.resend_webhook_events e
    where e.status = 'queued' or (e.status = 'failed' and e.attempts < 5)
    order by e.received_at
    limit p_limit
    for update skip locked
  loop
    v_status := 'processed';
    v_error := null;

    begin
      v_email_id := nullif(v_evt.payload -> 'data' ->> 'email_id', '');

      -- Horodatage DÉFENSIF : un created_at absent ou non castable ne doit
      -- jamais faire échouer l'événement (revue X2).
      begin
        v_event_at := coalesce(nullif(v_evt.payload ->> 'created_at', '')::timestamptz, v_evt.received_at);
      exception when others then
        v_event_at := v_evt.received_at;
      end;

      v_suppress := false;
      v_reason := null;

      if v_evt.event_type = 'email.delivered' then
        update public.email_outbox
        set delivered_at = coalesce(delivered_at, v_event_at)
        where provider_message_id = v_email_id and v_email_id is not null;

      elsif v_evt.event_type = 'email.opened' then
        update public.email_outbox
        set opened_at = coalesce(opened_at, v_event_at)
        where provider_message_id = v_email_id and v_email_id is not null;

      elsif v_evt.event_type = 'email.bounced' then
        v_class := lower(coalesce(
          v_evt.payload -> 'data' -> 'bounce' ->> 'type',
          v_evt.payload -> 'data' ->> 'bounce_type',
          ''
        ));
        -- bounced_at garde le PREMIER rebond ; la classification reflète le
        -- DERNIER connu.
        update public.email_outbox
        set bounced_at = coalesce(bounced_at, v_event_at),
            bounce_classification = coalesce(nullif(v_class, ''), bounce_classification)
        where provider_message_id = v_email_id and v_email_id is not null;

        if v_class like 'permanent%' or v_class = 'hard' then
          v_suppress := true;
          v_reason := 'hard_bounce';
        end if;

      elsif v_evt.event_type = 'email.complained' then
        update public.email_outbox
        set complained_at = coalesce(complained_at, v_event_at)
        where provider_message_id = v_email_id and v_email_id is not null;
        v_suppress := true;
        v_reason := 'spam_complaint';

      else
        v_status := 'skipped';
      end if;

      if v_suppress then
        for v_addr in
          select distinct lower(btrim(t.value))
          from jsonb_array_elements_text(
            case jsonb_typeof(v_evt.payload -> 'data' -> 'to')
              when 'array' then v_evt.payload -> 'data' -> 'to'
              else '[]'::jsonb
            end
          ) as t(value)
          where btrim(t.value) <> ''
        loop
          insert into public.prospect_suppressions (scope, value, reason)
          values ('email', v_addr, v_reason)
          on conflict (scope, value) where value is not null do nothing;

          update public.prospects
          set do_not_contact = true
          where lower(email) = v_addr and not do_not_contact;

          v_suppressed := v_suppressed + 1;
        end loop;
      end if;

    exception when others then
      v_status := 'failed';
      v_error := left(sqlerrm, 500);
    end;

    update public.resend_webhook_events
    set status = v_status,
        error = v_error,
        attempts = attempts + 1,
        processed_at = now()
    where event_id = v_evt.event_id;

    if v_status = 'processed' then
      v_processed := v_processed + 1;
    end if;
  end loop;

  return query select v_processed, v_suppressed;
end;
$$;

comment on function private.apply_resend_webhook_feedback(integer) is
  'Traite les événements Resend en attente ET reprend les failed (attempts < 5) : delivered/opened → horodatage sur email_outbox ; rebond PERMANENT ou plainte → suppression de l''adresse (prospect_suppressions scope=email) + do_not_contact sur les prospects porteurs. Idempotent : chaque effet est un coalesce/on conflict, un rejeu ne double rien.';

revoke all on function private.apply_resend_webhook_feedback(integer) from public, anon, authenticated;

-- ===========================================================================
-- 6. Les e-mails de prospection B2 pointent aussi la fonction One-Click
-- ===========================================================================

create or replace function private.prospect_outreach_payload(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- Déjà réduit à l'écriture : « Karim B. ». C'est tout ce que cette table
    -- connaît du client.
    'customer_display_name', r.customer_display_name,
    'service_label', r.service_label,
    'preferred_starts_at_fr', to_char(r.preferred_starts_at at time zone private.prospect_timezone(pr.id), 'DD/MM/YYYY à HH24:MI'),
    'preferred_starts_at_en', to_char(r.preferred_starts_at at time zone private.prospect_timezone(pr.id), 'YYYY-MM-DD at HH24:MI'),
    'expires_at_fr', to_char(r.expires_at at time zone private.prospect_timezone(pr.id), 'DD/MM/YYYY à HH24:MI'),
    'expires_at_en', to_char(r.expires_at at time zone private.prospect_timezone(pr.id), 'YYYY-MM-DD at HH24:MI'),
    'city', coalesce((select pl.city from public.prospect_locations pl
                      where pl.prospect_id = pr.id order by pl.is_primary desc limit 1), ''),
    'profile_url', case when p.handle is not null
                        then 'https://fade-up.com/pro/' || p.handle
                        else 'https://fade-up.com/professionals-data?pro=' || p.id::text end,
    -- La fonction Edge : GET humain → redirection vers /unsubscribe/:token ;
    -- POST machine (RFC 8058 One-Click, en-tête List-Unsubscribe) →
    -- désabonnement immédiat. Sans elle, un client mail qui honorait
    -- One-Click recevait l'index de la SPA et rien n'était enregistré.
    'unsubscribe_url', 'https://fade-up.com/functions/v1/unsubscribe/' || pr.outreach_unsubscribe_token
  )
  from public.professional_interest_requests r
  join public.professionals p on p.id = r.professional_id
  join public.prospect_professionals pp on pp.professional_id = p.id
  join public.prospects pr on pr.id = pp.prospect_id
  where r.id = p_request_id;
$$;

comment on function private.prospect_outreach_payload(uuid) is
'Le SEUL payload autorisé pour un e-mail de prospection. MASTER_SPEC §5 : avant vérification, le professionnel voit un prénom ou une initiale, le service et l''horaire — jamais le téléphone ni l''e-mail complet du client.

La garde n''est pas une convention de rédaction : cette fonction lit professional_interest_requests, qui NE CONTIENT AUCUNE COLONNE DE CONTACT, et il n''existe aucun chemin de jointure d''ici vers professional_interest_request_contacts. La fuite n''est pas improbable, elle est irreprésentable. verify_b2.sql échoue si la table de contacts apparaît un jour dans cette définition.

X2 : profile_url corrigé vers la route réelle /pro/:handle ; unsubscribe_url pointe la fonction Edge unsubscribe (GET → page humaine, POST → One-Click RFC 8058).';

revoke all on function private.prospect_outreach_payload(uuid) from public, anon, authenticated;

commit;
