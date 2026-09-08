-- X2 — retour arrière de 20260908150000_x2_review_hardening.sql.
-- À APPLIQUER EN postgres.
--
-- Restaure les cinq fonctions à leur état 20260908120000 (la version X2
-- initiale, AVANT les durcissements de la revue). Pour revenir à l'état
-- pré-X2 complet, enchaîner ensuite les downs 20260908120100 puis
-- 20260908120000.

set lock_timeout = '5s';

begin;

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
begin
  select
    p.handle,
    p.display_name,
    pr.id as prospect_id,
    nullif(btrim(coalesce(pr.email, '')), '') as email,
    pr.country,
    pr.outreach_unsubscribe_token as token
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

  if v.email is null then
    -- Pas d'adresse : l'information directe exigerait un effort
    -- disproportionné — la page publique la remplace (article 14(5)(b)).
    -- La ligne enregistre que le cas a été VU, pas oublié.
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

  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
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
      'unsubscribe_url', 'https://fade-up.com/unsubscribe/' || coalesce(v.token, '')
    ),
    'prospecting',
    'publication_notice:' || p_professional_id::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing
  returning id into v_outbox_id;

  if v_outbox_id is null then
    -- Déjà informé (republication, double-clic) : l'article 14 s'exécute une
    -- fois, la trace existe déjà.
    return;
  end if;

  insert into public.professional_information_notices
    (professional_id, prospect_id, channel, email, outbox_id)
  values (p_professional_id, v.prospect_id, 'email', v.email, v_outbox_id)
  on conflict (professional_id, channel) do nothing;
end;
$$;

comment on function private.enqueue_publication_information(uuid) is
  'Met en file l''e-mail d''information article 14 pour une identité externe non revendiquée, au moment de sa publication. Sans adresse : trace public_page_only (la page publique est la mesure appropriée). Idempotente par dedupe_key — un professionnel n''est informé qu''une fois. Le gabarit external_profile_published n''a AUCUN contenu commercial (verify_x2.sql le contrôle mot à mot).';

revoke all on function private.enqueue_publication_information(uuid) from public, anon, authenticated;

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
  v_blocked boolean;
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
    -- retrait : un prospect do_not_contact ou supprimé s'est opposé, et la
    -- republication d'un clic annulerait l'engagement tenu par
    -- complete_marketplace_withdrawal.
    select (pr.do_not_contact
            or exists (select 1 from public.prospect_suppressions s
                       where s.scope = 'prospect' and s.prospect_id = pr.id))
    into v_blocked
    from public.prospects pr where pr.id = p_prospect_id;

    if v_blocked then
      perform 1 from public.professionals p
      where p.id = v_existing and not p.is_public;
      if found then
        raise exception 'prospect is not eligible for publication: do_not_contact'
          using errcode = '42501';
      end if;
      -- Déjà public ET do_not_contact : état hérité — on ne dépublie pas en
      -- douce depuis un chemin de publication, on rend l'identité telle
      -- qu'elle est. Le retrait a son propre circuit.
    end if;

    update public.professionals
    set is_public = true
    where id = v_existing and not is_public;

    -- L'information article 14 part à la PUBLICATION — cette branche publie
    -- aussi. Idempotente : dedupe_key, un professionnel informé une fois.
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
  v_channel text := 'public_form';
  v_email text;
  v_row public.marketplace_withdrawal_requests;
begin
  select p.claim_state into v_claim_state
  from public.professionals p where p.id = p_professional_id;

  if not found then
    raise exception 'professional not found' using errcode = '42704';
  end if;

  if v_claim_state = 'claimed' then
    -- Même refus, même code que le chemin opérateur B2 : un profil revendiqué
    -- se retire depuis son propre compte, pas par un formulaire anonyme.
    raise exception 'this profile is claimed; its owner controls its visibility'
      using errcode = '42501',
            detail = 'fadeup_withdrawal_refusal=professional_is_claimed';
  end if;

  v_email := nullif(btrim(coalesce(p_requester_email, '')), '');
  if v_email is not null
     and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'requester email is not a valid address'
      using errcode = '22023',
            detail = 'fadeup_withdrawal_refusal=invalid_email';
  end if;

  -- Garde de volume, pas de silence : au-delà de 200 demandes publiques en
  -- 24 h (un ordre de grandeur au-dessus de tout usage réel — il y a ~23
  -- prospects publiables), quelqu'un scripte le formulaire. On refuse avec un
  -- motif nommé, la page affiche le canal e-mail de repli. Les demandes déjà
  -- enregistrées ne sont pas touchées ; rien ne se dépublie de toute façon
  -- sans un opérateur.
  if (select count(*) from public.marketplace_withdrawal_requests w
      where w.requested_via in ('public_form', 'email_link')
        and w.created_at > now() - interval '24 hours') >= 200 then
    raise exception 'too many public withdrawal requests; please contact us by email'
      using errcode = '54000',
            detail = 'fadeup_withdrawal_refusal=rate_limited';
  end if;

  -- Le jeton de l'e-mail d'information prouve le contrôle de la boîte du
  -- prospect : la demande est marquée comme vérifiée par ce canal. Un jeton
  -- faux ou étranger ne bloque pas — la demande reste possible, non vérifiée.
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

  insert into public.marketplace_withdrawal_requests
    (professional_id, requested_via, requester_note, requester_email)
  values
    (p_professional_id, v_channel,
     nullif(left(btrim(coalesce(p_requester_note, '')), 2000), ''),
     v_email)
  on conflict (professional_id) where status = 'pending' do nothing
  returning * into v_row;

  if v_row.id is null then
    -- Une demande est déjà en cours : la re-soumettre ne crée ni une deuxième
    -- échéance ni une deuxième exécution (index unique partiel B2). On rend
    -- l'échéance existante — le demandeur voit que c'est pris en compte.
    select * into v_row
    from public.marketplace_withdrawal_requests w
    where w.professional_id = p_professional_id and w.status = 'pending';

    if v_row.id is null then
      -- Course résiduelle (l'autre demande vient d'être décidée) : réessayer
      -- une fois suffit, la fenêtre est de l'ordre de la milliseconde.
      insert into public.marketplace_withdrawal_requests
        (professional_id, requested_via, requester_note, requester_email)
      values
        (p_professional_id, v_channel,
         nullif(left(btrim(coalesce(p_requester_note, '')), 2000), ''),
         v_email)
      returning * into v_row;
    else
      return query select v_row.id, v_row.deadline_at, true;
      return;
    end if;
  end if;

  return query select v_row.id, v_row.deadline_at, false;
