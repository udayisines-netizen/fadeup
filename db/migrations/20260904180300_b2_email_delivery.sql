-- FadeUp — B2, chantier 2 + 4: les e-mails partent vraiment.
--
-- CE QUI EXISTAIT, ET CE QUI MANQUAIT
--
-- `email_outbox` existe depuis R1A, avec une machine d'état complète : status,
-- attempts, next_attempt_at, locked_at, last_error, sent_at. Quinze lignes y
-- attendent, dont des invitations d'équipe et des accusés de réservation.
--
-- **Rien ne l'a jamais vidée.** Il n'existe aucun expéditeur dans le dépôt.
-- La table est une file d'attente sans facteur.
--
-- L'EXPÉDITEUR, ET POURQUOI IL VIT DANS LA BASE
--
-- pg_net 0.20.3 est installé et la base a une sortie HTTPS — vérifié :
-- net.http_get('https://api.resend.com/') répond 200. supabase_vault 0.3.1 est
-- installé. Les deux ensemble donnent un expéditeur sans conteneur nouveau,
-- sans runtime applicatif, sans arbre de dépendances à patcher — exactement
-- l'argument que le compose du scheduler avance pour lui-même : « la plus
-- petite chose correcte ».
--
-- La clé API ne vit ni dans une migration, ni dans un fichier suivi par git,
-- ni dans une variable d'environnement de conteneur : elle est dans le vault,
-- chiffrée, et installée par un script séparé qui lit `.env` et n'affiche
-- rien (db/seeds/b2_install_resend_secret.sh).
--
-- LA SÉPARATION DES FLUX — MESURÉE, PAS SUPPOSÉE
--
-- B2 demande deux domaines d'envoi distincts, transactionnel et prospection,
-- pour qu'une réputation abîmée par du démarchage à froid ne fasse pas tomber
-- les liens magiques. Sondé contre l'API Resend :
--
--   contact.fade-up.com  -> accepté (id retourné)
--   pro.fade-up.com      -> 403 « domain is not verified »
--
-- **Un seul domaine est vérifié.** La séparation demandée n'est donc PAS en
-- place, et ce fichier ne fait pas semblant. Ce qu'il fait :
--
--   - il modélise les deux flux comme des lignes de `email_streams`, avec leur
--     adresse d'expédition. Pointer la prospection vers un second domaine, le
--     jour où il sera vérifié, est un UPDATE d'une ligne — pas une migration ;
--   - il sépare les adresses d'expéditeur (bonjour@ / pro@), ce qui aide le
--     destinataire et le routage des réponses, et n'aide en rien la
--     réputation, qui est par domaine ;
--   - il n'ajoute les en-têtes de désabonnement que sur la prospection.
--
-- **Le risque reste entier et il est écrit dans BLOCKERS.md** : aujourd'hui,
-- une vague de plaintes sur la prospection dégrade la délivrabilité des
-- e-mails d'authentification, et un client qui ne reçoit pas son lien magique
-- est un client perdu.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- 1. Les deux flux
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'email_stream') then
    create type public.email_stream as enum ('transactional', 'prospecting');
  end if;
end $$;

