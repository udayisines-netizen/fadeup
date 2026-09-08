-- FadeUp — X2 : conformité RGPD avant publication des profils externes.
--
-- À APPLIQUER EN postgres (tous les objets touchés lui appartiennent —
-- vérifié en production : publish_external_professional, prospect_outreach_payload,
-- email_outbox, email_templates, marketplace_withdrawal_requests → postgres).
--
-- CE QUE CE FICHIER CONSTRUIT, ET POURQUOI DANS CET ORDRE
--
--   L'article 14 du RGPD impose d'informer une personne quand ses données
--   n'ont pas été collectées auprès d'elle. Le modèle B2 publiait une fiche
--   puis attendait qu'un client déclenche une demande pour envoyer le premier
--   e-mail : on publiait avant d'informer, et le délai entre les deux n'était
--   pas borné. Ce fichier déplace l'information AU MOMENT de la publication.
--
--   1. L'e-mail d'information (gabarit external_profile_published, FR+EN) —
--      distinct de la prospection : il informe, il ne vend RIEN. Il part à la
--      publication, pas à la première demande. verify_x2.sql échoue si un mot
--      commercial y entre.
--   2. La trace (professional_information_notices) : quand l'information est
--      partie, à quelle adresse, par quel canal — ou pourquoi elle n'a pas pu
--      partir (prospect sans e-mail → la page publique d'information couvre
--      le cas, c'est la « mesure appropriée » de l'article 14(5)(b)).
--   3. La demande de retrait PUBLIQUE (submit_marketplace_withdrawal_request,
--      anon) : elle ENREGISTRE une demande dans le circuit B2, elle ne
--      dépublie rien elle-même — B2 a écrit pourquoi un retrait public direct
--      serait une arme (20260904180600, en-tête), et cette raison tient.
--      L'opérateur valide, l'engagement des 72 h court, complete_… exécute.
--   4. Le retour de délivrabilité Resend (resend_webhook_events + la passe
--      run_email_feedback_maintenance) : un rebond dur ou une plainte marque
--      le contact do_not_contact — une adresse qui rebondit ne doit plus
--      jamais être sollicitée, et la réputation du domaine d'envoi est
--      partagée avec les liens magiques (BLOCKERS §6/§7).
--
-- CE QUE CE FICHIER CORRIGE AU PASSAGE, DÉCLARÉ
--
--   a. prospect_outreach_payload écrivait profile_url = fade-up.com/p/… ;
--      la route réelle du front est /pro/:handle. Les e-mails de prospection
--      pointaient donc vers un 404. Corrigé ici (un lot RGPD qui laisse des
--      liens morts dans ses e-mails d'information ne vaut rien).
--   b. publish_external_professional : la branche idempotente « déjà lié »
--      republiait sans consulter AUCUN garde — un profil retiré sur demande
--      (do_not_contact posé par complete_marketplace_withdrawal) pouvait être
--      republié d'un clic. La non-republication est une promesse faite au
--      professionnel qui s'est opposé : la branche vérifie désormais
--      do_not_contact et la liste de suppression avant de rendre visible.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ===========================================================================
-- 1. email_outbox : le retour de délivrabilité
--
-- La machine d'état B2 (queued → sending → sent|failed) reste INTACTE :
-- `sent` continue de signifier « Resend a accepté le message ». Ce que le
-- webhook apprend ensuite vit dans des colonnes distinctes — un fait nouveau
-- ne réécrit pas un fait acquis.
-- ===========================================================================

alter table public.email_outbox
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists bounce_classification text;

comment on column public.email_outbox.delivered_at is
  'Posé par le webhook Resend (email.delivered). NULL ne veut pas dire « non délivré » : avant l''activation du webhook, aucun retour n''existe (BLOCKERS §7).';
comment on column public.email_outbox.bounce_classification is
  'Le type de rebond tel que Resend le nomme (permanent/transient…), en minuscules. Un rebond permanent supprime l''adresse de toute prospection future.';

-- Le webhook rapproche par l'identifiant Resend. Sans index, chaque événement
-- serait un parcours séquentiel de l'outbox.
create index if not exists email_outbox_provider_message_id_idx
  on public.email_outbox (provider_message_id)
  where provider_message_id is not null;

-- ===========================================================================
-- 2. Le journal des événements Resend
--
-- Miroir exact du motif B3 (stripe_webhook_events) : la fonction Edge mince
-- vérifie la signature Svix puis INSÈRE ici ; tout le traitement est en SQL,
-- exécuté par le scheduler, testé par verify_x2.sql. La clé primaire est
-- l'identifiant Svix de l'événement (en-tête svix-id) : c'est elle qui donne
-- l'idempotence — un rejeu Resend est un non-événement.
-- ===========================================================================

create table if not exists public.resend_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'queued',
  error text,
  attempts integer not null default 0,
  received_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint resend_webhook_events_status_valid
    check (status in ('queued', 'processed', 'skipped', 'failed')),
  constraint resend_webhook_events_id_shape
    check (btrim(event_id) <> '' and char_length(event_id) <= 200),
  constraint resend_webhook_events_type_not_blank
    check (btrim(event_type) <> '')
);

