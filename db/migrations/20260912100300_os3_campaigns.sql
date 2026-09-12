-- FadeUp — OS-3 : les sollicitations par MODÈLES.
--
-- RÔLE D'APPLICATION : postgres (objets neufs ; `public.customers` et
-- `public.email_streams` appartiennent à postgres — vérifié avant écriture).
-- Dépend de 20260912100100 (l'étiquette `marketing` du flux) et de
-- 20260912100200 (le plafond mensuel).
--
-- ============================================================================
-- CE QUE CE FICHIER TRANCHE
-- ============================================================================
--
-- 1. AUCUN SECOND SYSTÈME D'ENVOI. Une campagne écrit des lignes dans
--    `email_outbox` — la même table, le même `private.email_dispatch_batch`,
--    la même clé Resend, la même réconciliation. La campagne n'est qu'un
--    OBJET DE TRAÇABILITÉ posé à côté, qui dit qui a écrit, quand, quel
--    modèle, à combien de personnes, et ce que ça a donné. Il n'y a ni
--    seconde file, ni second expéditeur, ni cron.
--
-- 2. PAS DE MESSAGE LIBRE. Quatre modèles, dont le corps vit dans
--    `email_templates` (fr + en) comme tous les e-mails de FadeUp. Le
--    professionnel remplit une ACCROCHE bornée (160 caractères, une seule
--    ligne, ni URL, ni jeton de gabarit) et les quelques champs de son
--    modèle. Il ne rédige pas l'e-mail ; il le paramètre.
--
-- 3. LES HEURES CALMES SE PROGRAMMENT, ELLES NE S'ANNULENT PAS. B2 les
--    applique en SAUTANT le tick (`continue`) ; X2 les applique en écrivant
--    `email_outbox.next_attempt_at` à la prochaine heure permise. C'est la
--    seconde forme qui convient ici — une campagne est un geste ponctuel du
--    professionnel, pas une passe périodique : si on « sautait », personne ne
--    repasserait. `email_dispatch_batch` ne ramasse que
--    `next_attempt_at <= now()`, donc écrire la date EST le report.
--    La fenêtre reste celle de B2 : 08:00–21:00, heure LOCALE DU LIEU.
--
-- 4. LE PLAFOND EST SERVEUR. `send_notification_campaign` compte les
--    campagnes du mois calendaire et refuse au-delà du plafond du plan
--    effectif, avec un motif nommé. L'interface le dit AVANT ; la base le
--    refuse QUAND MÊME. Un refus d'interface n'est pas une autorisation.
--
-- 5. UN PROFESSIONNEL N'ÉCRIT QU'À SES CLIENTS. Trois barrières superposées :
--    la garde de rôle (`private.has_org_role(owner, manager)`), le fait que
--    `public.customers` est PAR ORGANISATION (une adresse d'un autre salon
--    n'est structurellement pas atteignable), et l'exigence d'au moins UNE
--    prestation réellement délivrée par CE salon
--    (`private.customer_visit_stats`, la définition d'OS-2).
--
--    ÉCART ASSUMÉ ET DÉCLARÉ : le prompt demande de vérifier sur
--    `customer_professional_relationships`. Cette table n'enregistre que les
--    clients qui ont un COMPTE FadeUp (`customer_user_id` non nul, R1A) ;
--    OS-2 §5 a établi qu'un habitué sans compte est un VRAI client du salon
--    et simplement pas « vérifié ». Exiger la ligne de relation aurait donc
--    interdit au salon d'écrire à la majorité de ses clients réels.
--    `private.customer_visit_stats` est le SUR-ENSEMBLE exact : « une
--    prestation délivrée par ce salon », dont la relation est le cas
--    « avec compte ». Les deux sont rendus séparément (`is_verified_client`)
--    et jamais agrégés.
--
-- 6. LE DÉSABONNEMENT EST DÉFINITIF, ET GLOBAL. `customers.do_not_contact`
--    reprend le vocabulaire de B2 — dont le `do_not_contact` vit sur
--    `prospects`, une AUTRE population (des professionnels prospectés), et
--    ne pouvait donc pas être réutilisé tel quel ; c'est une constatation,
--    pas un contournement. Le jeton vit sur la fiche, mais un
--    désabonnement lève le drapeau sur TOUTES les fiches qui partagent
--    l'adresse, dans toutes les organisations : un client qui clique
--    « ne plus recevoir » ne demande pas « sauf les neuf autres salons ».
--    C'est aussi ce que la loi produit implique quand le prompt écrit « si
--    dix barbers écrivent, le client reçoit dix messages ».
--
-- 7. ~2 SOLLICITATIONS PAR SEMAINE (MASTER_SPEC §13), PAR PERSONNE ET TOUS
--    SALONS CONFONDUS. Rien n'existait : `email_outbox` n'a ni destinataire
--    étranger, ni catégorie. Le compte se fait donc sur
--    `notification_campaign_recipients`, qui est la seule table où une
--    sollicitation marketing est identifiée comme telle ET rattachée à une
--    adresse. Deux dans les sept derniers jours suffisent à exclure le
--    troisième envoi, quelle que soit l'organisation qui l'émet.
--
-- LE MOTIF NUL (X3) : chaque garde évalue une EXISTENCE
-- (`private.has_org_role`, `private.is_org_member`) ou compare une variable
-- déjà testée `is null`. L'organisation et le modèle sont validés AVANT
-- toute lecture, et « pas membre », « pas à moi » et « n'existe pas »
-- reçoivent le même refus.

begin;

-- ---------------------------------------------------------------------------
-- 1. Le flux marketing et ses gabarits
-- ---------------------------------------------------------------------------

insert into public.email_streams (stream, from_address, from_name, reply_to, requires_unsubscribe, is_enabled)
values (
  'marketing',
  -- Le SEUL domaine vérifié chez Resend est `contact.fade-up.com`
  -- (BLOCKERS n°6 : `pro.fade-up.com` répond 403). Une sous-adresse dédiée
  -- isole la réputation du marketing de celle du transactionnel sans exiger
  -- un second domaine à vérifier.
  'salons@contact.fade-up.com',
  'FadeUp',
  'bonjour@contact.fade-up.com',
  -- RFC 8058 : les en-têtes List-Unsubscribe sont ajoutés par
  -- email_dispatch_batch dès que ce drapeau est vrai ET que le payload porte
  -- `unsubscribe_url`. Les deux sont vrais ici, toujours.
  true,
  true
)
on conflict (stream) do update
  set from_address = excluded.from_address,
      from_name = excluded.from_name,
      reply_to = excluded.reply_to,
      requires_unsubscribe = excluded.requires_unsubscribe,
      is_enabled = excluded.is_enabled;

comment on table public.email_streams is
'Les flux d''envoi et leur expéditeur. `transactional` : ce que le client a demandé. `prospecting` : FadeUp écrit à un professionnel non revendiqué. `marketing` (OS-3) : un SALON écrit à SES clients — désabonnable, plafonné par plan, soumis aux heures calmes.';

-- Les quatre modèles. Le nom du salon est dans le SUJET et dans le corps :
-- `email_streams.from_name` est par FLUX, pas par message, et la base n'a pas
-- de domaine d'envoi par salon. Le client doit donc savoir dès le sujet qui
-- lui écrit — c'est aussi ce qui rend le désabonnement compréhensible.
insert into public.email_templates (template_key, locale, stream, subject, body_text, body_html) values
(
  'campaign_lapsed_customers', 'fr', 'marketing',
  '{{organization_name}} — ça fait un moment',
  E'Bonjour {{customer_name}},\n\n{{headline}}\n\nRéserver un créneau : {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nNe plus recevoir d''offres des salons FadeUp : {{unsubscribe_url}}',
  '<p>Bonjour {{customer_name}},</p><p>{{headline}}</p><p><a href="{{profile_url}}">Réserver un créneau</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Ne plus recevoir d''offres des salons FadeUp</a>.</p>'
),
(
  'campaign_lapsed_customers', 'en', 'marketing',
  '{{organization_name}} — it has been a while',
  E'Hi {{customer_name}},\n\n{{headline}}\n\nBook a slot: {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nStop receiving offers from FadeUp shops: {{unsubscribe_url}}',
  '<p>Hi {{customer_name}},</p><p>{{headline}}</p><p><a href="{{profile_url}}">Book a slot</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Stop receiving offers from FadeUp shops</a>.</p>'
),
(
  'campaign_free_slots_tomorrow', 'fr', 'marketing',
  '{{organization_name}} — {{slot_count}} créneau(x) demain',
  E'Bonjour {{customer_name}},\n\n{{headline}}\n\nIl reste {{slot_count}} créneau(x) le {{date_fr}}.\n\nRéserver : {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nNe plus recevoir d''offres des salons FadeUp : {{unsubscribe_url}}',
  '<p>Bonjour {{customer_name}},</p><p>{{headline}}</p><p>Il reste <strong>{{slot_count}}</strong> créneau(x) le {{date_fr}}.</p><p><a href="{{profile_url}}">Réserver</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Ne plus recevoir d''offres des salons FadeUp</a>.</p>'
),
(
  'campaign_free_slots_tomorrow', 'en', 'marketing',
  '{{organization_name}} — {{slot_count}} slot(s) tomorrow',
  E'Hi {{customer_name}},\n\n{{headline}}\n\n{{slot_count}} slot(s) left on {{date_en}}.\n\nBook: {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nStop receiving offers from FadeUp shops: {{unsubscribe_url}}',
  '<p>Hi {{customer_name}},</p><p>{{headline}}</p><p><strong>{{slot_count}}</strong> slot(s) left on {{date_en}}.</p><p><a href="{{profile_url}}">Book</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Stop receiving offers from FadeUp shops</a>.</p>'
),
(
  'campaign_promotion', 'fr', 'marketing',
  '{{organization_name}} — {{offer}}',
  E'Bonjour {{customer_name}},\n\n{{headline}}\n\nL''offre : {{offer}}\nValable {{period_fr}}.\n\nRéserver : {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nNe plus recevoir d''offres des salons FadeUp : {{unsubscribe_url}}',
  '<p>Bonjour {{customer_name}},</p><p>{{headline}}</p><p><strong>{{offer}}</strong><br>Valable {{period_fr}}.</p><p><a href="{{profile_url}}">Réserver</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Ne plus recevoir d''offres des salons FadeUp</a>.</p>'
),
(
  'campaign_promotion', 'en', 'marketing',
  '{{organization_name}} — {{offer}}',
  E'Hi {{customer_name}},\n\n{{headline}}\n\nThe offer: {{offer}}\nValid {{period_en}}.\n\nBook: {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nStop receiving offers from FadeUp shops: {{unsubscribe_url}}',
  '<p>Hi {{customer_name}},</p><p>{{headline}}</p><p><strong>{{offer}}</strong><br>Valid {{period_en}}.</p><p><a href="{{profile_url}}">Book</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Stop receiving offers from FadeUp shops</a>.</p>'
),
(
  'campaign_loyalty_reminder', 'fr', 'marketing',
  '{{organization_name}} — c''est bientôt l''heure',
  E'Bonjour {{customer_name}},\n\n{{headline}}\n\nVous venez {{cadence_fr}} ; votre dernier passage était il y a {{days_since}} jours.\n\nRéserver : {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nNe plus recevoir d''offres des salons FadeUp : {{unsubscribe_url}}',
  '<p>Bonjour {{customer_name}},</p><p>{{headline}}</p><p>Vous venez {{cadence_fr}} ; votre dernier passage était il y a <strong>{{days_since}}</strong> jours.</p><p><a href="{{profile_url}}">Réserver</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Ne plus recevoir d''offres des salons FadeUp</a>.</p>'
),
(
  'campaign_loyalty_reminder', 'en', 'marketing',
  '{{organization_name}} — almost time',
  E'Hi {{customer_name}},\n\n{{headline}}\n\nYou come {{cadence_en}}; your last visit was {{days_since}} days ago.\n\nBook: {{profile_url}}\n\n—\n{{organization_name}}, via FadeUp.\nStop receiving offers from FadeUp shops: {{unsubscribe_url}}',
  '<p>Hi {{customer_name}},</p><p>{{headline}}</p><p>You come {{cadence_en}}; your last visit was <strong>{{days_since}}</strong> days ago.</p><p><a href="{{profile_url}}">Book</a></p><hr><p style="font-size:12px;color:#666">{{organization_name}}, via FadeUp. <a href="{{unsubscribe_url}}">Stop receiving offers from FadeUp shops</a>.</p>'
)
on conflict (template_key, locale) do update
  set stream = excluded.stream,
      subject = excluded.subject,
      body_text = excluded.body_text,
      body_html = excluded.body_html;

-- ---------------------------------------------------------------------------
-- 2. Le désabonnement du client — définitif, global, anti-énumération
-- ---------------------------------------------------------------------------

alter table public.customers
  add column if not exists do_not_contact boolean not null default false;

alter table public.customers
  add column if not exists marketing_unsubscribe_token text
  default encode(extensions.gen_random_bytes(16), 'hex');

comment on column public.customers.do_not_contact is
'Le client a demandé à ne plus recevoir de sollicitation marketing. Levé sur TOUTES les fiches qui partagent l''adresse, dans toutes les organisations (OS-3) : un désabonnement n''est pas par salon. N''affecte JAMAIS le transactionnel — une confirmation de réservation n''est pas une sollicitation.';

comment on column public.customers.marketing_unsubscribe_token is
'Capacité de désabonnement en un clic (RFC 8058), 32 hexadécimaux. Même forme que prospects.outreach_unsubscribe_token (B2). NULL possible sur les fiches antérieures sans e-mail : le jeton est posé à la première sollicitation.';

create unique index if not exists customers_marketing_unsubscribe_token_key
  on public.customers (marketing_unsubscribe_token)
  where marketing_unsubscribe_token is not null;

create index if not exists customers_do_not_contact_idx
  on public.customers (lower(email))
  where do_not_contact and email is not null;

-- ---------------------------------------------------------------------------
-- 3. Les quatre modèles, et la trace
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_campaign_kind') then
    create type public.notification_campaign_kind as enum (
      'lapsed_customers',
      'free_slots_tomorrow',
      'promotion',
      'loyalty_reminder'
    );
  end if;
end;
$$;

create table if not exists public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.notification_campaign_kind not null,
  headline text not null,
  params jsonb not null default '{}'::jsonb,
  -- Le mois calendaire DE COMPTAGE, figé à l'écriture : recalculer le mois
  -- à la lecture ferait glisser le compteur d'une campagne du 31 au 1er.
  period_month date not null,
  recipient_count integer not null default 0,
  deferred_count integer not null default 0,
  suppressed_count integer not null default 0,
  scheduled_at timestamptz not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint notification_campaigns_headline_not_blank check (btrim(headline) <> ''),
  constraint notification_campaigns_counts_sane
    check (recipient_count >= 0 and deferred_count >= 0 and suppressed_count >= 0
           and deferred_count <= recipient_count),
  constraint notification_campaigns_period_is_month
    check (period_month = date_trunc('month', period_month)::date)
);

comment on table public.notification_campaigns is
'Une sollicitation par modèle envoyée par un salon à ses clients. Objet de TRACE : qui, quand, quel modèle, combien de destinataires, combien de différés par les heures calmes, combien d''exclus. L''ENVOI, lui, est constitué de lignes email_outbox — aucun second système d''envoi (OS-3).';

create index if not exists notification_campaigns_org_recent_idx
  on public.notification_campaigns (organization_id, created_at desc);
create index if not exists notification_campaigns_org_period_idx
  on public.notification_campaigns (organization_id, period_month);

create table if not exists public.notification_campaign_recipients (
  campaign_id uuid not null references public.notification_campaigns (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  outbox_id uuid references public.email_outbox (id) on delete set null,
  to_email text not null,
  deferred boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (campaign_id, customer_id),
  constraint notification_campaign_recipients_email_not_blank check (btrim(to_email) <> '')
);

comment on table public.notification_campaign_recipients is
'Un destinataire réellement sollicité, et la ligne email_outbox correspondante. C''est la SEULE table où une sollicitation marketing est à la fois identifiée comme telle et rattachée à une adresse : c''est donc elle qui porte le plafond de fréquence de MASTER_SPEC §13 (~2 par semaine et par personne, TOUS salons confondus), et elle qui permet de compter les ouvertures et les réservations consécutives.';

-- La cadence de fréquence se lit PAR ADRESSE et sans borne d'organisation :
-- c'est le point.
create index if not exists notification_campaign_recipients_email_idx
  on public.notification_campaign_recipients (lower(to_email), created_at desc);
create index if not exists notification_campaign_recipients_customer_idx
  on public.notification_campaign_recipients (customer_id);
create index if not exists notification_campaign_recipients_outbox_idx
  on public.notification_campaign_recipients (outbox_id)
  where outbox_id is not null;

alter table public.notification_campaigns enable row level security;
alter table public.notification_campaigns force row level security;
alter table public.notification_campaign_recipients enable row level security;
alter table public.notification_campaign_recipients force row level security;

drop policy if exists notification_campaigns_select on public.notification_campaigns;
create policy notification_campaigns_select on public.notification_campaigns
  for select to authenticated
  using (
    (select private.has_org_role(organization_id, array['owner', 'manager']::public.membership_role[]))
    or (select private.is_platform_admin())
  );

drop policy if exists notification_campaign_recipients_select on public.notification_campaign_recipients;
create policy notification_campaign_recipients_select on public.notification_campaign_recipients
  for select to authenticated
  using (
    exists (
      select 1 from public.notification_campaigns c
      where c.id = notification_campaign_recipients.campaign_id
        and ((select private.has_org_role(c.organization_id, array['owner', 'manager']::public.membership_role[]))
             or (select private.is_platform_admin()))
    )
  );

revoke all on table public.notification_campaigns from anon;
revoke all on table public.notification_campaign_recipients from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.notification_campaigns from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on table public.notification_campaign_recipients from authenticated;
grant select on table public.notification_campaigns to authenticated;
grant select on table public.notification_campaign_recipients to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Les heures calmes — programmées, pas sautées
-- ---------------------------------------------------------------------------

create or replace function private.marketing_next_attempt_at(
  p_timezone text,
  p_at timestamptz default now()
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_local_hour integer;
begin
  -- Un fuseau absent ou invalide replie sur Europe/Paris, le marché de
  -- lancement : replier sur UTC enverrait à 2 h du matin en France l'été,
  -- exactement ce que les heures calmes existent pour éviter (B2).
  v_tz := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), 'Europe/Paris');
  begin
    v_local_hour := extract(hour from (p_at at time zone v_tz))::integer;
  exception when others then
    v_tz := 'Europe/Paris';
    v_local_hour := extract(hour from (p_at at time zone v_tz))::integer;
  end;

  -- Fenêtre de B2, re-signée : 08:00–21:00 heure locale. 20 h est la
  -- dernière heure entière permise (21:00 est déjà dehors).
  if v_local_hour between 8 and 20 then
    return p_at;
  elsif v_local_hour >= 21 then
    return (((p_at at time zone v_tz)::date + 1) + time '08:00') at time zone v_tz;
  else
    return ((p_at at time zone v_tz)::date + time '08:00') at time zone v_tz;
  end if;
end;
$$;

comment on function private.marketing_next_attempt_at(text, timestamptz) is
'Le prochain instant où une sollicitation marketing peut partir, dans le fuseau donné : maintenant si l''heure locale est entre 08:00 et 20:59, sinon 08:00 du jour ou du lendemain. Écrit dans email_outbox.next_attempt_at — email_dispatch_batch ne ramasse que ce qui est dû, donc écrire la date EST le report (forme X2, préférée à la forme « sauter le tick » de B2 : une campagne est un geste ponctuel, rien ne repasserait).';

revoke all on function private.marketing_next_attempt_at(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. La validation de l'accroche — bornée, une ligne, aucune URL
-- ---------------------------------------------------------------------------

create or replace function private.assert_campaign_text(p_value text, p_field text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  v := btrim(coalesce(p_value, ''));
  if v = '' then
    raise exception 'champ % requis', p_field
      using errcode = '22023', detail = 'fadeup_campaign_refusal=missing_' || p_field;
  end if;
  if char_length(v) > p_max then
    raise exception 'champ % trop long (% > %)', p_field, char_length(v), p_max
      using errcode = '22023', detail = 'fadeup_campaign_refusal=too_long_' || p_field;
  end if;
  -- Une seule ligne : c'est ce qui distingue une accroche d'un e-mail libre.
  if v ~ '[\n\r\t]' then
    raise exception 'champ % doit tenir sur une ligne', p_field
      using errcode = '22023', detail = 'fadeup_campaign_refusal=multiline_' || p_field;
  end if;
  -- Aucune URL : le seul lien d'une sollicitation est celui du profil du
  -- salon, posé par le gabarit. Laisser passer une URL libre ferait de
  -- FadeUp un relais d'hameçonnage à la réputation d'un domaine partagé.
  if v ~* '(https?://|www\.|[a-z0-9-]+\.(com|fr|net|org|io|co|be|ch)\b)' then
    raise exception 'champ % ne peut pas contenir de lien', p_field
      using errcode = '22023', detail = 'fadeup_campaign_refusal=link_in_' || p_field;
  end if;
  -- Aucun jeton de gabarit : sinon le professionnel pourrait injecter
  -- `{{unsubscribe_url}}` ou casser le rendu.
  if v like '%{{%' or v like '%}}%' then
    raise exception 'champ % ne peut pas contenir de jeton de gabarit', p_field
      using errcode = '22023', detail = 'fadeup_campaign_refusal=template_token_in_' || p_field;
  end if;
  return v;
end;
$$;

revoke all on function private.assert_campaign_text(text, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. La cadence déclarée (M1a) — sans cadence inventée
-- ---------------------------------------------------------------------------

create or replace function private.declared_cadence_days(p_frequency public.customer_haircut_frequency)
returns integer
language sql
immutable
set search_path = ''
as $$
  -- `less_often` et `depends` ne portent AUCUNE cadence : leur prêter 60 ou
  -- 90 jours serait exactement la donnée fabriquée que FadeUp s'interdit.
  -- Ces clients ne reçoivent pas de rappel de fidélité — ils restent
  -- atteignables par les trois autres modèles.
  select case p_frequency
    when 'weekly' then 7
    when 'every_2_weeks' then 14
    when 'every_3_weeks' then 21
    when 'monthly' then 30
    else null
  end;
$$;

revoke all on function private.declared_cadence_days(public.customer_haircut_frequency) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Les créneaux réellement libres demain
-- ---------------------------------------------------------------------------
-- « L'agenda les connaît » — alors on les lui demande. Aucun nombre n'est
-- estimé : c'est le compte des HEURES DISTINCTES réellement proposables
-- demain pour la prestation choisie, tous fauteuils réservables confondus,
-- par la même `get_available_slots` que le tunnel client. Deux barbers libres
-- à 10:00 = UNE heure à proposer, pas deux : c'est ce que le client lit.

create or replace function private.campaign_free_slots_tomorrow(
  p_organization_id uuid,
  p_location_id uuid,
  p_service_id uuid
)
returns table (slot_count integer, local_date date, first_slot timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_date date;
begin
  select l.timezone into v_timezone
  from public.locations l
  where l.id = p_location_id and l.organization_id = p_organization_id and l.is_active;

  if v_timezone is null then
    return;
  end if;

  v_date := (now() at time zone v_timezone)::date + 1;

  return query
  with slots as (
    select distinct s.slot_start
    from public.barbers b
    cross join lateral public.get_available_slots(
      p_organization_id, p_location_id, b.id, p_service_id, v_date, 15
    ) s
    where b.organization_id = p_organization_id
      and b.is_bookable
      and exists (
        select 1 from public.barber_services bs
        where bs.barber_id = b.id and bs.service_id = p_service_id
      )
  )
  select count(*)::integer, v_date, min(slot_start) from slots;
end;
$$;

comment on function private.campaign_free_slots_tomorrow(uuid, uuid, uuid) is
'Le nombre d''HEURES distinctes réellement libres demain (fuseau du lieu) pour une prestation, tous fauteuils réservables confondus, via la get_available_slots du tunnel client. Aucune estimation : si le lieu est fermé ou complet, le compte est 0 et la campagne est refusée avec un motif nommé plutôt que d''annoncer des créneaux qui n''existent pas.';

revoke all on function private.campaign_free_slots_tomorrow(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. L'AUDIENCE — une seule définition, partagée par l'aperçu et l'envoi
-- ---------------------------------------------------------------------------
-- Deux définitions divergentes seraient le pire défaut possible ici : le
-- professionnel verrait « 14 destinataires » et 9 partiraient.

create or replace function private.campaign_audience(
  p_organization_id uuid,
  p_kind public.notification_campaign_kind,
  p_params jsonb
)
returns table (
  customer_id uuid,
  to_email text,
  customer_name text,
  locale text,
  is_verified_client boolean,
  days_since_last integer,
  cadence_days integer,
  cadence_key text,
  blocked_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  with stats as (
    select * from private.customer_visit_stats(p_organization_id)
  ),
  base as (
    select
      c.id as customer_id,
      c.email,
      c.name,
      c.user_id,
      c.do_not_contact,
      s.completed_count,
      s.last_completed_at,
      floor(extract(epoch from (now() - s.last_completed_at)) / 86400.0)::integer as days_since,
      cp.haircut_frequency,
      private.declared_cadence_days(cp.haircut_frequency) as cadence_days,
      exists (
        select 1 from public.customer_professional_relationships r
        where r.organization_id = p_organization_id
          and c.user_id is not null
          and r.customer_user_id = c.user_id
      ) as verified
    from public.customers c
    -- UNE prestation réellement délivrée PAR CE SALON : la barrière
    -- « n'écrire qu'à ses clients ». Une fiche saisie au comptoir sans
    -- aucune prestation n'est pas un client, c'est un contact.
    join stats s on s.customer_id = c.id
    left join public.customer_profiles cp on cp.user_id = c.user_id
    where c.organization_id = p_organization_id
      and s.completed_count >= 1
  ),
  targeted as (
    select *
    from base b
    where case p_kind
      -- Les réguliers qui ne sont pas revenus depuis le seuil choisi par le
      -- professionnel. Trois prestations = la définition d'un régulier chez
      -- OS-2 (en dessous, il n'y a pas d'habitude à constater).
      when 'lapsed_customers' then
        b.completed_count >= 3
        and b.days_since >= greatest(14, least(365, coalesce((p_params ->> 'threshold_days')::integer, 60)))
      -- Prévenir les réguliers d'un créneau libre : deux prestations
      -- suffisent à savoir que la personne revient.
      when 'free_slots_tomorrow' then
        b.completed_count >= 2
      -- Une offre s'adresse à tous les clients du salon.
      when 'promotion' then
        true
      -- La cadence DÉCLARÉE à l'onboarding (M1a), dépassée. Sans cadence
      -- déclarée, pas de rappel : on ne devine pas le rythme de quelqu'un.
      when 'loyalty_reminder' then
        b.cadence_days is not null
        and b.days_since >= b.cadence_days
    end
  )
  select
    t.customer_id,
    lower(btrim(coalesce(t.email, ''))),
    t.name,
    -- Le repli est `fr`, comme celui de private.render_email_template : le
    -- défaut `en` de email_outbox.locale est le sien, pas le nôtre.
    case when p.locale is null or p.locale = 'fr' then 'fr' else 'en' end,
    t.verified,
    t.days_since,
    t.cadence_days,
    t.haircut_frequency::text,
    case
      when coalesce(btrim(t.email), '') = '' then 'no_email'
      when t.do_not_contact then 'do_not_contact'
      -- MASTER_SPEC §13 : ~2 sollicitations marketing par semaine et par
      -- PERSONNE, toutes organisations confondues.
      when (
        select count(*) from public.notification_campaign_recipients nr
        where lower(nr.to_email) = lower(btrim(t.email))
          and nr.created_at >= now() - interval '7 days'
      ) >= 2 then 'frequency_cap'
      else null
    end
  from targeted t
  left join public.profiles p on p.id = t.user_id
  order by t.days_since desc nulls last, t.name;
$$;

comment on function private.campaign_audience(uuid, public.notification_campaign_kind, jsonb) is
'L''audience d''une campagne : LA définition, partagée par preview_notification_campaign et send_notification_campaign — deux définitions divergentes feraient voir « 14 destinataires » et n''en partir que 9.

Chaque ligne porte son `blocked_reason` (no_email, do_not_contact, frequency_cap) plutôt que d''être absente : le professionnel doit pouvoir lire « 14 concernés, 3 sans e-mail, 1 désabonné ». Une ligne à `blocked_reason` non nul ne reçoit JAMAIS d''e-mail.

Borne d''organisation : `public.customers` est par organisation, et une prestation réellement délivrée par CE salon est exigée. Aucun paramètre ne permet de viser une autre organisation.';

revoke all on function private.campaign_audience(uuid, public.notification_campaign_kind, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Le compteur et le plafond, vus par le professionnel
-- ---------------------------------------------------------------------------

create or replace function public.get_campaign_quota(p_organization_id uuid)
returns table (
  period_month date,
  used integer,
  monthly_allowance integer,
  remaining integer,
  plan_key text,
  plan_display_name text,
  next_plan_key text,
  next_plan_display_name text,
  next_plan_price_minor integer,
  next_plan_price_currency text,
  next_plan_allowance integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_plan text;
  v_allowance integer;
  v_used integer;
  v_month date;
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to read the campaign quota of this organization'
      using errcode = '42501',
            detail = 'fadeup_campaign_refusal=not_authorized';
  end if;

  v_plan := private.effective_plan_key(p_organization_id);
  v_allowance := private.campaign_monthly_allowance(p_organization_id);
  v_month := date_trunc('month', now())::date;

  select count(*)::integer into v_used
  from public.notification_campaigns c
  where c.organization_id = p_organization_id and c.period_month = v_month;

  return query
  select
    v_month,
    v_used,
    v_allowance,
    -- NULL = illimité, jamais un grand nombre arbitraire : l'écran doit
    -- pouvoir écrire « illimité », pas « 999 998 restants ».
    case when v_allowance is null then null else greatest(0, v_allowance - v_used) end,
    v_plan,
    cp.display_name,
    up.plan_key,
    up.display_name,
    up.price_minor,
    up.price_currency,
    up.monthly_campaign_allowance
  from public.commercial_plans cp
  left join lateral (
    -- Le plan disponible le MOINS CHER qui apporte strictement plus : c'est
    -- ce que « ce qu'un plan supérieur apporterait » veut dire. Illimité
    -- (NULL) compte comme strictement plus.
    select n.plan_key, n.display_name, n.price_minor, n.price_currency, n.monthly_campaign_allowance
    from public.commercial_plans n
    where n.is_available
      and n.plan_key <> v_plan
      and n.price_minor > cp.price_minor
      and (v_allowance is not null)
      and (n.monthly_campaign_allowance is null or n.monthly_campaign_allowance > v_allowance)
    order by n.price_minor
    limit 1
  ) up on true
  where cp.plan_key = v_plan;
end;
$$;

comment on function public.get_campaign_quota(uuid) is
'Le compteur du mois, le plafond du plan effectif (NULL = illimité), ce qu''il reste, et le plan disponible le moins cher qui apporte strictement plus. Owner et manager. Le plafond vit en base (commercial_plans.monthly_campaign_allowance) : aucun nombre n''est écrit dans le code.';

revoke all on function public.get_campaign_quota(uuid) from public, anon;
grant execute on function public.get_campaign_quota(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. L'aperçu — l'audience, avant d'écrire
-- ---------------------------------------------------------------------------

create or replace function public.preview_notification_campaign(
  p_organization_id uuid,
  p_kind public.notification_campaign_kind,
  p_params jsonb default '{}'::jsonb
)
returns table (
  eligible_count integer,
  reachable_count integer,
  no_email_count integer,
  do_not_contact_count integer,
  frequency_capped_count integer,
  verified_count integer,
  deferred boolean,
  scheduled_at timestamptz,
  slot_count integer,
  slot_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_location uuid;
  v_timezone text;
  -- Des scalaires, pas un `record` : un record non assigné lève
  -- « record is not assigned yet » dès qu'on le lit, et il n'est assigné
  -- que pour UN des quatre modèles.
  v_slot_count integer;
  v_slot_date date;
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to preview campaigns for this organization'
      using errcode = '42501',
            detail = 'fadeup_campaign_refusal=not_authorized';
  end if;
  if p_kind is null then
    raise exception 'campaign kind is required'
      using errcode = '22023', detail = 'fadeup_campaign_refusal=missing_kind';
  end if;

  select l.id, l.timezone into v_location, v_timezone
  from public.locations l
  where l.organization_id = p_organization_id and l.is_active
  order by l.created_at
  limit 1;

  if p_kind = 'free_slots_tomorrow' and (p_params ->> 'service_id') is not null then
    select f.slot_count, f.local_date into v_slot_count, v_slot_date
    from private.campaign_free_slots_tomorrow(
      p_organization_id,
      coalesce((p_params ->> 'location_id')::uuid, v_location),
      (p_params ->> 'service_id')::uuid
    ) f;
  end if;

  return query
  with rows as (
    select * from private.campaign_audience(p_organization_id, p_kind, p_params)
  )
  select
    (select count(*) from rows)::integer,
    (select count(*) from rows where blocked_reason is null)::integer,
    (select count(*) from rows where blocked_reason = 'no_email')::integer,
    (select count(*) from rows where blocked_reason = 'do_not_contact')::integer,
    (select count(*) from rows where blocked_reason = 'frequency_cap')::integer,
    (select count(*) from rows where blocked_reason is null and is_verified_client)::integer,
    private.marketing_next_attempt_at(v_timezone) > now() + interval '1 minute',
    private.marketing_next_attempt_at(v_timezone),
    v_slot_count,
    v_slot_date;
end;
$$;

comment on function public.preview_notification_campaign(uuid, public.notification_campaign_kind, jsonb) is
'Ce que l''envoi ferait : combien de clients sont concernés, combien sont réellement joignables, et pourquoi les autres ne le sont pas (sans e-mail, désabonnés, déjà sollicités deux fois cette semaine). Dit aussi si les heures calmes vont différer l''envoi, et à quand. Lit la MÊME private.campaign_audience que l''envoi.';

revoke all on function public.preview_notification_campaign(uuid, public.notification_campaign_kind, jsonb) from public, anon;
grant execute on function public.preview_notification_campaign(uuid, public.notification_campaign_kind, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. L'ENVOI
-- ---------------------------------------------------------------------------

create or replace function public.send_notification_campaign(
  p_organization_id uuid,
  p_kind public.notification_campaign_kind,
  p_headline text,
  p_params jsonb default '{}'::jsonb
)
returns table (
  campaign_id uuid,
  recipient_count integer,
  deferred_count integer,
  suppressed_count integer,
  scheduled_at timestamptz,
  used integer,
  monthly_allowance integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowance integer;
  v_used integer;
  v_month date;
  v_headline text;
  v_offer text;
  v_org record;
  v_location uuid;
  v_timezone text;
  v_next timestamptz;
  v_campaign uuid;
  v_row record;
  v_outbox uuid;
  v_sent integer := 0;
  v_suppressed integer := 0;
  v_deferred boolean;
  v_slots record;
  v_from date;
  v_until date;
  v_profile_url text;
  v_payload jsonb;
  v_token text;
begin
  -- 1. Le droit. Owner et manager ; un barber, un réceptionniste et un
  --    étranger reçoivent le même refus. L'argument nul est traité AVANT la
  --    garde (motif X3) : `has_org_role(null, …)` rend faux, mais compter
  --    sur ce repli serait exactement le raisonnement que X3 interdit.
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'only an owner or a manager may send campaigns'
      using errcode = '42501',
            detail = 'fadeup_campaign_refusal=not_authorized';
  end if;

  select o.id, o.name, o.slug into v_org
  from public.organizations o where o.id = p_organization_id;
  if v_org.id is null then
    raise exception 'unknown organization'
      using errcode = '42501', detail = 'fadeup_campaign_refusal=not_authorized';
  end if;

  if p_kind is null then
    raise exception 'campaign kind is required'
      using errcode = '22023', detail = 'fadeup_campaign_refusal=missing_kind';
  end if;

  -- 2. Les champs du modèle, bornés.
  v_headline := private.assert_campaign_text(p_headline, 'headline', 160);

  if p_kind = 'promotion' then
    v_offer := private.assert_campaign_text(p_params ->> 'offer', 'offer', 80);
    v_from := coalesce((p_params ->> 'valid_from')::date, (now())::date);
    v_until := (p_params ->> 'valid_until')::date;
    if v_until is null then
      raise exception 'valid_until is required for a promotion'
        using errcode = '22023', detail = 'fadeup_campaign_refusal=missing_valid_until';
    end if;
    if v_until < v_from or v_until < (now())::date or v_until > (now())::date + 180 then
      raise exception 'invalid promotion period'
        using errcode = '22023', detail = 'fadeup_campaign_refusal=invalid_period';
    end if;
  end if;

  -- 3. LE PLAFOND, côté serveur. L'interface l'annonce ; la base le refuse.
  v_month := date_trunc('month', now())::date;
  v_allowance := private.campaign_monthly_allowance(p_organization_id);
  select count(*)::integer into v_used
  from public.notification_campaigns c
  where c.organization_id = p_organization_id and c.period_month = v_month;

  if v_allowance is not null and v_used >= v_allowance then
    raise exception 'monthly campaign allowance reached (% of %)', v_used, v_allowance
      using errcode = 'P0001',
            detail = 'fadeup_campaign_refusal=allowance_reached',
            hint = 'Le plafond du plan est atteint pour ce mois calendaire. Il se remet à zéro le 1er ; un plan supérieur en ouvre davantage.';
  end if;

  -- 4. Le lieu et son fuseau — les heures calmes sont locales.
  select l.id, l.timezone into v_location, v_timezone
  from public.locations l
  where l.organization_id = p_organization_id and l.is_active
  order by l.created_at
  limit 1;

  v_next := private.marketing_next_attempt_at(v_timezone);
  v_deferred := v_next > now() + interval '1 minute';

  -- 5. Les créneaux de demain, s'il s'agit de ce modèle : aucun nombre
  --    annoncé qui n'existe pas.
  if p_kind = 'free_slots_tomorrow' then
    if (p_params ->> 'service_id') is null then
      raise exception 'service_id is required for the free-slots template'
        using errcode = '22023', detail = 'fadeup_campaign_refusal=missing_service';
    end if;
    if not exists (
      select 1 from public.services s
      where s.id = (p_params ->> 'service_id')::uuid
        and s.organization_id = p_organization_id
        and s.is_active
    ) then
      raise exception 'unknown service for this organization'
        using errcode = '22023', detail = 'fadeup_campaign_refusal=unknown_service';
    end if;

    select * into v_slots
    from private.campaign_free_slots_tomorrow(
      p_organization_id,
      coalesce((p_params ->> 'location_id')::uuid, v_location),
      (p_params ->> 'service_id')::uuid
    );

    if v_slots.slot_count is null or v_slots.slot_count = 0 then
      raise exception 'no free slot tomorrow'
        using errcode = 'P0001',
              detail = 'fadeup_campaign_refusal=no_free_slot',
              hint = 'Demain est fermé ou complet : ce modèle annoncerait des créneaux qui n''existent pas.';
    end if;
  end if;

  v_profile_url := 'https://fade-up.com/shop/' || v_org.slug;

  -- 6. La campagne, puis ses destinataires.
  insert into public.notification_campaigns
    (organization_id, kind, headline, params, period_month, scheduled_at, created_by)
  values
    (p_organization_id, p_kind, v_headline, coalesce(p_params, '{}'::jsonb), v_month, v_next, (select auth.uid()))
  returning id into v_campaign;

  for v_row in
    select * from private.campaign_audience(p_organization_id, p_kind, coalesce(p_params, '{}'::jsonb))
  loop
    if v_row.blocked_reason is not null then
      v_suppressed := v_suppressed + 1;
      continue;
    end if;

    -- Le jeton de désabonnement est posé à la PREMIÈRE sollicitation : les
    -- fiches antérieures à OS-3 n'en avaient pas.
    update public.customers
      set marketing_unsubscribe_token = coalesce(marketing_unsubscribe_token, encode(extensions.gen_random_bytes(16), 'hex'))
      where id = v_row.customer_id
      returning marketing_unsubscribe_token into v_token;

    v_payload := jsonb_build_object(
      'customer_name', coalesce(nullif(btrim(v_row.customer_name), ''), 'client'),
      'organization_name', v_org.name,
      'headline', v_headline,
      'profile_url', v_profile_url,
      -- La fonction Edge : GET humain → page de confirmation, POST machine →
      -- désabonnement immédiat (RFC 8058). Même forme que X2.
      'unsubscribe_url', 'https://fade-up.com/functions/v1/unsubscribe-customer/' || v_token
    );

    if p_kind = 'free_slots_tomorrow' then
      v_payload := v_payload || jsonb_build_object(
        'slot_count', v_slots.slot_count::text,
        'date_fr', to_char(v_slots.local_date, 'DD/MM/YYYY'),
        'date_en', to_char(v_slots.local_date, 'YYYY-MM-DD')
      );
    elsif p_kind = 'promotion' then
      v_payload := v_payload || jsonb_build_object(
        'offer', v_offer,
        'period_fr', 'du ' || to_char(v_from, 'DD/MM/YYYY') || ' au ' || to_char(v_until, 'DD/MM/YYYY'),
        'period_en', 'from ' || to_char(v_from, 'YYYY-MM-DD') || ' to ' || to_char(v_until, 'YYYY-MM-DD')
      );
    elsif p_kind = 'loyalty_reminder' then
      v_payload := v_payload || jsonb_build_object(
        'cadence_fr', case v_row.cadence_key
          when 'weekly' then 'chaque semaine'
          when 'every_2_weeks' then 'toutes les deux semaines'
          when 'every_3_weeks' then 'toutes les trois semaines'
          else 'chaque mois' end,
        'cadence_en', case v_row.cadence_key
          when 'weekly' then 'every week'
          when 'every_2_weeks' then 'every two weeks'
          when 'every_3_weeks' then 'every three weeks'
          else 'every month' end,
        'days_since', coalesce(v_row.days_since_last, 0)::text
      );
    end if;

    v_outbox := null;
    insert into public.email_outbox
      (to_email, template, locale, payload, stream, dedupe_key, next_attempt_at)
    values (
      v_row.to_email,
      'campaign_' || p_kind::text,
      v_row.locale,
      v_payload,
      'marketing',
      'campaign:' || v_campaign::text || ':' || v_row.customer_id::text,
      v_next
    )
    -- Prédicat requis : l'index unique sur dedupe_key est PARTIEL.
    on conflict (dedupe_key) where dedupe_key is not null do nothing
    returning id into v_outbox;

    -- `on conflict` SANS liste de colonnes : `campaign_id` est aussi un
    -- paramètre de sortie de cette fonction, et une liste de colonnes le
    -- rendrait ambigu (« could refer to either a PL/pgSQL variable or a
    -- table column »). La table n'a qu'une seule contrainte unique — sa
    -- clé primaire — donc la cible est sans équivoque.
    insert into public.notification_campaign_recipients
      (campaign_id, customer_id, outbox_id, to_email, deferred)
    values (v_campaign, v_row.customer_id, v_outbox, v_row.to_email, v_deferred)
    on conflict do nothing;

    v_sent := v_sent + 1;
  end loop;

  -- 7. Une campagne sans destinataire n'est pas une campagne : elle ne
  --    consomme pas le plafond et ne laisse pas de trace fantôme.
  if v_sent = 0 then
    delete from public.notification_campaigns where id = v_campaign;
    raise exception 'no reachable recipient'
      using errcode = 'P0001',
            detail = 'fadeup_campaign_refusal=no_recipient',
            hint = 'Personne ne correspond à ce modèle avec une adresse joignable : le plafond n''a pas été consommé.';
  end if;

  update public.notification_campaigns
    set recipient_count = v_sent,
        deferred_count = case when v_deferred then v_sent else 0 end,
        suppressed_count = v_suppressed
    where id = v_campaign;

  return query select v_campaign, v_sent, case when v_deferred then v_sent else 0 end,
                      v_suppressed, v_next, v_used + 1, v_allowance;
end;
$$;

comment on function public.send_notification_campaign(uuid, public.notification_campaign_kind, text, jsonb) is
'Envoie une sollicitation par modèle. Owner et manager UNIQUEMENT.

Refus nommés (detail = fadeup_campaign_refusal=…) : not_authorized, missing_/too_long_/multiline_/link_in_/template_token_in_<champ>, allowance_reached, missing_service, unknown_service, no_free_slot, invalid_period, no_recipient.

Ce qu''elle garantit : le plafond du plan effectif est vérifié EN BASE ; l''audience est bornée aux clients de CETTE organisation ayant reçu au moins une prestation ; do_not_contact et le plafond de fréquence (~2/semaine/personne, tous salons) excluent sans échouer ; les heures calmes du lieu programment next_attempt_at au lieu d''annuler ; l''envoi est constitué de lignes email_outbox et de rien d''autre.

Une campagne sans destinataire joignable est ANNULÉE et ne consomme pas le plafond.';

revoke all on function public.send_notification_campaign(uuid, public.notification_campaign_kind, text, jsonb) from public, anon;
grant execute on function public.send_notification_campaign(uuid, public.notification_campaign_kind, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. L'historique et ce que ça a donné
-- ---------------------------------------------------------------------------

create or replace function public.list_notification_campaigns(
  p_organization_id uuid,
  p_limit integer default 20
)
returns table (
  campaign_id uuid,
  kind public.notification_campaign_kind,
  headline text,
  created_at timestamptz,
  scheduled_at timestamptz,
  recipient_count integer,
  deferred_count integer,
  suppressed_count integer,
  sent_count integer,
  delivered_count integer,
  opened_count integer,
  booked_count integer,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null
     or not (select private.has_org_role(p_organization_id, array['owner', 'manager']::public.membership_role[])) then
    raise exception 'not authorized to read campaigns for this organization'
      using errcode = '42501',
            detail = 'fadeup_campaign_refusal=not_authorized';
  end if;

  return query
  with total as (
    select count(*)::integer as n
    from public.notification_campaigns c
    where c.organization_id = p_organization_id
  ),
  page as (
    select c.*
    from public.notification_campaigns c
    where c.organization_id = p_organization_id
    order by c.created_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  )
  select
    p.id,
    p.kind,
    p.headline,
    p.created_at,
    p.scheduled_at,
    p.recipient_count,
    p.deferred_count,
    p.suppressed_count,
    (select count(*) from public.notification_campaign_recipients r
      join public.email_outbox o on o.id = r.outbox_id
      where r.campaign_id = p.id and o.status = 'sent')::integer,
    (select count(*) from public.notification_campaign_recipients r
      join public.email_outbox o on o.id = r.outbox_id
      where r.campaign_id = p.id and o.delivered_at is not null)::integer,
    (select count(*) from public.notification_campaign_recipients r
      join public.email_outbox o on o.id = r.outbox_id
      where r.campaign_id = p.id and o.opened_at is not null)::integer,
    -- « Combien ont réservé ensuite » : une réservation ou un passage de
    -- file CRÉÉ après l'envoi, par un destinataire, dans les 30 jours. Ce
    -- n'est pas une attribution causale et l'interface ne le prétend pas —
    -- c'est ce qui s'est passé après.
    (select count(distinct r.customer_id)
      from public.notification_campaign_recipients r
      where r.campaign_id = p.id
        and (
          exists (
            select 1 from public.appointments a
            where a.customer_id = r.customer_id
              and a.organization_id = p_organization_id
              and a.created_at > p.created_at
              and a.created_at < p.created_at + interval '30 days'
          )
          or exists (
            select 1 from public.queue_entries q
            where q.customer_id = r.customer_id
              and q.organization_id = p_organization_id
              and q.created_at > p.created_at
              and q.created_at < p.created_at + interval '30 days'
          )
        ))::integer,
    (select n from total)
  from page p
  order by p.created_at desc;
end;
$$;

comment on function public.list_notification_campaigns(uuid, integer) is
'L''historique des sollicitations d''une organisation et leur RÉSULTAT : envoyés, délivrés, ouverts (email_outbox.opened_at, alimenté par le webhook Resend de X2), et combien de destinataires ont réservé dans les 30 jours qui ont suivi. La dernière colonne n''est pas une attribution causale et l''interface ne le prétend pas.';

revoke all on function public.list_notification_campaigns(uuid, integer) from public, anon;
grant execute on function public.list_notification_campaigns(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Le désabonnement — anonyme, définitif, anti-énumération
-- ---------------------------------------------------------------------------

create or replace function public.unsubscribe_customer_marketing(p_token text)
returns table (unsubscribed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  select lower(btrim(coalesce(c.email, ''))) into v_email
  from public.customers c
  where c.marketing_unsubscribe_token = lower(btrim(coalesce(p_token, '')))
  limit 1;

  if v_email is null or v_email = '' then
    -- Jeton inconnu, déjà utilisé ou inventé : la MÊME réponse. Un refus
    -- distinct laisserait énumérer les clients des salons (forme B2).
    return query select true;
    return;
  end if;

  -- Définitif et global : toutes les fiches qui partagent l'adresse, dans
  -- toutes les organisations. Un client qui clique « ne plus recevoir » ne
  -- demande pas « sauf les neuf autres salons ».
  update public.customers
    set do_not_contact = true
    where lower(btrim(coalesce(email, ''))) = v_email
      and not do_not_contact;

  -- Les sollicitations déjà en file pour cette adresse ne partent pas. Le
  -- transactionnel n'est jamais touché : le filtre porte sur le flux.
  update public.email_outbox
    set status = 'failed',
        last_error = 'recipient unsubscribed before dispatch',
        updated_at = now()
    where status = 'queued'
      and stream = 'marketing'
      and lower(to_email) = v_email;

  return query select true;
end;
$$;

comment on function public.unsubscribe_customer_marketing(text) is
'Désabonnement marketing d''un client, par jeton (capacité, 32 hexadécimaux). Anonyme par nécessité : le destinataire d''un e-mail n''a pas de session. Répond TOUJOURS vrai — un jeton inconnu est un non-événement, pas un oracle d''existence.

Définitif et GLOBAL : toutes les fiches partageant l''adresse, dans toutes les organisations, et les sollicitations déjà en file pour cette adresse sont retirées. Ne touche jamais le flux transactionnel.';

revoke all on function public.unsubscribe_customer_marketing(text) from public;
grant execute on function public.unsubscribe_customer_marketing(text) to anon, authenticated, service_role;

commit;