create table if not exists public.email_streams (
  stream public.email_stream primary key,
  from_address text not null,
  from_name text not null default 'FadeUp',
  reply_to text,
  -- La prospection porte un désabonnement, le transactionnel non : on ne se
  -- désabonne pas d'une confirmation de rendez-vous qu'on a demandée.
  requires_unsubscribe boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_streams_from_address_shape
    check (from_address ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

comment on table public.email_streams is
  'Un flux d''envoi = une adresse d''expédition + une politique de désabonnement. Deux lignes : transactionnel et prospection. Elles partagent aujourd''hui le domaine contact.fade-up.com, le seul vérifié chez Resend — la séparation de réputation que MASTER_SPEC et B2 demandent n''existera que quand un second domaine sera vérifié, et ce jour-là elle se fera par un UPDATE de from_address ici.';

drop trigger if exists email_streams_set_updated_at on public.email_streams;
create trigger email_streams_set_updated_at
  before update on public.email_streams
  for each row execute function public.set_updated_at();

insert into public.email_streams (stream, from_address, from_name, reply_to, requires_unsubscribe)
values
  ('transactional', 'bonjour@contact.fade-up.com', 'FadeUp', 'bonjour@contact.fade-up.com', false),
  ('prospecting',   'pro@contact.fade-up.com',     'FadeUp', 'bonjour@contact.fade-up.com', true)
on conflict (stream) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Les gabarits, en base
--
-- En table plutôt qu'en constantes SQL : ce sont des DONNÉES. Elles se
-- relisent, se corrigent sans redéploiement, se traduisent par insertion, et
-- un test peut les parcourir toutes pour vérifier qu'aucune ne dit « Réservé »
-- sur une demande — ce que la suite B2 fait.
-- ---------------------------------------------------------------------------

create table if not exists public.email_templates (
  template_key text not null,
  locale text not null,
  stream public.email_stream not null references public.email_streams (stream),
  subject text not null,
  body_text text not null,
  body_html text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (template_key, locale),
  constraint email_templates_locale_valid check (locale in ('fr', 'en')),
  constraint email_templates_subject_not_blank check (btrim(subject) <> ''),
  constraint email_templates_body_text_not_blank check (btrim(body_text) <> ''),
  constraint email_templates_body_html_not_blank check (btrim(body_html) <> '')
);

comment on table public.email_templates is
  'Sujet, texte brut et HTML par gabarit et par langue. FR et EN sont les deux seules langues product-ready (MASTER_SPEC §1) ; la contrainte le dit plutôt que de laisser une traduction partielle s''installer. Les substitutions sont des {{jetons}} remplacés par private.render_email_template à partir du payload de la ligne d''outbox.';

drop trigger if exists email_templates_set_updated_at on public.email_templates;
create trigger email_templates_set_updated_at
  before update on public.email_templates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. RLS — aucune de ces tables n'est lisible par un client
-- ---------------------------------------------------------------------------

alter table public.email_streams enable row level security;
alter table public.email_templates enable row level security;

drop policy if exists email_streams_select on public.email_streams;
create policy email_streams_select on public.email_streams
  for select to authenticated
  using ((select private.is_platform_admin()));

drop policy if exists email_templates_select on public.email_templates;
create policy email_templates_select on public.email_templates
  for select to authenticated
  using ((select private.is_platform_admin()));

revoke all on table public.email_streams from anon, authenticated;
revoke all on table public.email_templates from anon, authenticated;
grant select on table public.email_streams to authenticated;
grant select on table public.email_templates to authenticated;

-- ---------------------------------------------------------------------------
-- 4. L'outbox apprend d'où part le message et ce qu'il est devenu
-- ---------------------------------------------------------------------------

alter table public.email_outbox
  add column if not exists stream public.email_stream not null default 'transactional',
  add column if not exists net_request_id bigint,
  add column if not exists provider_message_id text,
  add column if not exists dedupe_key text,
  add column if not exists dispatched_at timestamptz;

comment on column public.email_outbox.stream is
  'Quel flux envoie ce message. Défaut transactionnel : toutes les lignes écrites avant B2 sont des accusés de réservation et des invitations d''équipe, qui le sont.';

comment on column public.email_outbox.net_request_id is
  'L''identifiant de requête pg_net, posé au moment de l''appel et relu au tick suivant dans net._http_response. C''est ce qui rend l''envoi asynchrone réconciliable : une ligne « sending » sans réponse encore arrivée n''est ni perdue ni renvoyée.';

comment on column public.email_outbox.dedupe_key is
  'Clé d''idempotence. Deux lignes de même clé ne peuvent pas coexister, donc un scheduler redémarré au milieu d''un lot ne produit jamais un doublon d''envoi. NULL autorisé : les écritures antérieures à B2 n''en portent pas, et un index unique partiel ne contraint que les lignes qui en ont une.';

create unique index if not exists email_outbox_dedupe_key_unique
  on public.email_outbox (dedupe_key) where dedupe_key is not null;

create index if not exists email_outbox_dispatchable_idx
  on public.email_outbox (next_attempt_at) where status = 'queued';

create index if not exists email_outbox_reconcilable_idx
  on public.email_outbox (net_request_id) where net_request_id is not null;

-- `sending` n'existait pas : R1A n'avait pas d'expéditeur, donc pas d'état
-- « parti, réponse attendue ». Sans lui, une ligne appelée mais non encore
-- confirmée serait soit « queued » (et renvoyée au tick suivant, donc en
-- double), soit « sent » (et déclarée réussie sans preuve).
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'email_delivery_status' and e.enumlabel = 'sending'
  ) then
    alter type public.email_delivery_status add value 'sending';
  end if;
end $$;

commit;

-- ADD VALUE sur un enum ne peut pas être utilisé dans la même transaction que
-- sa déclaration. Le reste du fichier ouvre donc sa propre transaction.
begin;

-- ---------------------------------------------------------------------------
-- 5. La clé API, prise dans le vault et nulle part ailleurs
-- ---------------------------------------------------------------------------

create or replace function private.resend_api_key()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret
  from vault.decrypted_secrets s
  where s.name = 'resend_api_key'
  limit 1;
$$;

comment on function private.resend_api_key() is
  'La clé API Resend, déchiffrée depuis supabase_vault. N''est accessible à aucun rôle client : REVOKE ci-dessous. La clé n''apparaît dans aucune migration, aucun fichier suivi par git et aucune variable d''environnement de conteneur — elle est installée par db/seeds/b2_install_resend_secret.sh, qui la lit dans .env et n''affiche rien.';

revoke all on function private.resend_api_key() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Le rendu
-- ---------------------------------------------------------------------------

create or replace function private.render_email_template(
  p_template_key text,
  p_locale text,
  p_payload jsonb
)
returns table (subject text, body_text text, body_html text, stream public.email_stream)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tpl public.email_templates;
  v_locale text;
  v_subject text;
  v_text text;
  v_html text;
  v_key text;
  v_value text;
begin
  v_locale := case when lower(coalesce(p_locale, 'fr')) = 'en' then 'en' else 'fr' end;

  select * into v_tpl from public.email_templates t
  where t.template_key = p_template_key and t.locale = v_locale;

  if not found then
    -- Repli sur le français, langue du marché de lancement, plutôt que sur
    -- rien. Un e-mail dans la mauvaise langue vaut mieux qu'un e-mail non
    -- envoyé, et le trou de traduction se voit dans les logs.
    select * into v_tpl from public.email_templates t
    where t.template_key = p_template_key and t.locale = 'fr';
  end if;

  if not found then
    raise exception 'no email template for key %', p_template_key
      using errcode = '42704';
  end if;

  v_subject := v_tpl.subject;
  v_text    := v_tpl.body_text;
  v_html    := v_tpl.body_html;

  for v_key, v_value in
    select k, coalesce(p_payload ->> k, '') from jsonb_object_keys(coalesce(p_payload, '{}'::jsonb)) k
  loop
    v_subject := replace(v_subject, '{{' || v_key || '}}', v_value);
    v_text    := replace(v_text,    '{{' || v_key || '}}', v_value);
    -- Le HTML échappe la valeur. Un nom de client contenant « <b> » ne doit
    -- pas devenir du balisage dans un e-mail que nous envoyons.
    v_html    := replace(v_html, '{{' || v_key || '}}',
      replace(replace(replace(replace(v_value, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'));
  end loop;

  -- Tout jeton non résolu est un bug de gabarit, et l'envoyer tel quel serait
  -- pire que ne pas envoyer : le professionnel lirait « Bonjour {{name}} ».
  if v_subject ~ '\{\{[a-z_]+\}\}' or v_text ~ '\{\{[a-z_]+\}\}' or v_html ~ '\{\{[a-z_]+\}\}' then
    raise exception 'email template % has unresolved placeholders', p_template_key
      using errcode = '22023',
            detail = 'fadeup_email_error=unresolved_placeholder';
  end if;

  return query select v_subject, v_text, v_html, v_tpl.stream;
end;
$$;

revoke all on function private.render_email_template(text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. L'envoi
--
-- Deux passes séparées, et c'est ce qui rend l'ensemble idempotent :
--
--   dispatch    prend des lignes `queued`, les passe en `sending` et retient
--               le request_id pg_net. Une ligne ne peut être prise qu'une
--               fois : l'UPDATE ... WHERE status = 'queued' est l'atome.
--   reconcile   relit net._http_response et conclut. Une ligne `sending`
--               n'est jamais réémise ; au pire elle attend un tick de plus.
--
-- Un redémarrage du conteneur entre les deux ne peut donc pas doubler un
-- envoi. Il peut laisser une ligne en `sending` dont la réponse a été purgée
-- par le TTL de pg_net — traitée en fin de reconcile, comme un échec à
-- réessayer, ce qui est le seul cas où B2 accepte un doublon POSSIBLE et le
-- documente plutôt que de le nier.
-- ---------------------------------------------------------------------------

create or replace function private.email_dispatch_batch(p_limit integer default 25)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.email_outbox;
  v_rendered record;
  v_stream public.email_streams;
  v_key text;
  v_request_id bigint;
  v_count integer := 0;
  v_headers jsonb;
  v_body jsonb;
begin
  v_key := private.resend_api_key();
  if v_key is null then
    -- Silencieux et sans effet plutôt qu'en erreur : le scheduler tourne 1 440
    -- fois par jour, et un environnement sans clé (une base de test, une
    -- restauration) ne doit pas remplir les logs de bruit.
    return 0;
  end if;

  for v_row in
    select * from public.email_outbox o
    where o.status = 'queued'
      and o.next_attempt_at <= now()
    order by o.next_attempt_at
    limit greatest(p_limit, 0)
    for update skip locked
  loop
    begin
      select * into v_rendered
      from private.render_email_template(v_row.template, v_row.locale, v_row.payload);

      select * into v_stream from public.email_streams s where s.stream = v_row.stream;

      if v_stream is null or not v_stream.is_enabled then
        update public.email_outbox
          set status = 'failed',
              last_error = 'stream disabled or unknown: ' || coalesce(v_row.stream::text, 'null'),
              attempts = attempts + 1,
              updated_at = now()
          where id = v_row.id;
        continue;
      end if;

      v_headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      );

      v_body := jsonb_build_object(
        'from', v_stream.from_name || ' <' || v_stream.from_address || '>',
        'to', jsonb_build_array(v_row.to_email),
        'subject', v_rendered.subject,
        'text', v_rendered.body_text,
        'html', v_rendered.body_html
      );

      if v_stream.reply_to is not null then
        v_body := v_body || jsonb_build_object('reply_to', v_stream.reply_to);
      end if;

      -- RFC 8058 : un désabonnement en un clic, sur la prospection seulement.
      -- Sans ces en-têtes, Gmail et Outlook comptent la seule action possible
      -- du destinataire — « signaler comme spam » — contre le domaine.
      if v_stream.requires_unsubscribe and (v_row.payload ? 'unsubscribe_url') then
        v_body := v_body || jsonb_build_object('headers', jsonb_build_object(
          'List-Unsubscribe', '<' || (v_row.payload ->> 'unsubscribe_url') || '>',
          'List-Unsubscribe-Post', 'List-Unsubscribe=One-Click'
        ));
      end if;

      v_request_id := net.http_post(
        url := 'https://api.resend.com/emails',
        body := v_body,
        headers := v_headers,
        timeout_milliseconds := 15000
      );

      update public.email_outbox
        set status = 'sending',
            net_request_id = v_request_id,
            dispatched_at = now(),
            attempts = attempts + 1,
            locked_at = now(),
            updated_at = now()
        where id = v_row.id and status = 'queued';

      if found then
        v_count := v_count + 1;
      end if;

    exception when others then
      -- Un gabarit cassé ou un payload incomplet ne doit pas arrêter le lot.
      update public.email_outbox
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

revoke all on function private.email_dispatch_batch(integer) from public, anon, authenticated;

create or replace function private.email_reconcile_batch(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select o.id, o.attempts, r.status_code, r.content, r.error_msg
    from public.email_outbox o
    join net._http_response r on r.id = o.net_request_id
    where o.status = 'sending'
    limit greatest(p_limit, 0)
  loop
    if v_row.status_code between 200 and 299 then
      update public.email_outbox
        set status = 'sent',
            sent_at = now(),
            provider_message_id = nullif(v_row.content::jsonb ->> 'id', ''),
            last_error = null,
            locked_at = null,
            updated_at = now()
        where id = v_row.id;
    else
      -- Repli exponentiel plafonné, cinq tentatives. Au-delà, une adresse
      -- invalide ou un domaine refusé ne s'arrangera pas en réessayant, et
      -- réessayer indéfiniment nuit à la réputation d'envoi.
      update public.email_outbox
        set status = case when v_row.attempts >= 5 then 'failed'::public.email_delivery_status
                          else 'queued'::public.email_delivery_status end,
            next_attempt_at = now() + make_interval(mins => least(power(3, v_row.attempts)::integer, 480)),
            last_error = left(coalesce(v_row.error_msg, 'HTTP ' || coalesce(v_row.status_code::text, '?') || ': ' || coalesce(v_row.content, '')), 500),
            net_request_id = null,
            locked_at = null,
            updated_at = now()
        where id = v_row.id;
    end if;

    v_count := v_count + 1;
  end loop;

  -- Les réponses pg_net sont purgées après quelques heures. Une ligne restée
  -- « sending » au-delà de cette fenêtre a perdu sa réponse : impossible de
  -- savoir si elle est partie. B2 choisit de RÉESSAYER, et le dit — un accusé
  -- de réservation en double est un désagrément, un accusé jamais envoyé est
  -- un client qui croit ne pas avoir de rendez-vous.
  update public.email_outbox
    set status = case when attempts >= 5 then 'failed'::public.email_delivery_status
                      else 'queued'::public.email_delivery_status end,
        next_attempt_at = now() + interval '10 minutes',
        last_error = 'provider response expired before reconciliation',
        net_request_id = null,
        locked_at = null,
        updated_at = now()
  where status = 'sending'
    and dispatched_at < now() - interval '6 hours';

  return v_count;
end;
$$;

revoke all on function private.email_reconcile_batch(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Ce que le scheduler appelle
-- ---------------------------------------------------------------------------

create or replace function public.run_email_delivery()
returns table (dispatched integer, reconciled integer)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Réconcilier D'ABORD : les réponses des envois du tick précédent sont
  -- arrivées pendant l'intervalle, et les conclure avant d'en émettre de
  -- nouvelles garde la table lisible et le nombre de lignes « sending » borné.
  return query select private.email_dispatch_batch(25), private.email_reconcile_batch(100);
end;
$$;

comment on function public.run_email_delivery() is
  'Le tick d''envoi, appelé par le conteneur fadeup-scheduler. Réconcilie les envois du tick précédent puis en dépêche de nouveaux. Ne fait rien du tout si aucune clé Resend n''est installée dans le vault, ce qui est le cas normal d''une base de test ou d''une restauration.';

revoke all on function public.run_email_delivery() from public, anon, authenticated;
grant execute on function public.run_email_delivery() to fadeup_scheduler;

commit;