comment on table public.resend_webhook_events is
  'Journal brut des événements Resend (délivré, rebond, plainte, ouverture), clé primaire = identifiant Svix (idempotence). La fonction Edge resend-webhook n''écrit qu''ici et seulement après vérification de signature ; private.apply_resend_webhook_feedback traite, le scheduler cadence.';

create index if not exists resend_webhook_events_queued_idx
  on public.resend_webhook_events (received_at)
  where status = 'queued';

create index if not exists resend_webhook_events_type_idx
  on public.resend_webhook_events (event_type, received_at desc);

alter table public.resend_webhook_events enable row level security;
alter table public.resend_webhook_events force row level security;

drop policy if exists resend_webhook_events_select on public.resend_webhook_events;
create policy resend_webhook_events_select
  on public.resend_webhook_events
  for select to authenticated
  using ((select private.is_platform_admin()));

revoke all on table public.resend_webhook_events from anon, authenticated;
grant select on table public.resend_webhook_events to authenticated;
-- La fonction Edge insère en service_role via PostgREST — même posture que
-- stripe_webhook_events (ACL vérifiée en production : service_role=arwdDxtm).
grant all on table public.resend_webhook_events to service_role;

-- ===========================================================================
-- 3. Le traitement des événements
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

create or replace function public.run_email_feedback_maintenance()
returns table (events_processed integer, addresses_suppressed integer)
language sql
security definer
set search_path = ''
as $$
  select * from private.apply_resend_webhook_feedback(100);
$$;

comment on function public.run_email_feedback_maintenance() is
  'Passe scheduler X2 : applique le retour de délivrabilité Resend. Sans événement en attente, ne fait rien. Grantée au seul fadeup_scheduler, comme les autres run_*.';

revoke all on function public.run_email_feedback_maintenance() from public, anon, authenticated;
grant execute on function public.run_email_feedback_maintenance() to fadeup_scheduler;