end;
$$;

comment on function public.submit_marketplace_withdrawal_request(uuid, text, text, text) is
  'Anon-callable — le formulaire public de la page d''information RGPD. ENREGISTRE une demande de retrait dans le circuit B2 (marketplace_withdrawal_requests), ne dépublie RIEN : l''opérateur vérifie l''identité puis complete_marketplace_withdrawal exécute, sous l''engagement des 72 h. Canal ''email_link'' quand le jeton de l''e-mail d''information prouve le contrôle de la boîte, ''public_form'' sinon. Refus nommés : professional_is_claimed, invalid_email, rate_limited.';

revoke all on function public.submit_marketplace_withdrawal_request(uuid, text, text, text) from public;
grant execute on function public.submit_marketplace_withdrawal_request(uuid, text, text, text)
  to anon, authenticated, service_role;

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
    select e.event_id, e.event_type, e.payload, e.received_at
    from public.resend_webhook_events e
    where e.status = 'queued'
    order by e.received_at
    limit p_limit
    for update skip locked
  loop
    v_status := 'processed';
    v_error := null;

    begin
      v_email_id := nullif(v_evt.payload -> 'data' ->> 'email_id', '');
      v_event_at := coalesce(
        nullif(v_evt.payload ->> 'created_at', '')::timestamptz,
        v_evt.received_at
      );
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
        -- DERNIER connu — un transitoire suivi d'un permanent doit finir
        -- « permanent », pas rester figé sur la première réponse du serveur.
        update public.email_outbox
        set bounced_at = coalesce(bounced_at, v_event_at),
            bounce_classification = coalesce(nullif(v_class, ''), bounce_classification)
        where provider_message_id = v_email_id and v_email_id is not null;

        -- Un rebond DUR (permanent) supprime l'adresse. Un rebond transitoire
        -- (boîte pleine, greylisting) n'est pas une interdiction de contact.
        if v_class like 'permanent%' or v_class = 'hard' then
          v_suppress := true;
          v_reason := 'hard_bounce';
        end if;

      elsif v_evt.event_type = 'email.complained' then
        update public.email_outbox
        set complained_at = coalesce(complained_at, v_event_at)
        where provider_message_id = v_email_id and v_email_id is not null;
        -- Une plainte est toujours définitive : la personne a dit non.
        v_suppress := true;
        v_reason := 'spam_complaint';

      else
        -- email.sent, email.delivery_delayed, email.clicked, types futurs :
        -- journalisés, pas traités. « skipped » les distingue d'un échec.
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
          -- La liste de suppression par VALEUR : elle bloque la re-sélection
          -- même sous un prospect redécouvert demain (motif B1/R4). Elle
          -- n'affecte que la chaîne de prospection — l'envoi transactionnel
          -- ne la consulte pas, et c'est voulu : un lien magique répond à une
          -- action explicite de la personne.
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
  'Traite les événements Resend en attente : delivered/opened → horodatage sur email_outbox ; rebond PERMANENT ou plainte → suppression de l''adresse (prospect_suppressions scope=email) + do_not_contact sur les prospects porteurs. Idempotent par construction : chaque événement n''est traité qu''une fois (statut), et tous les effets sont des coalesce/on conflict.';

revoke all on function private.apply_resend_webhook_feedback(integer) from public, anon, authenticated;

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
    'unsubscribe_url', 'https://fade-up.com/unsubscribe/' || pr.outreach_unsubscribe_token
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

X2 : profile_url corrigé vers la route réelle /pro/:handle (l''original pointait /p/…, un 404).';

revoke all on function private.prospect_outreach_payload(uuid) from public, anon, authenticated;

commit;
