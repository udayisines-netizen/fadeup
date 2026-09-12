-- FadeUp — M1c-a (2/2) : le push, sur le MÊME motif que `email_outbox`.
--
-- POURQUOI PAS UN SECOND SYSTÈME D'ENVOI
--
-- B2 a construit un expéditeur dans la base : une file durable
-- (`email_outbox`), un rendu par gabarit et par langue (`email_templates` +
-- `private.render_email_template`), deux passes séparées — dépêche puis
-- réconciliation — et l'idempotence portée par un index unique PARTIEL sur
-- `dedupe_key`. Ce motif gère déjà ce que le push exige : ne pas envoyer deux
-- fois, survivre à un redémarrage au milieu d'un lot, tenir les heures calmes,
-- garder une trace de ce qui est parti et de ce que le fournisseur a répondu.
--
-- Ce fichier le RÉPLIQUE pour un second transport. Rien d'autre ne change :
--
--   email_outbox      -> push_outbox          (une ligne = un envoi à UN appareil)
--   email_templates   -> push_templates       (titre + corps, par gabarit et par langue)
--   email_streams     -> (rien)               un seul transport : Expo
--   run_email_delivery -> run_push_maintenance (appelée par fadeup-scheduler)
--
-- Les différences sont celles du canal, pas de l'architecture :
--
--   - un destinataire a PLUSIEURS appareils : `push_devices` s'interpose, et
--     une ligne d'outbox vise un appareil, pas une personne ;
--   - un jeton meurt (application désinstallée, appareil réinitialisé). Le
--     fournisseur le dit, et la réconciliation RETIRE le jeton ;
--   - Expo répond en deux temps : un « ticket » immédiat (le message est chez
--     Expo), puis un « reçu » (ce qu'APNs en a fait). Les deux sont relus.
--
-- CE QUI RESTE VRAI DE MASTER_SPEC §13
--
--   - transactionnel immédiat : l'appel de file et la réponse à une demande
--     partent à toute heure ;
--   - heures calmes 08:00–21:00 pour le NON urgent, exactement la fenêtre que
--     B2 applique à la prospection (`enqueue_prospect_outreach`) — une
--     seconde politique d'heures calmes serait une divergence, pas un choix ;
--   - préférences par catégorie ;
--   - aucune messagerie, aucun SMS.
--
-- CE QUE CE FICHIER N'INVENTE PAS
--
-- Le fuseau du destinataire. `profiles` ne porte pas de pays et il n'existe
-- aucun contrat de fuseau côté client. Les heures calmes sont donc évaluées
-- dans le fuseau du LIEU concerné (`locations.timezone`, renseigné sur les
-- 152 lieux de production), à défaut Europe/Paris — le marché de lancement,
-- comme `private.prospect_timezone`. C'est une approximation DÉCLARÉE : un
-- client français en voyage au Japon recevra un post à une heure locale
-- inattendue. Un repli sur UTC serait pire, et inventer un fuseau client
-- serait une donnée fabriquée.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Les types
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'push_platform') then
    create type public.push_platform as enum ('ios', 'android');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'push_delivery_status') then
    -- Les mêmes quatre états que `email_delivery_status`, et pour la même
    -- raison : `sending` est « parti, réponse attendue » — sans lui, une ligne
    -- appelée mais non confirmée serait soit renvoyée (donc en double), soit
    -- déclarée réussie sans preuve.
    create type public.push_delivery_status as enum ('queued', 'sending', 'sent', 'failed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'push_category') then
    -- Les quatre catégories du lot, tranchées par le fondateur en M1a. Une
    -- catégorie = un interrupteur dans le compte, et une politique d'heures
    -- calmes : seul `queue_call` est urgent.
    create type public.push_category as enum (
      'queue_call',
      'booking_response',
      'appointment_reminder',
      'social_post'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Les appareils
--
-- Un compte peut avoir plusieurs appareils : la clé naturelle est le JETON,
-- pas l'utilisateur. Un jeton ne désigne qu'un appareil et un seul, donc
-- `unique (token)` — et un appareil qui change de main (nouvelle session)
-- change de propriétaire par UPDATE, jamais par seconde ligne.
--
-- POURQUOI user_id EST NULLABLE
--
-- Rejoindre une file ne demande PAS de compte (F1 : consulter est libre,
-- rejoindre exige le QR et la position, pas une session). L'événement le plus
-- important du lot — « c'est ton tour » — concerne donc des clients anonymes.
-- Un appareil peut s'enregistrer contre l'entrée de file qu'il suit.
--
-- Ce n'est pas une porte nouvelle : dans le contrat F1 existant,
-- `get_queue_entry_tracking(entry_id)` répond EN ANONYME à qui détient
-- l'identifiant d'entrée — position, échéance d'appel, nom du barber. Détenir
-- l'identifiant EST la preuve de possession de la place. Accepter ce même
-- identifiant ici n'expose donc aucune information d'une classe nouvelle.
-- ---------------------------------------------------------------------------

create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  platform public.push_platform not null,
  user_id uuid references auth.users (id) on delete cascade,
  queue_entry_id uuid references public.queue_entries (id) on delete set null,
  -- La langue LUE sur cet appareil : le rendu du push s'y fait. Deux
  -- appareils du même compte peuvent être dans deux langues.
  locale text not null default 'fr',
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un jeton Expo, et rien d'autre : ce fichier n'envoie que par Expo, et un
  -- jeton APNs brut envoyé là finirait en erreur silencieuse côté fournisseur.
  constraint push_devices_token_shape check (token ~ '^Expo(nent)?PushToken\[[^]]+\]$'),
  constraint push_devices_locale_valid check (locale in ('fr', 'en')),
  -- Un appareil sans sujet n'est joignable pour rien : ni compte, ni place.
  constraint push_devices_subject_present check (user_id is not null or queue_entry_id is not null)
);

comment on table public.push_devices is
  'Un appareil joignable par push, identifié par son jeton Expo. Rattaché à un compte (plusieurs appareils par compte) et/ou à une entrée de file pour le cas ANONYME — rejoindre une file n''exige pas de session, et « c''est ton tour » est l''événement le plus important du lot. Un jeton devenu invalide est RÉVOQUÉ ici par la réconciliation (revoked_at + revoked_reason), jamais supprimé : la trace de ce qui a été envoyé doit rester lisible.';

comment on column public.push_devices.queue_entry_id is
  'La place suivie par cet appareil quand il n''y a pas de compte. Détenir un identifiant d''entrée est déjà, dans le contrat F1, la preuve de possession de la place (get_queue_entry_tracking répond en anonyme) : accepter le même identifiant ici n''ouvre aucune information nouvelle.';

create index if not exists push_devices_user_active_idx
  on public.push_devices (user_id) where revoked_at is null and user_id is not null;
create index if not exists push_devices_queue_entry_active_idx
  on public.push_devices (queue_entry_id) where revoked_at is null and queue_entry_id is not null;

drop trigger if exists push_devices_set_updated_at on public.push_devices;
create trigger push_devices_set_updated_at
  before update on public.push_devices
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Les préférences, par catégorie
--
-- MASTER_SPEC §13 : « Préférences par catégorie et canal, sauf transactionnel
-- et sécurité. » Le canal PUSH est ici le seul concerné, et c'est ce qui rend
-- l'interrupteur légitime même sur du transactionnel : couper l'appel de file
-- en push ne retire NI la ligne in-app, NI l'e-mail — l'information reste
-- délivrée, c'est l'écran verrouillé qui se tait. iOS ne propose au client
-- qu'un tout-ou-rien ; une préférence par catégorie est strictement mieux.
--
-- Défauts : les trois catégories attendues par qui les déclenche arrivent
-- actives ; l'activité sociale s'opte (reprise des défauts locaux de M1b).
-- ---------------------------------------------------------------------------

create table if not exists public.notification_push_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  queue_call boolean not null default true,
  booking_response boolean not null default true,
  appointment_reminder boolean not null default true,
  social_post boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notification_push_preferences is
  'Un interrupteur de push par catégorie et par compte. L''absence de ligne VAUT les défauts (true sauf social_post) : aucun backfill n''est nécessaire, et un compte créé après ce fichier se comporte comme un compte créé avant. Ne gouverne QUE le push : la ligne in-app et l''e-mail transactionnel partent quoi qu''il arrive.';

drop trigger if exists notification_push_preferences_set_updated_at on public.notification_push_preferences;
create trigger notification_push_preferences_set_updated_at
  before update on public.notification_push_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Les gabarits — en table, comme les e-mails
--
-- Même argument qu'en B2 : ce sont des DONNÉES. Elles se relisent, se
-- corrigent sans redéploiement, se traduisent par insertion, et la suite de
-- vérification peut les parcourir toutes. Aucun texte destiné au client ne
-- vit en dur dans une fonction (exigence de globalisation, CLAUDE.md).
-- ---------------------------------------------------------------------------

create table if not exists public.push_templates (
  template_key text not null,
  locale text not null,
  category public.push_category not null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (template_key, locale),
  constraint push_templates_locale_valid check (locale in ('fr', 'en')),
  constraint push_templates_title_not_blank check (btrim(title) <> ''),
  constraint push_templates_body_not_blank check (btrim(body) <> ''),
  -- Une notification iOS tronque bien avant, mais un titre à rallonge est un
  -- bug de rédaction : la contrainte le dit à l'insertion.
  constraint push_templates_title_bounded check (length(title) <= 80),
  constraint push_templates_body_bounded check (length(body) <= 200)
);

comment on table public.push_templates is
  'Titre et corps de notification par gabarit et par langue. FR et EN, les deux seules langues product-ready (MASTER_SPEC §1), comme email_templates. Les substitutions sont des {{jetons}} remplacés par private.render_push_template à partir du payload de la ligne d''outbox.';

drop trigger if exists push_templates_set_updated_at on public.push_templates;
create trigger push_templates_set_updated_at
  before update on public.push_templates
  for each row execute function public.set_updated_at();

insert into public.push_templates (template_key, locale, category, title, body) values
  -- « C'est ton tour » : le client est DANS le salon, debout. Le titre porte
  -- l'information à lui seul, parce que c'est tout ce qu'un écran verrouillé
  -- montre avec certitude.
  ('queue_called', 'fr', 'queue_call', 'C''est votre tour', '{{organization_name}} vous appelle. Présentez-vous à l''accueil.'),
  ('queue_called', 'en', 'queue_call', 'It''s your turn', '{{organization_name}} is calling you. Head to the front desk.'),

  ('booking_confirmed', 'fr', 'booking_response', 'Rendez-vous confirmé', '{{organization_name}} a accepté votre demande pour le {{starts_at_fr}}.'),
  ('booking_confirmed', 'en', 'booking_response', 'Appointment confirmed', '{{organization_name}} accepted your request for {{starts_at_en}}.'),

  -- Jamais culpabilisant, et jamais une explication inventée : le salon n'a
  -- pas pris cette demande, point. La raison éventuelle vit dans l'app.
  ('booking_declined', 'fr', 'booking_response', 'Demande non retenue', '{{organization_name}} n''a pas pu prendre votre demande du {{starts_at_fr}}.'),
  ('booking_declined', 'en', 'booking_response', 'Request not accepted', '{{organization_name}} could not take your request for {{starts_at_en}}.'),

  ('booking_reminder', 'fr', 'appointment_reminder', 'Rendez-vous bientôt', '{{service_name}} chez {{organization_name}} à {{time_fr}}.'),
  ('booking_reminder', 'en', 'appointment_reminder', 'Appointment soon', '{{service_name}} at {{organization_name}} at {{time_en}}.'),

  ('post_published', 'fr', 'social_post', 'Nouveau post', '{{author_name}} vient de publier.'),
  ('post_published', 'en', 'social_post', 'New post', '{{author_name}} just posted.')
on conflict (template_key, locale) do nothing;

-- ---------------------------------------------------------------------------
-- 5. La file d'envoi
--
-- Une ligne = un message à UN appareil. C'est ce qui rend l'idempotence
-- exacte : la clé de dédoublonnage porte l'événement ET l'appareil, donc
-- deux appareils du même compte reçoivent deux fois, et le même appareil
-- jamais deux fois le même événement.
-- ---------------------------------------------------------------------------

create table if not exists public.push_outbox (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.push_devices (id) on delete cascade,
  -- Dénormalisé à dessein : la trace doit rester lisible après révocation du
  -- jeton ou suppression du compte (RGPD B5 : la ligne perd son sujet, pas
  -- son existence).
  user_id uuid references auth.users (id) on delete set null,
  category public.push_category not null,
  type public.notification_type not null,
  template_key text not null,
  locale text not null,
  title text not null,
  body text not null,
  -- Ce que l'application reçoit avec la notification : de quoi router vers le
  -- bon écran (une entrée de file, un rendez-vous, un post). Jamais de donnée
  -- opérationnelle : l'app relit la base en s'ouvrant.
  data jsonb not null default '{}'::jsonb,
  -- Urgent = passe outre les heures calmes. Seul l'appel de file l'est.
  urgent boolean not null default false,
  status public.push_delivery_status not null default 'queued',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  dedupe_key text,
  net_request_id bigint,
  provider_ticket_id text,
  receipt_requested_at timestamptz,
  last_error text,
  dispatched_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_outbox_attempts_sane check (attempts >= 0),
  constraint push_outbox_locale_valid check (locale in ('fr', 'en')),
  constraint push_outbox_title_not_blank check (btrim(title) <> '')
);

comment on table public.push_outbox is
  'LA file d''envoi du push, et LA trace : quoi (category, type, template_key, title, body), à qui (device_id, user_id), quand (created_at, dispatched_at, sent_at), avec quel résultat (status, provider_ticket_id, last_error). Même machine d''états que email_outbox, deux passes séparées (dépêche puis réconciliation) — ce qui rend un redémarrage du scheduler incapable de doubler un envoi.';

comment on column public.push_outbox.dedupe_key is
  'Clé d''idempotence, portant l''événement ET l''appareil. Index unique PARTIEL : le prédicat `where dedupe_key is not null` DOIT être répété dans tout ON CONFLICT, sinon Postgres refuse d''inférer l''index.';

create unique index if not exists push_outbox_dedupe_key_unique
  on public.push_outbox (dedupe_key) where dedupe_key is not null;
create index if not exists push_outbox_dispatchable_idx
  on public.push_outbox (next_attempt_at) where status = 'queued';
create index if not exists push_outbox_reconcilable_idx
  on public.push_outbox (net_request_id) where net_request_id is not null;
create index if not exists push_outbox_receiptable_idx
  on public.push_outbox (sent_at) where provider_ticket_id is not null and receipt_requested_at is null;
create index if not exists push_outbox_user_recent_idx
  on public.push_outbox (user_id, created_at desc) where user_id is not null;

-- Les demandes de reçus : une requête pg_net porte JUSQU'À CENT tickets, donc
-- elle ne peut pas être suivie sur une ligne d'outbox. Cette table est le
-- pendant, côté reçus, de push_outbox.net_request_id.
create table if not exists public.push_receipt_requests (
  id uuid primary key default gen_random_uuid(),
  net_request_id bigint not null,
  ticket_ids text[] not null,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_error text,
  constraint push_receipt_requests_tickets_present check (cardinality(ticket_ids) > 0)
);

comment on table public.push_receipt_requests is
  'Une requête de reçus Expo en vol. Expo répond en deux temps : un ticket dit que le message est ARRIVÉ CHEZ EXPO, un reçu dit ce qu''APNs en a fait — et c''est là que « DeviceNotRegistered » apparaît le plus souvent. Sans cette passe, un jeton mort resterait en base indéfiniment.';

create index if not exists push_receipt_requests_pending_idx
  on public.push_receipt_requests (net_request_id) where resolved_at is null;

create table if not exists public.push_post_fanout (
  post_id uuid primary key references public.posts (id) on delete cascade,
  devices_queued integer not null default 0,
  completed_at timestamptz not null default now()
);

comment on table public.push_post_fanout is
  'Marque un post comme déjà diffusé aux abonnés. Sans ce registre, chaque tick relirait tous les abonnés de chaque post récent — l''idempotence par dedupe_key suffirait à la CORRECTION, pas au coût. Une ligne ici = ce post ne sera plus jamais rediffusé.';

-- ---------------------------------------------------------------------------
-- 6. RLS — aucune de ces tables n'est lisible par un client
--
-- Exactement le régime d'`email_outbox` : RLS forcée, une seule policy de
-- lecture pour l'administration de plateforme, et les verbes clients
-- révoqués. Tous les accès clients passent par les RPC de la section 11.
-- ---------------------------------------------------------------------------

do $$
declare v_table text;
begin
  foreach v_table in array array['push_devices', 'notification_push_preferences', 'push_templates',
                                 'push_outbox', 'push_receipt_requests', 'push_post_fanout']
  loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('drop policy if exists %I on public.%I', v_table || '_select_platform', v_table);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_admin()))',
      v_table || '_select_platform', v_table);
    -- X3 : une table neuve naît encore avec SELECT/INSERT/UPDATE/DELETE pour
    -- anon et authenticated. On les retire, puis on rend le seul SELECT que
    -- la policy ci-dessus gouverne.
    execute format('revoke all on table public.%I from anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------------------
-- 7. Le rendu, les heures calmes, les préférences
-- ---------------------------------------------------------------------------

begin;

create or replace function private.push_next_window(p_tz text)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_local timestamp;
  v_hour integer;
  v_date date;
begin
  -- Un fuseau illisible ne doit pas faire échouer un envoi : repli sur le
  -- marché de lancement, comme private.prospect_timezone.
  v_tz := coalesce(nullif(btrim(coalesce(p_tz, '')), ''), 'Europe/Paris');
  begin
    v_local := now() at time zone v_tz;
  exception when others then
    v_tz := 'Europe/Paris';
    v_local := now() at time zone v_tz;
  end;

  v_hour := extract(hour from v_local)::integer;
  -- 08:00–21:00, la fenêtre EXACTE que B2 applique à la prospection. Deux
  -- fenêtres différentes dans le même produit seraient une divergence.
  if v_hour >= 8 and v_hour < 21 then
    return now();
  end if;

  v_date := case when v_hour >= 21 then (v_local::date + 1) else v_local::date end;
  return (v_date + time '08:00') at time zone v_tz;
end;
$$;

comment on function private.push_next_window(text) is
  'Quand un message NON urgent peut partir : maintenant si l''heure locale du destinataire est dans 08:00–21:00, sinon la prochaine ouverture de fenêtre. Le message n''est jamais annulé par les heures calmes — il est DIFFÉRÉ, parce qu''un nouveau post reste intéressant à 8 h du matin.';

revoke all on function private.push_next_window(text) from public, anon, authenticated;

create or replace function private.push_category_enabled(
  p_user_id uuid,
  p_category public.push_category
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_category
    when 'queue_call' then coalesce(p.queue_call, true)
    when 'booking_response' then coalesce(p.booking_response, true)
    when 'appointment_reminder' then coalesce(p.appointment_reminder, true)
    when 'social_post' then coalesce(p.social_post, false)
  end
  from (select p_user_id as uid) q
  left join public.notification_push_preferences p on p.user_id = q.uid;
$$;

comment on function private.push_category_enabled(uuid, public.push_category) is
  'La préférence du compte pour une catégorie, ou son défaut si aucune ligne n''existe. L''absence de ligne est le cas NORMAL : rien n''est backfillé, et un LEFT JOIN sur une sous-requête d''une ligne garantit une réponse même pour un compte inconnu.';

revoke all on function private.push_category_enabled(uuid, public.push_category) from public, anon, authenticated;

create or replace function private.render_push_template(
  p_template_key text,
  p_locale text,
  p_payload jsonb
)
returns table (title text, body text, category public.push_category)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tpl public.push_templates;
  v_locale text;
  v_title text;
  v_body text;
  v_key text;
  v_value text;
begin
  v_locale := case when lower(coalesce(p_locale, 'fr')) = 'en' then 'en' else 'fr' end;

  select * into v_tpl from public.push_templates t
  where t.template_key = p_template_key and t.locale = v_locale;

  if not found then
    -- Repli sur le français, langue du marché de lancement — même choix que
    -- private.render_email_template, et le trou de traduction se voit.
    select * into v_tpl from public.push_templates t
    where t.template_key = p_template_key and t.locale = 'fr';
  end if;

  if not found then
    raise exception 'no push template for key %', p_template_key using errcode = '42704';
  end if;

  v_title := v_tpl.title;
  v_body := v_tpl.body;

  for v_key, v_value in
    select k, coalesce(p_payload ->> k, '') from jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) k
  loop
    v_title := replace(v_title, '{{' || v_key || '}}', v_value);
    v_body := replace(v_body, '{{' || v_key || '}}', v_value);
  end loop;

  -- Un jeton non résolu est un bug de gabarit, et l'envoyer serait pire que
  -- ne rien envoyer : le client lirait « {{organization_name}} vous appelle ».
  if v_title ~ '\{\{[a-z_]+\}\}' or v_body ~ '\{\{[a-z_]+\}\}' then
    raise exception 'push template % has unresolved placeholders', p_template_key
      using errcode = '22023', detail = 'fadeup_push_error=unresolved_placeholder';
  end if;

  return query select v_title, v_body, v_tpl.category;
end;
$$;

revoke all on function private.render_push_template(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. La mise en file
--
-- LE seul chemin d'écriture dans push_outbox. Tous les émetteurs passent par
-- ici, ce qui fait des préférences et des heures calmes des propriétés de la
-- base, pas des conventions que chaque appelant doit se rappeler.
-- ---------------------------------------------------------------------------

create or replace function private.enqueue_push(
  p_template_key text,
  p_type public.notification_type,
  p_payload jsonb,
  p_data jsonb,
  p_dedupe_prefix text,
  p_user_id uuid default null,
  p_queue_entry_id uuid default null,
  p_urgent boolean default false,
  p_tz text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.push_devices;
  v_rendered record;
  v_category public.push_category;
  v_when timestamptz;
  v_count integer := 0;
begin
  if p_dedupe_prefix is null or btrim(p_dedupe_prefix) = '' then
    raise exception 'enqueue_push requires a dedupe prefix' using errcode = '22023';
  end if;

  -- La catégorie vient du GABARIT, pas de l'appelant : un émetteur ne peut
  -- pas ranger un post dans « appel de file » pour contourner les heures
  -- calmes ou une préférence.
  select t.category into v_category from public.push_templates t
  where t.template_key = p_template_key limit 1;
  if v_category is null then
    raise exception 'no push template for key %', p_template_key using errcode = '42704';
  end if;

  if p_user_id is not null then
    if not private.push_category_enabled(p_user_id, v_category) then
      return 0;
    end if;
  elsif v_category <> 'queue_call' then
    -- Sans compte, la seule notification légitime est l'appel de la file que
    -- l'appareil suit. Tout le reste exige un destinataire identifié.
    return 0;
  end if;

  v_when := case when p_urgent then now() else private.push_next_window(p_tz) end;

  for v_device in
    select * from public.push_devices d
    where d.revoked_at is null
      and (
        (p_user_id is not null and d.user_id = p_user_id)
        or (p_queue_entry_id is not null and d.queue_entry_id = p_queue_entry_id)
      )
  loop
    select * into v_rendered from private.render_push_template(p_template_key, v_device.locale, p_payload);

    insert into public.push_outbox (
      device_id, user_id, category, type, template_key, locale,
      title, body, data, urgent, next_attempt_at, dedupe_key
    )
    values (
      v_device.id, v_device.user_id, v_category, p_type, p_template_key, v_device.locale,
      v_rendered.title, v_rendered.body, coalesce(p_data, '{}'::jsonb), p_urgent, v_when,
      p_dedupe_prefix || ':' || v_device.id::text
    )
    -- Prédicat requis : l'index unique sur dedupe_key est PARTIEL.
    on conflict (dedupe_key) where dedupe_key is not null do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

comment on function private.enqueue_push(text, public.notification_type, jsonb, jsonb, text, uuid, uuid, boolean, text) is
'LE seul chemin d''écriture dans push_outbox. Applique, pour tous les émetteurs :
 - la catégorie lue sur le GABARIT (un appelant ne peut pas déguiser un post en appel de file) ;
 - la préférence du compte pour cette catégorie ;
 - les heures calmes 08:00–21:00, par DIFFÉRÉ et non par annulation, sauf urgent ;
 - un rendu par langue d''APPAREIL (deux téléphones du même compte peuvent lire deux langues) ;
 - une clé d''idempotence portant l''événement et l''appareil.
Sans compte, seule la catégorie queue_call est acceptée, et seulement pour les appareils rattachés à l''entrée de file concernée.';

revoke all on function private.enqueue_push(text, public.notification_type, jsonb, jsonb, text, uuid, uuid, boolean, text)
  from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 9. Les quatre événements
-- ---------------------------------------------------------------------------

begin;

-- 9.1 « C'est ton tour ».
--
-- Un TRIGGER, et pas un appel dans une RPC : l'appel du client est un UPDATE
-- direct de queue_entries.status (face pro F1/OS-2, RLS + triggers de
-- transition). Il n'existe aucune fonction unique à instrumenter, et il y a
-- plusieurs écrivains — web pro, plateforme, futurs outils. Le trigger les
-- couvre tous, aujourd'hui et demain.

create or replace function public.queue_entries_notify_called()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_name text;
  v_tz text;
begin
  select o.name into v_org_name from public.organizations o where o.id = new.organization_id;
  select l.timezone into v_tz from public.locations l where l.id = new.location_id;

  -- La ligne in-app : elle existe même sans push, et c'est elle qui rend
  -- l'événement lisible dans l'app après coup.
  if new.booked_by_user_id is not null then
    insert into public.notifications (user_id, type, title, body, organization_id, dedupe_key)
    values (
      new.booked_by_user_id, 'queue_called', 'It''s your turn', coalesce(v_org_name, ''),
      new.organization_id, 'queue:' || new.id::text || ':called'
    )
    on conflict (dedupe_key) do nothing;
  end if;

  -- Le push. URGENT : le client est dans le salon, debout, et une heure calme
  -- ne doit pas retenir l'appel qu'il attend.
  perform private.enqueue_push(
    p_template_key := 'queue_called',
    p_type := 'queue_called',
    p_payload := jsonb_build_object('organization_name', coalesce(v_org_name, '')),
    p_data := jsonb_build_object('kind', 'queue_entry', 'entry_id', new.id, 'organization_id', new.organization_id),
    p_dedupe_prefix := 'queue:' || new.id::text || ':called',
    p_user_id := new.booked_by_user_id,
    p_queue_entry_id := new.id,
    p_urgent := true,
    p_tz := v_tz
  );

  return null;
end;
$$;

comment on function public.queue_entries_notify_called() is
  'Émet la notification « c''est votre tour » au passage waiting -> called. AFTER trigger : l''appel est déjà acquis quand on prévient, et une erreur d''émission ne peut pas annuler un appel de file. Idempotent par dedupe_key, donc un appel rejoué (ou un UPDATE sans changement de statut) ne produit pas un second message.';

revoke all on function public.queue_entries_notify_called() from public, anon, authenticated;

drop trigger if exists queue_entries_notify_called on public.queue_entries;
create trigger queue_entries_notify_called
  after update of status on public.queue_entries
  for each row
  when (new.status = 'called' and old.status is distinct from 'called')
  execute function public.queue_entries_notify_called();

-- 9.2 Demande acceptée ou refusée, et 9.3 le rappel.
--
-- `private.emit_booking_notification` est DÉJÀ l'unique endroit qui écrit les
-- deux canaux d'une transition de réservation (ligne in-app + intention
-- e-mail). Le push s'y ajoute comme troisième canal : aucun appelant ne
-- change, et les trois canaux commitent avec la décision qui les provoque.
--
-- Le corps ci-dessous est celui de la production (lot C + B2), à l'identique,
-- plus le bloc marqué M1c-a.

create or replace function private.emit_booking_notification(
  p_appointment public.appointments,
  p_type public.notification_type,
  p_audience text,
  p_title text,
  p_body text default null,
  p_email_template text default null,
  p_dedupe_suffix text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_org_name text;
  v_service_name text;
  v_recipient record;
  v_timezone text;
  v_payload jsonb;
  v_locale text;
begin
  select o.name into v_org_name from public.organizations o where o.id = p_appointment.organization_id;
  select s.name into v_service_name from public.services s where s.id = p_appointment.service_id;
  select l.timezone into v_timezone from public.locations l where l.id = p_appointment.location_id;
  v_timezone := coalesce(v_timezone, 'UTC');

  -- Le payload commun aux deux publics. `expires_at` n'est renseigné que sur
  -- une demande — sur une réservation confirmée il n'y a rien à faire expirer,
  -- et un gabarit qui l'attendrait échouerait bruyamment au rendu plutôt que
  -- d'afficher une échéance vide.
  v_payload := jsonb_build_object(
    'appointment_id', p_appointment.id,
    'organization_name', coalesce(v_org_name, ''),
    'service_name', coalesce(v_service_name, ''),
    'starts_at', p_appointment.starts_at,
    'starts_at_fr', to_char(p_appointment.starts_at at time zone v_timezone, 'DD/MM/YYYY à HH24:MI'),
    'starts_at_en', to_char(p_appointment.starts_at at time zone v_timezone, 'YYYY-MM-DD at HH24:MI'),
    'timezone', v_timezone,
    'customer_name', p_appointment.customer_name
  );

  if p_appointment.expires_at is not null then
    v_payload := v_payload || jsonb_build_object(
      'expires_at_fr', to_char(p_appointment.expires_at at time zone v_timezone, 'DD/MM/YYYY à HH24:MI'),
      'expires_at_en', to_char(p_appointment.expires_at at time zone v_timezone, 'YYYY-MM-DD at HH24:MI')
    );
  end if;

  if p_audience = 'customer' then
    -- The account behind the booking, if there is one. An anonymous booking
    -- has no account to notify in-app; it still gets the email, because the
    -- appointment carries the address that was typed at booking time.
    select c.user_id into v_user_id
      from public.customers c where c.id = p_appointment.customer_id;
    v_email := p_appointment.customer_email;

    if v_user_id is not null then
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':customer' || p_dedupe_suffix)
      on conflict (dedupe_key) do nothing;
    end if;

    if v_email is not null and p_email_template is not null then
      select p.locale into v_locale from public.profiles p where p.id = v_user_id;
      insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
      values (v_email, p_email_template,
              case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
              v_payload, 'transactional',
              p_appointment.id::text || ':' || p_email_template || ':customer' || p_dedupe_suffix)
      -- Le prédicat est OBLIGATOIRE : email_outbox_dedupe_key_unique est un
      -- index unique PARTIEL, et Postgres ne l'infère qu'à condition qu'on
      -- répète sa condition ici. Sans elle : « there is no unique or
      -- exclusion constraint matching the ON CONFLICT specification ».
      on conflict (dedupe_key) where dedupe_key is not null do nothing;
    end if;

    -- M1c-a — le troisième canal. Trois types seulement : la réponse du
    -- professionnel à une demande, et le rappel. Une annulation ou une
    -- expiration reste e-mail et in-app : le fondateur a tranché QUATRE
    -- événements, et ce fichier n'en invente pas un cinquième.
    if v_user_id is not null and p_type in ('booking_confirmed', 'booking_declined', 'booking_reminder') then
      perform private.enqueue_push(
        p_template_key := p_type::text,
        p_type := p_type,
        p_payload := v_payload || jsonb_build_object(
          'time_fr', to_char(p_appointment.starts_at at time zone v_timezone, 'HH24:MI'),
          'time_en', to_char(p_appointment.starts_at at time zone v_timezone, 'HH24:MI')
        ),
        p_data := jsonb_build_object('kind', 'appointment', 'appointment_id', p_appointment.id),
        p_dedupe_prefix := p_appointment.id::text || ':' || p_type::text || p_dedupe_suffix,
        p_user_id := v_user_id,
        -- Transactionnel : MASTER_SPEC §13 le veut immédiat. Un rappel de
        -- rendez-vous, en revanche, n'a pas à sonner à 3 h du matin — c'est
        -- l'ordonnanceur du rappel qui choisit son heure, pas les heures
        -- calmes appliquées après coup.
        p_urgent := true,
        p_tz := v_timezone
      );
    end if;

  elsif p_audience = 'business' then
    -- Everyone who can actually act on it. A request that only reaches the
    -- owner is a request that waits for the owner to be free.
    for v_recipient in
      select m.user_id
        from public.memberships m
        where m.organization_id = p_appointment.organization_id
          and m.role in ('owner', 'manager', 'receptionist')
    loop
      insert into public.notifications (user_id, type, title, body, organization_id, appointment_id, dedupe_key)
      values (v_recipient.user_id, p_type, p_title, p_body, p_appointment.organization_id, p_appointment.id,
              p_appointment.id::text || ':' || p_type::text || ':' || v_recipient.user_id::text || p_dedupe_suffix)
      -- notifications.dedupe_key porte une contrainte unique PLEINE : pas de
      -- prédicat ici, contrairement aux insertions dans email_outbox.
      on conflict (dedupe_key) do nothing;
    end loop;

    if p_email_template is not null then
      -- One address for the shop: the owner's. Fanning transactional email out
      -- to every member is a notification-preference decision, not a booking
      -- one, and belongs with the preferences that do not exist yet.
      select u.email, pr.locale into v_email, v_locale
        from public.memberships m
        join auth.users u on u.id = m.user_id
        left join public.profiles pr on pr.id = m.user_id
        where m.organization_id = p_appointment.organization_id and m.role = 'owner'
        order by m.created_at
        limit 1;

      if v_email is not null then
        insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
        values (v_email, p_email_template,
                case when lower(coalesce(v_locale, 'fr')) = 'en' then 'en' else 'fr' end,
                v_payload, 'transactional',
                p_appointment.id::text || ':' || p_email_template || ':business' || p_dedupe_suffix)
        on conflict (dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  end if;
end;
$$;

revoke execute on function private.emit_booking_notification(
  public.appointments, public.notification_type, text, text, text, text, text
) from public, anon, authenticated;

-- 9.3 L'ordonnanceur du rappel.
--
-- Le gabarit `booking_reminder` existe depuis B2 et rien ne l'appelait. Ici :
-- deux heures avant le rendez-vous, une seule fois, sur les seules
-- réservations confirmées. Les trois canaux partent ensemble, parce que
-- emit_booking_notification les écrit ensemble.

create or replace function private.enqueue_appointment_reminders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appointment public.appointments;
  v_count integer := 0;
begin
  for v_appointment in
    select a.* from public.appointments a
    where a.status = 'confirmed'
      -- La fenêtre : le rendez-vous commence dans moins de deux heures et
      -- n'a pas commencé. Le scheduler tourne chaque minute, donc une borne
      -- large n'envoie pas deux fois — la clé de dédoublonnage s'en charge —
      -- mais rattrape un scheduler arrêté une heure.
      and a.starts_at > now()
      and a.starts_at <= now() + interval '2 hours'
      and not exists (
        select 1 from public.email_outbox o
        where o.dedupe_key = a.id::text || ':booking_reminder:customer'
      )
    order by a.starts_at
    limit greatest(p_limit, 0)
  loop
    begin
      perform private.emit_booking_notification(
        v_appointment,
        'booking_reminder',
        'customer',
        'Your appointment is soon',
        null,
        'booking_reminder'
      );
      v_count := v_count + 1;
    exception when others then
      -- Un rendez-vous dont le rappel échoue (gabarit, adresse) ne doit pas
      -- arrêter le lot : les autres clients attendent le leur.
      null;
    end;
  end loop;

  return v_count;
end;
$$;

comment on function private.enqueue_appointment_reminders(integer) is
'Le déclencheur qui manquait au gabarit booking_reminder de B2. Deux heures avant le rendez-vous, une seule fois, sur les réservations CONFIRMÉES uniquement — une demande en attente n''est pas un rendez-vous, et lui envoyer un rappel serait une promesse fabriquée.

Idempotent sans registre supplémentaire : la présence de la ligne d''e-mail `<appointment>:booking_reminder:customer` dans email_outbox EST la marque. Une seule vérité, pas un second registre à garder cohérent (même choix qu''enqueue_prospect_outreach).';

revoke all on function private.enqueue_appointment_reminders(integer) from public, anon, authenticated;

-- 9.4 Nouveau post d'un professionnel ou d'un salon suivi.
--
-- Diffusion DIFFÉRÉE, hors de la transaction de publication : un salon avec
-- dix mille abonnés ne doit pas attendre dix mille insertions pour voir son
-- post publié. Et les heures calmes s'appliquent : un post n'est pas urgent.

create or replace function private.enqueue_post_pushes(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post record;
  v_follower record;
  v_author_name text;
  v_org_id uuid;
  v_tz text;
  v_queued integer;
  v_total integer := 0;
begin
  for v_post in
    select p.* from public.posts p
    where p.hidden_at is null
      and p.visibility in ('public', 'followers')
      -- Une fenêtre de rattrapage bornée : un post d'hier n'a plus rien à
      -- annoncer, et sans borne un scheduler relancé après une panne
      -- réveillerait tout le monde pour des publications périmées.
      and p.created_at > now() - interval '6 hours'
      and not exists (select 1 from public.push_post_fanout f where f.post_id = p.id)
    order by p.created_at
    limit greatest(p_limit, 0)
  loop
    v_queued := 0;

    if v_post.author_kind = 'professional' then
      select coalesce(pr.display_name, '') into v_author_name
        from public.professionals pr where pr.id = v_post.professional_id;
      -- `barbers` ne porte PAS de lieu (organization_id + staff_profile_id) :
      -- le fuseau se prend sur l'établissement où le post a été publié, à
      -- défaut sur celui où ce professionnel exerce.
      v_org_id := coalesce(
        v_post.posted_at_organization_id,
        (select b.organization_id from public.barbers b
          where b.professional_id = v_post.professional_id order by b.created_at limit 1)
      );
    else
      select coalesce(o.name, '') into v_author_name
        from public.organizations o where o.id = v_post.organization_id;
      v_org_id := v_post.organization_id;
    end if;

    v_tz := null;
    if v_org_id is not null then
      select l.timezone into v_tz
        from public.locations l where l.organization_id = v_org_id
        order by l.created_at limit 1;
    end if;

    for v_follower in
      select f.follower_user_id
        from public.professional_follows f
        where v_post.author_kind = 'professional'
          and f.professional_id = v_post.professional_id
          and f.state = 'following'
      union
      select f.follower_user_id
        from public.organization_follows f
        where v_post.author_kind = 'organization'
          and f.organization_id = v_post.organization_id
          and f.is_following
    loop
      v_queued := v_queued + private.enqueue_push(
        p_template_key := 'post_published',
        p_type := 'post_published',
        p_payload := jsonb_build_object('author_name', v_author_name),
        p_data := jsonb_build_object('kind', 'post', 'post_id', v_post.id),
        p_dedupe_prefix := 'post:' || v_post.id::text,
        p_user_id := v_follower.follower_user_id,
        p_urgent := false,
        p_tz := v_tz
      );
    end loop;

    insert into public.push_post_fanout (post_id, devices_queued)
    values (v_post.id, v_queued)
    on conflict (post_id) do nothing;

    v_total := v_total + v_queued;
  end loop;

  return v_total;
end;
$$;

comment on function private.enqueue_post_pushes(integer) is
'Diffuse un nouveau post à ses abonnés, une seule fois par post (registre push_post_fanout) et hors de la transaction de publication — publier ne doit pas coûter le prix de la diffusion.

Aucune notification in-app n''est écrite : le post est DÉJÀ dans le fil, et doubler le fil d''une cloche serait du bruit. Catégorie social_post : désactivée par défaut, heures calmes appliquées.';

revoke all on function private.enqueue_post_pushes(integer) from public, anon, authenticated;

commit;

-- ---------------------------------------------------------------------------
-- 10. Le transport — trois passes, comme les e-mails en ont deux
-- ---------------------------------------------------------------------------

begin;

create or replace function private.expo_access_token()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'expo_access_token'
  limit 1;
$$;

comment on function private.expo_access_token() is
'Le jeton d''accès Expo, s''il existe dans le vault. Il n''est PAS requis : l''API push d''Expo accepte un envoi non authentifié. Il le devient si le fondateur active « enhanced security for push notifications » sur son compte Expo — ce jour-là, l''installer dans le vault (même motif que resend_api_key) suffit, sans migration.';

revoke all on function private.expo_access_token() from public, anon, authenticated;

create or replace function private.push_dispatch_batch(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_headers jsonb;
  v_body jsonb;
  v_token text;
  v_request_id bigint;
  v_count integer := 0;
begin
  v_token := private.expo_access_token();
  v_headers := jsonb_build_object('Content-Type', 'application/json')
    || case when v_token is null then '{}'::jsonb
            else jsonb_build_object('Authorization', 'Bearer ' || v_token) end;

  for v_row in
    select o.*, d.token as device_token
    from public.push_outbox o
    join public.push_devices d on d.id = o.device_id
    where o.status = 'queued'
      and o.next_attempt_at <= now()
      -- Un jeton révoqué entre la mise en file et la dépêche : on ne
      -- l'envoie pas, et la ligne le dit.
      and d.revoked_at is null
    order by o.urgent desc, o.next_attempt_at
    limit greatest(p_limit, 0)
    for update of o skip locked
  loop
    begin
      -- Un TABLEAU d'un message, pas un objet : la réponse d'Expo est alors
      -- toujours `{"data":[{…}]}`, donc `data->0` sans condition. Avec un
      -- objet, Expo répond un objet, et le code de réconciliation devrait
      -- gérer deux formes.
      v_body := jsonb_build_array(jsonb_build_object(
        'to', v_row.device_token,
        'title', v_row.title,
        'body', v_row.body,
        'data', v_row.data,
        'sound', 'default',
        -- « C'est ton tour » doit réveiller l'écran : priorité haute et
        -- interruption immédiate sur iOS. Le reste attend le prochain
        -- déverrouillage.
        'priority', case when v_row.urgent then 'high' else 'default' end,
        'interruptionLevel', case when v_row.urgent then 'time-sensitive' else 'active' end,
        'channelId', 'default'
      ));

      v_request_id := net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        body := v_body,
        headers := v_headers,
        timeout_milliseconds := 15000
      );

      update public.push_outbox
        set status = 'sending',
            net_request_id = v_request_id,
            dispatched_at = now(),
            attempts = attempts + 1,
            updated_at = now()
        where id = v_row.id and status = 'queued';

      if found then
        v_count := v_count + 1;
      end if;

    exception when others then
      update public.push_outbox
        set status = 'failed',
            last_error = left(sqlerrm, 500),
            attempts = attempts + 1,
            updated_at = now()
        where id = v_row.id;
    end;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.push_dispatch_batch(integer) from public, anon, authenticated;

create or replace function private.push_reconcile_batch(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_ticket jsonb;
  v_status text;
  v_error text;
  v_count integer := 0;
begin
  for v_row in
    select o.id, o.device_id, o.attempts, r.status_code, r.content, r.error_msg
    from public.push_outbox o
    join net._http_response r on r.id = o.net_request_id
    where o.status = 'sending'
    limit greatest(p_limit, 0)
  loop
    v_ticket := null;
    v_status := null;
    v_error := null;

    if v_row.status_code between 200 and 299 then
      begin
        v_ticket := (v_row.content::jsonb -> 'data') -> 0;
      exception when others then
        v_ticket := null;
      end;
      v_status := v_ticket ->> 'status';
      v_error := (v_ticket -> 'details') ->> 'error';
    end if;

    if v_status = 'ok' then
      update public.push_outbox
        set status = 'sent',
            sent_at = now(),
            provider_ticket_id = nullif(v_ticket ->> 'id', ''),
            last_error = null,
            updated_at = now()
        where id = v_row.id;

    elsif v_error = 'DeviceNotRegistered' then
      -- Le jeton est mort. On le retire — c'est la seule réponse correcte :
      -- réessayer ne peut pas réussir, et garder le jeton ferait grossir
      -- indéfiniment le nombre d'envois perdus.
      update public.push_devices
        set revoked_at = now(), revoked_reason = 'DeviceNotRegistered', updated_at = now()
        where id = v_row.device_id and revoked_at is null;
      update public.push_outbox
        set status = 'failed', last_error = 'DeviceNotRegistered', updated_at = now()
        where id = v_row.id;

    elsif v_status = 'error' then
      -- Message trop gros, jeton mal formé, débit dépassé : les deux premiers
      -- ne s'arrangeront pas, le troisième oui. Repli exponentiel plafonné,
      -- cinq tentatives, comme les e-mails.
      update public.push_outbox
        set status = case when v_row.attempts >= 5 then 'failed'::public.push_delivery_status
                          else 'queued'::public.push_delivery_status end,
            next_attempt_at = now() + make_interval(mins => least(power(3, v_row.attempts)::integer, 480)),
            last_error = left(coalesce(v_ticket ->> 'message', 'provider error'), 500),
            net_request_id = null,
            updated_at = now()
        where id = v_row.id;

    else
      update public.push_outbox
        set status = case when v_row.attempts >= 5 then 'failed'::public.push_delivery_status
                          else 'queued'::public.push_delivery_status end,
            next_attempt_at = now() + make_interval(mins => least(power(3, v_row.attempts)::integer, 480)),
            last_error = left(coalesce(v_row.error_msg,
              'HTTP ' || coalesce(v_row.status_code::text, '?') || ': ' || coalesce(v_row.content, '')), 500),
            net_request_id = null,
            updated_at = now()
        where id = v_row.id;
    end if;

    v_count := v_count + 1;
  end loop;

  -- Les réponses pg_net sont purgées après quelques heures. Une ligne restée
  -- « sending » au-delà a perdu la sienne. B2 choisit de RÉESSAYER et le dit ;
  -- ici le choix est le MÊME pour l'urgent et INVERSE pour le reste : un
  -- second « c'est ton tour » est un désagrément, un appel jamais reçu est un
  -- client qui perd sa place. Un second « nouveau post », lui, ne vaut pas le
  -- risque de sonner deux fois pour rien.
  update public.push_outbox
    set status = case
          when urgent and attempts < 5 then 'queued'::public.push_delivery_status
          else 'failed'::public.push_delivery_status end,
        next_attempt_at = now() + interval '1 minute',
        last_error = 'provider response expired before reconciliation',
        net_request_id = null,
        updated_at = now()
  where status = 'sending'
    and dispatched_at < now() - interval '6 hours';

  return v_count;
end;
$$;

revoke all on function private.push_reconcile_batch(integer) from public, anon, authenticated;

-- Les reçus : ce qu'APNs a fait du message. C'est là que « DeviceNotRegistered »
-- apparaît le plus souvent — un ticket « ok » ne dit que « reçu par Expo ».
create or replace function private.push_receipt_request_batch(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids text[];
  v_token text;
  v_headers jsonb;
  v_request_id bigint;
begin
  select array_agg(o.provider_ticket_id)
    into v_ids
  from (
    select provider_ticket_id
    from public.push_outbox
    where status = 'sent'
      and provider_ticket_id is not null
      and receipt_requested_at is null
      -- Expo demande de laisser passer quelques instants avant de réclamer
      -- un reçu : trop tôt, il n'existe pas encore.
      and sent_at < now() - interval '1 minute'
    order by sent_at
    limit least(greatest(p_limit, 0), 100)
  ) o;

  if v_ids is null or cardinality(v_ids) = 0 then
    return 0;
  end if;

  v_token := private.expo_access_token();
  v_headers := jsonb_build_object('Content-Type', 'application/json')
    || case when v_token is null then '{}'::jsonb
            else jsonb_build_object('Authorization', 'Bearer ' || v_token) end;

  v_request_id := net.http_post(
    url := 'https://exp.host/--/api/v2/push/getReceipts',
    body := jsonb_build_object('ids', to_jsonb(v_ids)),
    headers := v_headers,
    timeout_milliseconds := 15000
  );

  insert into public.push_receipt_requests (net_request_id, ticket_ids)
  values (v_request_id, v_ids);

  -- Marqué DEMANDÉ au moment de l'émission : sans cela, le tick suivant
  -- redemanderait les mêmes reçus avant que le premier n'ait répondu.
  update public.push_outbox
    set receipt_requested_at = now(), updated_at = now()
    where provider_ticket_id = any (v_ids) and receipt_requested_at is null;

  return cardinality(v_ids);
end;
$$;

revoke all on function private.push_receipt_request_batch(integer) from public, anon, authenticated;

create or replace function private.push_receipt_resolve_batch(p_limit integer default 20)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req record;
  v_ticket text;
  v_receipt jsonb;
  v_count integer := 0;
begin
  for v_req in
    select q.id, q.ticket_ids, r.status_code, r.content, r.error_msg
    from public.push_receipt_requests q
    join net._http_response r on r.id = q.net_request_id
    where q.resolved_at is null
    limit greatest(p_limit, 0)
  loop
    if v_req.status_code between 200 and 299 then
      for v_ticket, v_receipt in
        select key, value from jsonb_each((v_req.content::jsonb) -> 'data')
      loop
        if (v_receipt ->> 'status') = 'error'
           and ((v_receipt -> 'details') ->> 'error') = 'DeviceNotRegistered' then
          update public.push_devices d
            set revoked_at = now(), revoked_reason = 'DeviceNotRegistered', updated_at = now()
            where d.revoked_at is null
              and exists (
                select 1 from public.push_outbox o
                where o.provider_ticket_id = v_ticket and o.device_id = d.id
              );
          update public.push_outbox
            set status = 'failed', last_error = 'DeviceNotRegistered (receipt)', updated_at = now()
            where provider_ticket_id = v_ticket;
        elsif (v_receipt ->> 'status') = 'error' then
          -- Le message n'est pas arrivé, mais le jeton vit : on l'inscrit
          -- sans réessayer. Un « c'est ton tour » réémis dix minutes plus
          -- tard serait un mensonge.
          update public.push_outbox
            set last_error = left(coalesce(v_receipt ->> 'message', 'receipt error'), 500),
                updated_at = now()
            where provider_ticket_id = v_ticket;
        end if;
      end loop;
      update public.push_receipt_requests set resolved_at = now() where id = v_req.id;
    else
      update public.push_receipt_requests
        set resolved_at = now(),
            last_error = left(coalesce(v_req.error_msg,
              'HTTP ' || coalesce(v_req.status_code::text, '?')), 500)
        where id = v_req.id;
    end if;

    v_count := v_count + 1;
  end loop;

  -- Réponse purgée avant lecture : la demande est close sans conclusion. Le
  -- jeton restera actif — le prochain envoi qui échoue le retirera.
  update public.push_receipt_requests
    set resolved_at = now(), last_error = 'provider response expired before resolution'
  where resolved_at is null and requested_at < now() - interval '6 hours';

  return v_count;
end;
$$;

revoke all on function private.push_receipt_resolve_batch(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Ce que le scheduler appelle
--
-- Un appel SÉPARÉ dans tick.sh, comme le balayage de grâce F1b : les six
-- travaux historiques partagent une instruction, donc un domaine en panne les
-- fait tomber ensemble. Le push ne doit pas rejoindre ce rayon d'explosion —
-- ni l'élargir : une panne d'Expo ne doit pas retarder une confirmation.
-- ---------------------------------------------------------------------------

create or replace function public.run_push_maintenance()
returns table (
  reminders_queued integer,
  post_pushes_queued integer,
  dispatched integer,
  reconciled integer,
  receipts_requested integer,
  receipts_resolved integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query select
    private.enqueue_appointment_reminders(100),
    private.enqueue_post_pushes(20),
    -- Réconcilier AVANT de dépêcher : les réponses du tick précédent sont
    -- arrivées pendant l'intervalle, et les conclure d'abord garde le nombre
    -- de lignes « sending » borné (même ordre qu'en B2).
    private.push_dispatch_batch(25),
    private.push_reconcile_batch(100),
    private.push_receipt_request_batch(100),
    private.push_receipt_resolve_batch(20);
end;
$$;

comment on function public.run_push_maintenance() is
'Le tick du push, appelé par le conteneur fadeup-scheduler. Met en file les rappels dus et les nouveaux posts, puis dépêche, réconcilie les tickets, réclame et lit les reçus. Ne fait rien du tout si aucun appareil n''est enregistré — le cas normal d''une base de test ou d''une restauration.';

revoke all on function public.run_push_maintenance() from public, anon, authenticated;
grant execute on function public.run_push_maintenance() to fadeup_scheduler;

commit;

-- ---------------------------------------------------------------------------
-- 12. Les contrats clients
--
-- X3 : une fonction de public naît SANS EXECUTE pour anon/authenticated. Tout
-- ce qui suit porte donc un grant EXPLICITE, et rien d'autre n'en a un.
-- ---------------------------------------------------------------------------

begin;

create or replace function public.register_push_device(
  p_token text,
  p_platform text,
  p_locale text default 'fr',
  p_queue_entry_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_platform public.push_platform;
  v_locale text;
  v_entry public.queue_entries;
  v_id uuid;
begin
  if p_token is null or p_token !~ '^Expo(nent)?PushToken\[[^]]+\]$' then
    raise exception 'invalid push token' using errcode = '22023', detail = 'fadeup_push_error=invalid_token';
  end if;

  begin
    v_platform := lower(btrim(coalesce(p_platform, '')))::public.push_platform;
  exception when others then
    raise exception 'invalid platform' using errcode = '22023', detail = 'fadeup_push_error=invalid_platform';
  end;

  v_locale := case when lower(coalesce(p_locale, 'fr')) = 'en' then 'en' else 'fr' end;

  if v_user_id is null then
    -- Sans compte, l'appareil doit dire QUELLE place il suit, et cette place
    -- doit être vivante. Un identifiant d'entrée terminée ou inconnu ne donne
    -- rien : ni ligne, ni information sur son existence (même message).
    if p_queue_entry_id is null then
      raise exception 'push registration requires a session or a live queue entry'
        using errcode = '42501', detail = 'fadeup_push_error=subject_required';
    end if;
    select * into v_entry from public.queue_entries q where q.id = p_queue_entry_id;
    if v_entry.id is null or v_entry.status not in ('waiting', 'called', 'in_service') then
      raise exception 'push registration requires a session or a live queue entry'
        using errcode = '42501', detail = 'fadeup_push_error=subject_required';
    end if;
  end if;

  insert into public.push_devices (token, platform, user_id, queue_entry_id, locale, last_seen_at)
  values (p_token, v_platform, v_user_id, p_queue_entry_id, v_locale, now())
  on conflict (token) do update
    set platform = excluded.platform,
        -- Un appareil qui se connecte APRÈS s'être enregistré en anonyme
        -- change de propriétaire ; un appareil qui se déconnecte garde le
        -- sien jusqu'à révocation explicite (le client peut se reconnecter).
        user_id = coalesce(excluded.user_id, public.push_devices.user_id),
        queue_entry_id = coalesce(excluded.queue_entry_id, public.push_devices.queue_entry_id),
        locale = excluded.locale,
        last_seen_at = now(),
        -- Ré-enregistrer un jeton révoqué le ressuscite : c'est exactement ce
        -- que « jusqu'à ce qu'il se ré-enregistre » veut dire.
        revoked_at = null,
        revoked_reason = null,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.register_push_device(text, text, text, uuid) is
'Enregistre ou rafraîchit le jeton push d''un appareil. Multi-appareils par compte (la clé est le jeton). Sans session, exige l''identifiant d''une entrée de file VIVANTE — le seul cas où un anonyme est joignable pour une raison légitime, et un identifiant d''entrée est déjà, dans le contrat F1, la preuve de possession de la place. Un jeton révoqué que l''on ré-enregistre redevient actif.';

revoke all on function public.register_push_device(text, text, text, uuid) from public;
grant execute on function public.register_push_device(text, text, text, uuid) to anon, authenticated;

create or replace function public.revoke_push_device(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  update public.push_devices d
    set revoked_at = now(), revoked_reason = 'client_revoked', updated_at = now()
  where d.token = p_token
    and d.revoked_at is null
    -- Détenir le jeton, c'est être l'appareil. On exige tout de même que le
    -- jeton ne soit pas celui d'un AUTRE compte : un appareil partagé ne doit
    -- pas pouvoir faire taire le téléphone de son ancien propriétaire.
    and (d.user_id is null or d.user_id = v_user_id);
end;
$$;

comment on function public.revoke_push_device(text) is
  'Retire un appareil des destinataires (déconnexion, refus de notifications côté système). Révoque, ne supprime pas : la trace de ce qui a été envoyé à cet appareil doit rester lisible.';

revoke all on function public.revoke_push_device(text) from public;
grant execute on function public.revoke_push_device(text) to anon, authenticated;

create or replace function public.get_my_notification_preferences()
returns table (
  queue_call boolean,
  booking_response boolean,
  appointment_reminder boolean,
  social_post boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(p.queue_call, true),
    coalesce(p.booking_response, true),
    coalesce(p.appointment_reminder, true),
    coalesce(p.social_post, false)
  from (select auth.uid() as uid) q
  left join public.notification_push_preferences p on p.user_id = q.uid
  where q.uid is not null;
$$;

comment on function public.get_my_notification_preferences() is
  'Mes préférences de push par catégorie, ou leurs défauts si aucune ligne n''existe — l''écran n''a donc jamais à distinguer « pas encore réglé » de « réglé aux défauts ». Aucune ligne rendue en anonyme.';

revoke all on function public.get_my_notification_preferences() from public;
grant execute on function public.get_my_notification_preferences() to authenticated;

create or replace function public.set_my_notification_preference(
  p_category text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_category public.push_category;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'invalid preference value' using errcode = '22023';
  end if;

  begin
    v_category := btrim(coalesce(p_category, ''))::public.push_category;
  exception when others then
    raise exception 'unknown notification category' using errcode = '22023',
      detail = 'fadeup_push_error=unknown_category';
  end;

  insert into public.notification_push_preferences (user_id) values (v_user_id)
  on conflict (user_id) do nothing;

  -- Une colonne par catégorie, donc un UPDATE par catégorie : du SQL
  -- dynamique ici accepterait un nom de colonne venu du client.
  case v_category
    when 'queue_call' then
      update public.notification_push_preferences set queue_call = p_enabled where user_id = v_user_id;
    when 'booking_response' then
      update public.notification_push_preferences set booking_response = p_enabled where user_id = v_user_id;
    when 'appointment_reminder' then
      update public.notification_push_preferences set appointment_reminder = p_enabled where user_id = v_user_id;
    when 'social_post' then
      update public.notification_push_preferences set social_post = p_enabled where user_id = v_user_id;
  end case;
end;
$$;

comment on function public.set_my_notification_preference(text, boolean) is
  'Change UNE préférence de push. Ne gouverne que le push : la notification in-app et l''e-mail transactionnel partent quoi qu''il arrive — couper une catégorie fait taire l''écran verrouillé, elle ne retire pas l''information.';

revoke all on function public.set_my_notification_preference(text, boolean) from public;
grant execute on function public.set_my_notification_preference(text, boolean) to authenticated;

commit;