-- ===========================================================================
-- 4. La demande de retrait publique
--
-- B2 a refusé un formulaire public qui DÉPUBLIE (n'importe qui ferait
-- disparaître n'importe quel commerce) et cette raison tient. Ce qui manquait
-- au RGPD, c'est un formulaire public qui DEMANDE : la demande entre dans le
-- circuit B2 exactement comme celles reçues par e-mail ou téléphone,
-- l'opérateur vérifie l'identité, la valide, et l'engagement des 72 h court.
-- Deux canaux nouveaux, tracés :
--   'public_form' — le formulaire de la page d'information, non vérifié ;
--   'email_link'  — le même formulaire, atteint par le lien de l'e-mail
--                   d'information : le jeton prouve le contrôle de la boîte
--                   aux lettres du prospect, l'opérateur le sait.
-- ===========================================================================

alter table public.marketplace_withdrawal_requests
  add column if not exists requester_email text;

comment on column public.marketplace_withdrawal_requests.requester_email is
  'Adresse laissée par le demandeur du formulaire public, pour la vérification et la réponse de l''opérateur. Optionnelle : le RGPD n''exige pas une adresse pour s''opposer.';

alter table public.marketplace_withdrawal_requests
  drop constraint if exists marketplace_withdrawal_requests_via_valid;
alter table public.marketplace_withdrawal_requests
  add constraint marketplace_withdrawal_requests_via_valid
    check (requested_via in ('email', 'phone', 'platform_operator', 'legal', 'other',
                             'public_form', 'email_link'));

alter table public.marketplace_withdrawal_requests
  drop constraint if exists marketplace_withdrawal_requests_requester_email_shape;
alter table public.marketplace_withdrawal_requests
  add constraint marketplace_withdrawal_requests_requester_email_shape
    check (requester_email is null
           or requester_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

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

-- ===========================================================================
-- 5. La trace de l'information
--
-- « Quand l'information a été envoyée, à quelle adresse, avec quel résultat »
-- — c'est ce qu'on produit si un professionnel conteste. Le résultat vit dans
-- email_outbox (status, sent_at, provider_message_id, puis delivered_at/
-- bounced_at par le webhook) : cette table N'EN DUPLIQUE RIEN, elle relie le
-- professionnel à la ligne d'outbox et enregistre le cas sans e-mail.
-- ===========================================================================

create table if not exists public.professional_information_notices (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professionals (id) on delete cascade,
  prospect_id uuid references public.prospects (id) on delete set null,

  -- 'email'            l'information est partie par e-mail (outbox_id la trace) ;
  -- 'public_page_only' le prospect n'a pas d'adresse — l'information repose
  --                    sur la page publique (article 14(5)(b), mesure
  --                    appropriée), et cette ligne PROUVE que le cas a été vu.
  channel text not null,
  email text,
  outbox_id uuid references public.email_outbox (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint professional_information_notices_channel_valid
    check (channel in ('email', 'public_page_only')),
  constraint professional_information_notices_email_shape
    check ((channel = 'email') = (email is not null))
);

comment on table public.professional_information_notices is
  'La trace de l''information article 14 : une ligne par (professionnel, canal). Le RÉSULTAT de l''envoi se lit en joignant email_outbox (status, sent_at, delivered_at, bounced_at) — jamais dupliqué ici.';

create unique index if not exists professional_information_notices_one_per_channel
  on public.professional_information_notices (professional_id, channel);

alter table public.professional_information_notices enable row level security;
alter table public.professional_information_notices force row level security;

drop policy if exists professional_information_notices_select on public.professional_information_notices;
create policy professional_information_notices_select
  on public.professional_information_notices
  for select to authenticated
  using ((select private.is_platform_admin()));

revoke all on table public.professional_information_notices from anon, authenticated;
grant select on table public.professional_information_notices to authenticated;

-- ===========================================================================
-- 6. La mise en file de l'e-mail d'information
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

-- ===========================================================================
-- 7. publish_external_professional : informer à la publication
--
-- Redéfinition de la version B1 (20260904160000). Deux changements, tous
-- deux dans le corps :
--   1. les DEUX branches qui rendent visible appellent
--      private.enqueue_publication_information — poser le déclencheur dans la
--      seule branche neuve raterait la branche idempotente (elle republie
--      aussi, ligne « auto-réparation » de B1) ;
--   2. la branche idempotente refuse désormais de RE-publier un profil dont
--      le prospect est do_not_contact ou supprimé : la non-republication
--      promise par B2 (complete_marketplace_withdrawal) n'était gardée que
--      dans la branche neuve — un clic Publier suffisait à annuler un retrait.
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

-- ===========================================================================
-- 8. prospect_outreach_payload : les liens des e-mails mènent quelque part
--
-- Redéfinition de la version B2 (20260904180500) pour UNE correction :
-- profile_url pointait vers fade-up.com/p/… — la route réelle est
-- /pro/:handle. Un professionnel sans handle n'a pas de page : son lien va
-- vers la page d'information, jamais vers un 404. Tout le reste — et
-- notamment la garde « aucune colonne de contact client » — est inchangé.
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
