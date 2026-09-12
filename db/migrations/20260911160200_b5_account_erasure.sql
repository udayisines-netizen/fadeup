-- B5 — chantier 1 : la suppression de compte en libre-service (et l'export).
--
-- À APPLIQUER EN postgres. Les cinq gardes redéfinies ici appartiennent
-- toutes à postgres (proowner mesuré : restrict_appointment_self_update,
-- restrict_queue_entry_self_update, guard_customers_identity,
-- reviews_guard_immutable, reject_analytics_event_mutation) — doctrine
-- DB_OWNERSHIP §2 règle 2 respectée, aucune moitié de migration.
--
-- ===========================================================================
-- CE QUE CE FICHIER TRANCHE
-- ===========================================================================
--
-- 1. L'HISTORIQUE EST ANONYMISÉ, PAS SUPPRIMÉ.
--    Un rendez-vous passé n'appartient pas qu'au client : c'est la
--    comptabilité du salon, sa fiche client, son chiffre d'affaires, la durée
--    réelle qui nourrit son estimation de file. L'effacer réécrirait le passé
--    d'un tiers qui n'a rien demandé. Les LIGNES restent donc en place et
--    gardent tous leurs faits comptables (date, service, barber, statut,
--    durée) ; seules les colonnes qui NOMMENT une personne sont neutralisées.
--
-- 2. LES AVIS RESTENT VISIBLES, ANONYMISÉS.
--    Un avis porte la réputation d'un professionnel. Le supprimer laisserait
--    un client modifier silencieusement la note d'un salon en fermant son
--    compte — exactement le préjudice que ce lot interdit. La note et le
--    texte survivent donc ; l'identité de l'auteur part (customer_user_id
--    passe à NULL, reviewer_display_name au jeton d'effacement). Le trigger
--    reviews_maintain_reputation ne réagit qu'à INSERT/DELETE/UPDATE OF
--    status : l'anonymisation ne touche pas au statut, donc les agrégats de
--    réputation ne bougent pas d'un centième. C'est la preuve mécanique que
--    le professionnel n'est pas lésé.
--    RÉSIDU DÉCLARÉ : un texte d'avis où l'auteur se serait nommé lui-même
--    reste tel quel. Réécrire du texte libre serait falsifier un avis publié ;
--    le signalement (report_review) est le chemin prévu pour ce cas.
--
-- 3. LES PHOTOS PARTENT VRAIMENT — ET C'EST UNE PRÉCONDITION, PAS UNE PROMESSE.
--    Le backend de stockage est un backend FICHIER (STORAGE_BACKEND=file,
--    /var/lib/storage, mesuré) : supprimer la ligne storage.objects en SQL
--    laisserait le fichier sur le disque. Un appel pg_net vers l'API Storage
--    échouerait à l'envers (la ligne serait déjà partie) et, surtout, serait
--    asynchrone : le compte serait effacé sans qu'on sache si la photo l'est.
--    Ce serait un échec OUVERT sur la seule donnée que le lot qualifie de
--    « personnelle au sens fort ».
--    Donc l'inverse : delete_my_account REFUSE tant qu'il reste un objet de
--    stockage à l'appelant (fadeup_erasure_refusal=media_not_purged, avec le
--    compte). Le client les supprime d'abord par l'API Storage — qui efface
--    la ligne ET le fichier, et pour laquelle il a déjà les policies
--    (passport_photos_delete_own, review_photos_objects_delete_own,
--    post_media_objects_delete_own, toutes indexées sur {uid}/…) — puis
--    rappelle la RPC. L'effacement des photos devient VÉRIFIABLE au lieu
--    d'être espéré, et l'échec est fermé : pas de photo purgée, pas de
--    compte effacé.
--
-- 4. LES JOURNAUX EN AJOUT SEUL : UNE SEULE EXCEPTION, ÉTROITE ET MESURÉE.
--    - platform_audit_log, commercial_plan_changes, service_mode_changes
--      NE SONT PAS TOUCHÉS. Leur commentaire dit « aucune exemption de rôle,
--      volontairement » et ce fichier ne le contredit pas. Ils ne sont jamais
--      atteints, parce que la RPC refuse les comptes d'entreprise (§5) : un
--      client n'y écrit jamais une ligne. Vérifié, pas supposé.
--    - analytics_events porte actor_user_id, et c'est le plus gros volume de
--      données comportementales rattachées à la personne (3 236 lignes en
--      production). Le laisser serait garder une clé pseudonyme stable avec
--      laquelle tout le parcours se reconstitue. Elle passe donc à NULL.
--      La table avait DÉJÀ une exemption par GUC pour le DELETE
--      (fadeup.analytics_retention_purge) : l'ajout d'une exemption
--      d'effacement est dans son dessin, pas contre lui.
--      COÛT DÉCLARÉ : get_organization_analytics_summary compte
--      unique_authenticated_viewers en distinct actor_user_id — ce visiteur
--      unique disparaît du compte. C'est exact : il n'existe plus.
--      unique_customers, lui, compte customer_id, qui survit (anonymisé) :
--      les agrégats client du salon ne bougent pas.
--    - audit_logs.actor_user_id n'a besoin de rien : sa clé étrangère est
--      ON DELETE SET NULL et aucune garde d'ajout seul ne la protège.
--
--    L'IMMUTABILITÉ DEVIENT DONC, EXPLICITEMENT : « aucun champ ne peut être
--    réécrit, SAUF l'effacement à NULL d'un identifiant personnel, par le
--    chemin d'effacement ». La garde ne fait pas confiance à un drapeau : la
--    fonction private.erasure_update_allowed() compare l'ANCIENNE et la
--    NOUVELLE ligne clé par clé et n'autorise que (a) les colonnes nommées,
--    (b) vers NULL ou vers le jeton d'effacement, (c) rien d'autre ne bouge,
--    (d) avec le GUC posé, (e) sous le rôle propriétaire. Mesuré : ni anon ni
--    authenticated n'ont le moindre UPDATE sur analytics_events ni sur
--    reviews — l'exemption n'est atteignable par aucun client PostgREST.
--
-- 5. LE DÉLAI : IMMÉDIAT ET DÉFINITIF. Pas de fenêtre de trente jours.
--    Une fenêtre d'annulation oblige à CONSERVER trente jours l'e-mail, le
--    téléphone et le nom de quelqu'un qui vient de demander leur effacement,
--    et il faut justifier cette rétention. Ce qu'elle protège en échange —
--    le regret, la prise de contrôle du compte — elle le protège mal ici :
--    l'authentification FadeUp est un code par e-mail, donc l'attaquant qui
--    peut supprimer peut aussi annuler. Et FadeUp ne détient pour un client
--    ni argent, ni contenu publié qu'il pleurerait (aucune publication
--    client, aucune messagerie) : le regret porte sur un historique et un
--    Passport. Le RGPD demande l'effacement « sans retard injustifié » ;
--    immédiat est la posture la plus simple à défendre, et la plus simple à
--    prouver — ce que fait verify_b5.sql, table par table, dans une seule
--    transaction.
--    CONTREPARTIE ASSUMÉE : l'opération est irréversible. La confirmation
--    est donc la responsabilité de l'interface, et le rapport le dit.
--
-- 6. LA TRACE NE CONTIENT AUCUNE DONNÉE PERSONNELLE — pas même l'UUID.
--    public.account_erasure_log enregistre QUAND, PAR QUI et QUEL PÉRIMÈTRE :
--    l'horodatage, le type d'acteur ('self' — la RPC n'efface jamais que son
--    appelant, il n'existe pas d'autre acteur possible), et un objet de
--    COMPTEURS par table. Aucun user_id, aucun e-mail, aucun condensat :
--    un UUID conservé ici resterait un identifiant rattachable aux lignes
--    anonymisées, ce qui annulerait l'anonymisation qu'il est censé tracer.
--    Le reçu rendu à l'appelant (erasure_id) est la preuve côté personne.
--    La table est elle-même en ajout seul.
--
-- ===========================================================================
-- 7. CE QUE LA RPC REFUSE, ET POURQUOI CE SONT DES REFUS ET PAS DES SILENCES
--    (tous NOMMÉS, motif fadeup_erasure_refusal=… , motif F1/F4 verbatim) :
--    - not_authenticated   uid NULL. Le motif nul traité en tête, jamais un
--                          effacement silencieux de rien.
--    - business_account    l'appelant est membre d'une organisation, membre
--                          de la plateforme, professionnel revendiqué ou
--                          fiche staff. Supprimer ce compte orphelinerait une
--                          organisation, son personnel et les rendez-vous de
--                          SES clients, et toucherait les journaux en ajout
--                          seul qu'on refuse de percer (§4). La suppression
--                          d'un compte professionnel est un autre problème,
--                          plus gros, HORS PÉRIMÈTRE B5 — et le dire est plus
--                          honnête que de l'improviser ici.
--    - active_commitments  une file en cours (waiting/called/in_service) ou
--                          un rendez-vous FUTUR non résolu. Les effacer
--                          laisserait au salon un créneau tenu par un
--                          fantôme injoignable. Le client peut toujours s'en
--                          sortir seul : quitter la file (F1b), annuler le
--                          rendez-vous — donc le refus ne piège personne.
--    - media_not_purged    voir §3.
--
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Le socle d'effacement : jeton, drapeau, et LA fonction de comparaison.
-- ---------------------------------------------------------------------------

create or replace function private.erasure_display_sentinel()
returns text
language sql
immutable
set search_path = ''
as $$ select '[deleted]'::text $$;

comment on function private.erasure_display_sentinel() is
  'Le jeton qui remplace un nom dans une colonne NOT NULL après effacement de compte. Volontairement ASCII et non localisé : il traverse des surfaces (agenda pro, fiche client) que ce lot n''a pas le droit de toucher, et « [deleted] » y reste lisible dans toutes les langues. Une valeur localisée aurait figé une langue dans la donnée.';

create or replace function private.account_erasure_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('fadeup.account_erasure', true), '') = 'on'
     and current_user in ('postgres', 'supabase_admin');
$$;

comment on function private.account_erasure_active() is
  'Vrai seulement à l''intérieur de private.erase_customer_account(). Deux conditions, pas une : le GUC transactionnel ET le rôle propriétaire. current_user vaut le PROPRIÉTAIRE dans un SECURITY DEFINER, et ''authenticated'' sur tout accès direct PostgREST — un client qui poserait le GUC lui-même ne franchit donc pas cette porte. Ce n''est pas la protection principale : celle-là est private.erasure_update_allowed(), qui compare la ligne colonne par colonne.';

create or replace function private.erasure_update_allowed(
  p_old jsonb,
  p_new jsonb,
  p_allowed jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.account_erasure_active()
     and not exists (
       select 1
       from jsonb_each(p_old) o
       full join jsonb_each(p_new) n on n.key = o.key
       where o.value is distinct from n.value
         and (
              o.key is null                       -- colonne apparue
           or n.key is null                       -- colonne disparue
           or not (p_allowed ? o.key)             -- colonne non autorisée
           or not exists (                        -- valeur non autorisée
                select 1
                from jsonb_array_elements(p_allowed -> o.key) e
                where e.value is not distinct from n.value)
         )
     );
$$;

comment on function private.erasure_update_allowed(jsonb, jsonb, jsonb) is
  'LA garde des exemptions d''effacement. p_allowed est un objet colonne -> TABLEAU DES VALEURS AUTORISÉES pour elle. Rend vrai seulement si TOUTE différence entre l''ancienne et la nouvelle ligne porte sur une colonne nommée dans cet objet, ET remplace sa valeur par l''une des valeurs énumérées pour elle. Une colonne non nommée qui bouge, une valeur non énumérée, une colonne apparue ou disparue : faux. C''est ce qui fait que l''exemption ne peut pas servir à réécrire un journal — seulement à en retirer un identifiant. Énumérer les valeurs plutôt que de dire « NULL ou le jeton » est ce qui permet à analytics_events de passer actor_type à ''anonymous'' — sa contrainte analytics_events_actor_coherent INTERDIT un acteur ''customer'' sans identifiant — sans ouvrir cette colonne à autre chose.';

-- Les trois fonctions ci-dessus sont lues par des gardes de trigger qui ne
-- sont PAS security definer (reject_analytics_event_mutation,
-- reject_support_ticket_message_mutation, restrict_appointment_self_update,
-- restrict_queue_entry_self_update, reviews_guard_immutable) : elles
-- s'évaluent donc sous le rôle appelant, et sans `execute` ce rôle se voit
-- refuser SA PROPRE garde — 403 « permission denied for function
-- erasure_display_sentinel ». Défaut de la première écriture de ce fichier,
-- trouvé EN PRODUCTION par OS-2 (« Appeler le suivant », mise à jour d'un
-- rendez-vous par un barber, écriture d'un avis, cassés pour tous les rôles
-- pro) et réparé par 20260911220000_os2_hotfix_b5_private_grants.sql, qui
-- restera sans effet une fois ces grants-ci en place. Ils sont réinscrits
-- ici, au point de naissance des fonctions, pour qu'un rejeu à blanc de la
-- seule branche B5 ne reproduise pas la régression.
--
-- Concédant vérifié : les trois fonctions appartiennent à postgres, et cette
-- migration s'applique EN postgres — le grant n'est donc pas un no-op.
--
-- Accorder l'exécution n'accorde aucun pouvoir. account_erasure_active()
-- exige le GUC transactionnel ET current_user in (postgres, supabase_admin) :
-- évaluée sous `authenticated`, elle rend toujours faux. erasure_update_allowed()
-- est un prédicat pur sur des valeurs que l'appelant détient déjà, et il
-- commence par account_erasure_active(). erasure_display_sentinel() rend une
-- constante. Le rôle regagne seulement le droit d'évaluer la garde qui le
-- contraint. `anon` n'en reçoit rien : aucun chemin anonyme n'atteint ces
-- gardes (ni anon ni authenticated n'ont le moindre UPDATE sur les cinq
-- tables concernées — mesuré), et la suite x3_anon_surface.sh --strict le
-- couvre.
grant execute on function private.erasure_display_sentinel() to authenticated;
grant execute on function private.account_erasure_active() to authenticated;
grant execute on function private.erasure_update_allowed(jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Les cinq gardes, chacune munie de SON exemption étroite.
--    CREATE OR REPLACE : propriétaire, ACL et corps restant identiques hors
--    le bloc ajouté en tête — le reste est copié VERBATIM de la production.
-- ---------------------------------------------------------------------------

create or replace function public.reject_analytics_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    -- B5 : l'unique exception, et elle ne peut retirer qu'un identifiant.
    -- Tout le reste de la ligne — l'événement, l'horodatage, l'organisation,
    -- les propriétés — doit être rigoureusement identique.
    -- actor_type DOIT suivre : analytics_events_actor_coherent interdit un
    -- acteur 'customer' sans identifiant. Un événement désidentifié est
    -- exactement un événement anonyme, et le dire est plus juste que de
    -- laisser un type d'acteur qui ne correspond plus à rien.
    -- dedupe_key aussi : certaines clés d'idempotence portent l'identifiant
    -- EN TEXTE ('organization_follow:<org>:<uid>') — invisible d'un balayage
    -- de colonnes uuid, et tout aussi rattachable.
    if private.erasure_update_allowed(
         to_jsonb(old), to_jsonb(new),
         jsonb_build_object(
           'actor_user_id', jsonb_build_array(null),
           'actor_type', jsonb_build_array('anonymous'),
           'dedupe_key', jsonb_build_array(null))
       ) then
      return new;
    end if;

    raise exception 'analytics_events is append-only: a recorded event cannot be modified'
      using errcode = '22023';
  end if;

  if coalesce(current_setting('fadeup.analytics_retention_purge', true), '') <> 'on' then
    raise exception 'analytics_events is append-only: events are removed only by the retention purge'
      using errcode = '22023';
  end if;

  return old;
end;
$$;

create or replace function public.reviews_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- B5 : effacement de compte. L'avis reste — note, texte, statut,
  -- réponse du salon, horodatages — seule l'identité de l'auteur part.
  if private.erasure_update_allowed(
       to_jsonb(old), to_jsonb(new),
       jsonb_build_object(
         'customer_user_id', jsonb_build_array(null),
         'reviewer_display_name',
           jsonb_build_array(private.erasure_display_sentinel()))
     ) then
    return new;
  end if;

  if new.appointment_id  is distinct from old.appointment_id
     or new.customer_user_id is distinct from old.customer_user_id
     or new.professional_id  is distinct from old.professional_id
     or new.organization_id  is distinct from old.organization_id
     or new.rating           is distinct from old.rating
     or new.comment          is distinct from old.comment
     or new.reviewer_display_name is distinct from old.reviewer_display_name
     or new.source           is distinct from old.source
     or new.external_attribution is distinct from old.external_attribution
     or new.created_at       is distinct from old.created_at then
    raise exception 'review core fields are immutable once submitted';
  end if;
  if old.reply_body is not null
     and (new.reply_body is distinct from old.reply_body
          or new.replied_at is distinct from old.replied_at
          or new.replied_by_user_id is distinct from old.replied_by_user_id) then
    raise exception 'a review reply is written once — one public reply per review';
  end if;
  return new;
end;
$$;

create or replace function public.guard_customers_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.user_id is not distinct from old.user_id then
    return new;
  end if;

  -- B5 : le détachement de la fiche client d'un compte effacé. C'est une
  -- action de la clé étrangère (ON DELETE SET NULL), qui traverse ce
  -- trigger comme un UPDATE ordinaire. Seul user_id -> NULL passe.
  if private.erasure_update_allowed(
       to_jsonb(old), to_jsonb(new),
       jsonb_build_object('user_id', jsonb_build_array(null))
     ) then
    return new;
  end if;

  -- X3 : l'absence de JWT n'exempte que les sessions serveur — jamais le
  -- rôle-claim 'anon' d'un client PostgREST.
  if ((select auth.uid()) is null
      and coalesce((select auth.role()), '') not in ('anon', 'authenticated'))
     or (select private.is_platform_admin()) then
    return new;
  end if;

  raise exception 'customers.user_id identifies the account that owns this record and cannot be reassigned by a shop'
    using errcode = '42501';
end;
$$;

create or replace function public.restrict_appointment_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- B5 : effacement de compte. Les faits comptables du rendez-vous
  -- (date, service, barber, statut, durée) sont intouchables ; seules les
  -- colonnes de contact et la note libre partent.
  if private.erasure_update_allowed(
       to_jsonb(old), to_jsonb(new),
       jsonb_build_object(
         'customer_name', jsonb_build_array(private.erasure_display_sentinel()),
         'customer_phone', jsonb_build_array(null),
         'customer_email', jsonb_build_array(null),
         'notes', jsonb_build_array(null),
         'booked_by_user_id', jsonb_build_array(null),
         'created_by', jsonb_build_array(null),
         'decided_by', jsonb_build_array(null),
         'overlap_forced_by', jsonb_build_array(null))
     ) then
    return new;
  end if;

  -- Managing roles keep full edit rights untouched by this trigger.
  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  -- public.reschedule_appointment() raises this for the single UPDATE it
  -- performs, after verifying the caller owns the appointment or manages the
  -- organization. current_setting(..., true) yields null when it was never
  -- set, so every ordinary path falls through to the restriction below.
  if coalesce(current_setting('fadeup.appointment_reschedule', true), '') = 'on' then
    return new;
  end if;

  -- Everyone else who could reach this far already passed RLS as "the
  -- assigned barber" (appointments_update_self) — restrict them to status
  -- and notes only.
  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.chair_id is distinct from old.chair_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
    or new.customer_email is distinct from old.customer_email
    or new.starts_at is distinct from old.starts_at
    or new.ends_at is distinct from old.ends_at
    or new.buffer_before_minutes is distinct from old.buffer_before_minutes
    or new.buffer_after_minutes is distinct from old.buffer_after_minutes
  then
    raise exception 'a barber may only update status and notes on their own appointments';
  end if;

  return new;
end;
$$;

create or replace function public.restrict_queue_entry_self_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- B5 : effacement de compte, même règle que pour les rendez-vous.
  if private.erasure_update_allowed(
       to_jsonb(old), to_jsonb(new),
       jsonb_build_object(
         'customer_name', jsonb_build_array(private.erasure_display_sentinel()),
         'customer_phone', jsonb_build_array(null),
         'notes', jsonb_build_array(null),
         'booked_by_user_id', jsonb_build_array(null),
         'created_by', jsonb_build_array(null))
     ) then
    return new;
  end if;

  -- Une RPC de déplacement F1b (move_queue_entry) a déjà vérifié le droit —
  -- y compris pour un barber qui déplace vers un CONFRÈRE, ce que la règle
  -- ci-dessous interdit à raison en accès direct.
  if coalesce(current_setting('fadeup.queue_move', true), '') = '1' then
    return new;
  end if;

  if (select private.has_org_role(new.organization_id, array['owner', 'manager', 'receptionist']::public.membership_role[])) then
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id
    or new.location_id is distinct from old.location_id
    or new.barber_id is distinct from old.barber_id
    or new.service_id is distinct from old.service_id
    or new.customer_name is distinct from old.customer_name
    or new.customer_phone is distinct from old.customer_phone
  then
    raise exception 'a barber may only update status, timestamps and notes on their own queue entries';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Les avis peuvent désormais SURVIVRE à leur auteur.
--    customer_user_id était NOT NULL + ON DELETE CASCADE : la suppression du
--    compte emportait l'avis, donc la réputation du professionnel. La
--    contrainte est RELÂCHÉE (nullable) et l'action de la clé étrangère
--    devient SET NULL — un élargissement, jamais un rétrécissement : aucune
--    ligne existante ne peut le violer. reviewer_display_name reste NOT NULL
--    et reçoit le jeton : le rendre nullable aurait fait basculer son type
--    généré (string -> string | null) dans des écrans pro que ce lot n'a pas
--    le droit de toucher (OS-2 y travaille en parallèle).
-- ---------------------------------------------------------------------------

alter table public.reviews
  alter column customer_user_id drop not null;

alter table public.reviews
  drop constraint reviews_customer_user_id_fkey;

alter table public.reviews
  add constraint reviews_customer_user_id_fkey
  foreign key (customer_user_id) references auth.users(id) on delete set null;

comment on column public.reviews.customer_user_id is
  'Auteur de l''avis. NULL après effacement de son compte (B5) : l''avis reste publié, sa note continue de compter dans la réputation, mais il n''est plus rattaché à personne. NULL ne signifie donc jamais « avis anonyme à la publication » — submit_review exige une session.';

-- ---------------------------------------------------------------------------
-- 4. La trace. En ajout seul, et sans une seule donnée personnelle.
-- ---------------------------------------------------------------------------

create table if not exists public.account_erasure_log (
  id uuid primary key default gen_random_uuid(),
  erased_at timestamptz not null default now(),
  actor_kind text not null default 'self',
  requested_via text not null default 'delete_my_account',
  account_kind text not null default 'customer',
  scope jsonb not null default '{}'::jsonb,
  constraint account_erasure_log_actor_kind_check
    check (actor_kind in ('self')),
  constraint account_erasure_log_scope_is_object
    check (jsonb_typeof(scope) = 'object')
);

comment on table public.account_erasure_log is
  'Trace des suppressions de compte : QUAND (erased_at), PAR QUI (actor_kind — ''self'' est la seule valeur possible, delete_my_account n''efface jamais que son propre appelant), et QUEL PÉRIMÈTRE (scope : des COMPTEURS par table). Volontairement DÉPOURVUE de tout identifiant — pas d''user_id, pas d''e-mail, pas de condensat : un identifiant conservé ici resterait rattachable aux lignes qu''on vient d''anonymiser, et annulerait l''anonymisation qu''il prétend tracer. La preuve côté personne est le reçu (id) rendu par la RPC. Table en ajout seul.';

comment on column public.account_erasure_log.scope is
  'Compteurs par table de ce qui a été supprimé ou anonymisé, plus les drapeaux booléens du périmètre. Des nombres, jamais des lignes ni des clés.';

create or replace function public.reject_account_erasure_log_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'account_erasure_log est en ajout seul : % n''est pas permis', tg_op
    using errcode = '42501';
end;
$$;

comment on function public.reject_account_erasure_log_mutation() is
  'Aucune exemption de rôle, volontairement — motif de reject_commercial_history_mutation(). Une trace d''effacement que l''on peut effacer ne trace rien. Cette table n''a AUCUNE exemption d''effacement de compte (§4 de la migration) parce qu''elle ne contient aucune donnée personnelle à effacer.';

drop trigger if exists account_erasure_log_append_only on public.account_erasure_log;
create trigger account_erasure_log_append_only
  before update or delete on public.account_erasure_log
  for each row execute function public.reject_account_erasure_log_mutation();

drop trigger if exists account_erasure_log_append_only_truncate on public.account_erasure_log;
create trigger account_erasure_log_append_only_truncate
  before truncate on public.account_erasure_log
  for each statement execute function public.reject_account_erasure_log_mutation();

alter table public.account_erasure_log enable row level security;
alter table public.account_erasure_log force row level security;

-- Aucune policy : la table n'est lisible par aucun rôle client. Elle n'a
-- d'ailleurs aucun grant (les défauts durcis de X3 n'en donnent plus), ce que
-- x3_anon_surface.sh revérifie en balayant les 130+ tables en anon ET en
-- authentifié sans droit.

-- ---------------------------------------------------------------------------
-- 5. L'inventaire des refus, mesuré avant d'effacer quoi que ce soit.
-- ---------------------------------------------------------------------------

create or replace function private.account_erasure_blockers(p_user_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'memberships', (
      select count(*) from public.memberships m where m.user_id = p_user_id),
    'platform_member', (
      select count(*) from public.platform_members pm where pm.user_id = p_user_id),
    'professional', (
      select count(*) from public.professionals p where p.user_id = p_user_id),
    'staff_profiles', (
      select count(*) from public.staff_profiles sp where sp.user_id = p_user_id),
    'active_queue_entries', (
      select count(*) from public.queue_entries q
      where q.booked_by_user_id = p_user_id
        and q.status in ('waiting', 'called', 'in_service')),
    'future_appointments', (
      select count(*) from public.appointments a
      where a.booked_by_user_id = p_user_id
        and a.status in ('pending', 'confirmed')
        and a.starts_at > now()),
    'storage_objects', (
      select count(*) from storage.objects o
      where (storage.foldername(o.name))[1] = p_user_id::text)
  );
$$;

comment on function private.account_erasure_blockers(uuid) is
  'Ce qui empêche l''effacement du compte, en compteurs. Mesuré AVANT toute écriture, pour que le refus soit nommé et chiffré plutôt que découvert au milieu du travail. p_user_id NULL rend des zéros partout — l''appelant traite le cas nul avant d''arriver ici, jamais l''inverse.';

-- ---------------------------------------------------------------------------
-- 6. L'effaceur. Jamais atteignable par un rôle client : aucun grant.
-- ---------------------------------------------------------------------------

create or replace function private.erase_customer_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope jsonb := '{}'::jsonb;
  v_emails text[];
  v_sentinel text := private.erasure_display_sentinel();
  v_customer_ids uuid[];
  v_request_ids uuid[];
  v_review_ids uuid[];
  v_appointment_ids uuid[];
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'private.erase_customer_account requires a user id'
      using errcode = '22023';
  end if;

  -- Le drapeau d'effacement, TRANSACTIONNEL (troisième argument true) : il
  -- disparaît avec la transaction, qu'elle réussisse ou non.
  perform set_config('fadeup.account_erasure', 'on', true);

  -- Toutes les adresses par lesquelles ce compte a pu recevoir un e-mail.
  select array_remove(array_agg(distinct lower(e)), null) into v_emails
  from (
    select u.email::text as e from auth.users u where u.id = p_user_id
    union all
    select cp.email from public.customer_profiles cp where cp.user_id = p_user_id
  ) s;

  select array_remove(array_agg(c.id), null) into v_customer_ids
  from public.customers c where c.user_id = p_user_id;

  -- 6.1 La fiche client du salon : elle RESTE (c'est sa comptabilité), elle
  --     ne nomme plus personne.
  update public.customers c
     set name = v_sentinel, phone = null, email = null, notes = null
   where c.user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('customers_anonymised', v_n);

  -- 6.2 Les rendez-vous. Les faits comptables restent intacts.
  select array_remove(array_agg(a.id), null) into v_appointment_ids
  from public.appointments a
  where a.booked_by_user_id = p_user_id
     or (v_customer_ids is not null and a.customer_id = any(v_customer_ids));

  update public.appointments a
     set customer_name = v_sentinel,
         customer_phone = null,
         customer_email = null,
         notes = null
   where a.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and a.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('appointments_anonymised', v_n);

  -- 6.3 Les files.
  update public.queue_entries q
     set customer_name = v_sentinel,
         customer_phone = null,
         notes = null
   where q.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('queue_entries_anonymised', v_n);

  -- 6.4 Les listes d'attente.
  update public.waitlist_entries w
     set customer_name = v_sentinel,
         customer_phone = null,
         customer_email = null,
         notes = null
   where w.created_by = p_user_id
      or (v_customer_ids is not null and w.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('waitlist_entries_anonymised', v_n);

  -- 6.5 Les avis : ils restent publiés, leur auteur part. Les identifiants
  --     sont capturés AVANT l'anonymisation — après, plus rien ne distingue
  --     les avis de ce compte de ceux d'un compte effacé la semaine passée.
  select array_remove(array_agg(r.id), null) into v_review_ids
  from public.reviews r where r.customer_user_id = p_user_id;

  update public.reviews r
     set customer_user_id = null,
         reviewer_display_name = v_sentinel
   where r.customer_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('reviews_anonymised', v_n);

  -- 6.6 Les demandes d'intérêt (profils non revendiqués, F4) : le contact
  --     part en entier, la demande garde sa trace sans nommer personne.
  select array_remove(array_agg(pirc.request_id), null) into v_request_ids
  from public.professional_interest_request_contacts pirc
  where pirc.booked_by_user_id = p_user_id
     or (v_emails is not null and lower(pirc.customer_email) = any(v_emails));

  if v_request_ids is not null and array_length(v_request_ids, 1) > 0 then
    delete from public.professional_interest_request_contacts pirc
     where pirc.request_id = any(v_request_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('interest_contacts_deleted', v_n);

    update public.professional_interest_requests pir
       set customer_display_name = v_sentinel, notes = null
     where pir.id = any(v_request_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('interest_requests_anonymised', v_n);
  else
    v_scope := v_scope || jsonb_build_object(
      'interest_contacts_deleted', 0, 'interest_requests_anonymised', 0);
  end if;

  -- 6.7 Les photos d'avis : les objets de stockage sont DÉJÀ partis (c'est la
  --     précondition media_not_purged) ; les lignes qui les référençaient
  --     partent avec, sinon l'avis pointerait vers un fichier absent.
  if v_review_ids is not null and array_length(v_review_ids, 1) > 0 then
    delete from public.review_photos rp where rp.review_id = any(v_review_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('review_photos_deleted', v_n);

  -- 6.7bis Les notifications reçues par le SALON. Elles ne sont pas rattachées
  --     au compte effacé (leur user_id est celui d'un membre de
  --     l'organisation) : la cascade ne les emporte pas, et deux d'entre
  --     elles portent quand même la personne.
  --       * les notifications de réservation ont pour CORPS le nom du client
  --         (private.emit_booking_notification) et pointent vers le
  --         rendez-vous : le corps reçoit le jeton, la notification reste.
  --       * les notifications sociales (nouveau follower, like, avis) ont un
  --         corps générique mais une CLÉ DE DÉDUPLICATION qui contient
  --         l'identifiant de l'auteur en toutes lettres
  --         ('new_follower:organization:<org>:<uid>:<membre>') : l'identifiant
  --         y survivrait en TEXTE, invisible d'un balayage de colonnes uuid.
  --         Elles sont supprimées — ce sont des éléments de boîte de
  --         réception, pas des écritures comptables.
  if v_appointment_ids is not null and array_length(v_appointment_ids, 1) > 0 then
    update public.notifications n
       set body = v_sentinel
     where n.appointment_id = any(v_appointment_ids)
       and n.body is not null
       and n.body <> v_sentinel;
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('shop_notifications_anonymised', v_n);

  delete from public.notifications n
   where n.dedupe_key like '%' || p_user_id::text || '%';
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('shop_notifications_deleted', v_n);

  -- 6.8 Les e-mails transactionnels : to_email est une adresse, payload porte
  --     customer_name. C'est une file d'envoi, pas un registre comptable :
  --     les lignes partent.
  if v_emails is not null and array_length(v_emails, 1) > 0 then
    delete from public.email_outbox eo where lower(eo.to_email) = any(v_emails);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('email_outbox_deleted', v_n);

  -- 6.9 Le compte lui-même. Emporte en cascade : customer_profiles (dont
  --     gender et haircut_frequency), customer_passports, ses photos, ses
  --     partages, favoris, abonnements (organisations et professionnels),
  --     likes, notifications, signalements, relations client-professionnel,
  --     profiles (full_name, avatar_url), candidatures et revendications
  --     professionnelles, et toute la surface auth (identities, sessions,
  --     jetons, facteurs MFA). Et met à NULL, par action de clé étrangère,
  --     les colonnes d'acteur restantes (audit_logs, jetons de réclamation,
  --     customers.user_id…).
  delete from auth.users u where u.id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('auth_users_deleted', v_n);

  -- 6.10 Le journal analytique, EN DERNIER : la cascade ci-dessus déclenche
  --      elle-même des écritures analytiques (customer_favorites émet un
  --      événement AFTER DELETE). Nettoyer avant les aurait manquées.
  update public.analytics_events ae
     set actor_user_id = null,
         actor_type = 'anonymous'
   where ae.actor_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('analytics_events_deidentified', v_n);

  update public.analytics_events ae
     set dedupe_key = null
   where ae.dedupe_key like '%' || p_user_id::text || '%';
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('analytics_dedupe_keys_cleared', v_n);

  return v_scope;
end;
$$;

comment on function private.erase_customer_account(uuid) is
  'L''effaceur. AUCUN grant : ni anon, ni authenticated, ni service_role ne peuvent l''appeler — c''est ce qui fait qu''un utilisateur ne peut pas effacer le compte d''un autre en contournant public.delete_my_account(). Ne vérifie AUCUN droit et ne doit jamais en vérifier : c''est son appelant public qui décide de qui il parle, et il ne parle que de son propre appelant. Suppose les préconditions déjà mesurées (private.account_erasure_blockers).';

-- ---------------------------------------------------------------------------
-- 7. La RPC publique. AUCUN PARAMÈTRE — et c'est la garantie principale.
--
--    « Un utilisateur ne supprime que son propre compte » n'est pas ici une
--    vérification qu'on pourrait oublier d'écrire : il n'existe pas d'endroit
--    où passer l'identifiant d'autrui. La cible est auth.uid(), point. Un
--    appel avec un paramètre forgé n'atteint aucune fonction (PostgREST ne
--    résout pas la signature) ; l'effaceur qui, lui, prend un identifiant
--    n'est concédé à personne. Les deux moitiés sont testées
--    (db/tests/verify_b5.sql section C).
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns table (
  erasure_id uuid,
  erased_at timestamptz,
  scope jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_blockers jsonb;
  v_scope jsonb;
  v_id uuid;
  v_at timestamptz;
begin
  v_user_id := auth.uid();

  -- LE MOTIF NUL, traité en tête : pas de session, pas d'effacement, et un
  -- refus nommé plutôt qu'un succès vide sur zéro ligne.
  if v_user_id is null then
    raise exception 'fadeup_erasure_refusal=not_authenticated'
      using errcode = '42501';
  end if;

  v_blockers := private.account_erasure_blockers(v_user_id);

  if (v_blockers ->> 'memberships')::int > 0
     or (v_blockers ->> 'platform_member')::int > 0
     or (v_blockers ->> 'professional')::int > 0
     or (v_blockers ->> 'staff_profiles')::int > 0 then
    raise exception 'fadeup_erasure_refusal=business_account'
      using errcode = '42501',
            detail = v_blockers::text,
            hint = 'Un compte qui fait tourner une organisation ne peut pas être effacé en libre-service : sa suppression orphelinerait l''organisation, son personnel et les rendez-vous de ses clients. Transférez la propriété, puis recommencez.';
  end if;

  if (v_blockers ->> 'active_queue_entries')::int > 0
     or (v_blockers ->> 'future_appointments')::int > 0 then
    raise exception 'fadeup_erasure_refusal=active_commitments'
      using errcode = '42501',
            detail = v_blockers::text,
            hint = 'Quittez la file et annulez vos rendez-vous à venir d''abord : les effacer laisserait au salon un créneau tenu par un client injoignable.';
  end if;

  if (v_blockers ->> 'storage_objects')::int > 0 then
    raise exception 'fadeup_erasure_refusal=media_not_purged'
      using errcode = '42501',
            detail = v_blockers::text,
            hint = 'Vos photos doivent être supprimées par l''API Storage, qui efface le fichier et pas seulement sa ligne. L''application le fait avant d''appeler cette RPC ; ce refus signifie qu''elle a échoué.';
  end if;

  v_scope := private.erase_customer_account(v_user_id);

  insert into public.account_erasure_log (actor_kind, requested_via, account_kind, scope)
  values ('self', 'delete_my_account', 'customer', v_scope)
  returning public.account_erasure_log.id, public.account_erasure_log.erased_at
  into v_id, v_at;

  return query select v_id, v_at, v_scope;
end;
$$;

comment on function public.delete_my_account() is
  'Supprime le compte de l''appelant, IMMÉDIATEMENT ET DÉFINITIVEMENT — aucune fenêtre d''annulation (justification : en-tête de la migration 20260911160200, §5). Sans paramètre : la cible est toujours auth.uid(), il n''y a rien à forger. Anonymise l''historique du salon plutôt que de le supprimer, garde les avis publiés sans leur auteur, et efface tout le reste. Refuse, avec un motif nommé (fadeup_erasure_refusal=…), un compte d''entreprise, un compte engagé (file en cours ou rendez-vous à venir) et un compte dont les photos n''ont pas encore été purgées par l''API Storage. Rend un reçu (erasure_id) et le périmètre chiffré.';

grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. L'export. Exigé par le MASTER_SPEC §16 au même titre que la suppression,
--    et beaucoup plus simple : ce que FadeUp détient sur un client, en un
--    objet lisible. Lecture seule, jamais autre chose que l'appelant.
-- ---------------------------------------------------------------------------

create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_customer_ids uuid[];
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'fadeup_export_refusal=not_authenticated'
      using errcode = '42501';
  end if;

  select array_remove(array_agg(c.id), null) into v_customer_ids
  from public.customers c where c.user_id = v_user_id;

  return jsonb_build_object(
    'exported_at', to_jsonb(now()),
    'account', (
      select to_jsonb(x) from (
        select u.email::text as email, u.phone::text as phone,
               u.created_at, u.last_sign_in_at
        from auth.users u where u.id = v_user_id) x),
    'profile', (
      select to_jsonb(x) from (
        select cp.display_name, cp.phone, cp.email, cp.haircut_frequency,
               cp.gender, cp.style_preference, cp.style_notes,
               cp.appointment_preference, cp.onboarding_completed_at,
               cp.created_at
        from public.customer_profiles cp where cp.user_id = v_user_id) x),
    'account_profile', (
      select to_jsonb(x) from (
        select p.full_name, p.avatar_url, p.locale, p.theme
        from public.profiles p where p.id = v_user_id) x),
    'passport', (
      select to_jsonb(x) from (
        select cpp.passport_number, cpp.issued_at, cpp.usual_haircut,
               cpp.fade_type, cpp.side_length, cpp.top_length,
               cpp.beard_preferences, cpp.preferences_notes
        from public.customer_passports cpp where cpp.user_id = v_user_id) x),
    'passport_photos', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select ph.storage_path, ph.caption, ph.created_at
        from public.customer_passport_photos ph
        where ph.user_id = v_user_id order by ph.created_at) x), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select a.starts_at, a.ends_at, a.status, a.notes,
               a.customer_name, a.customer_phone, a.customer_email,
               o.name as organization_name, s.name as service_name
        from public.appointments a
        join public.organizations o on o.id = a.organization_id
        left join public.services s on s.id = a.service_id
        where a.booked_by_user_id = v_user_id
           or (v_customer_ids is not null and a.customer_id = any(v_customer_ids))
        order by a.starts_at desc) x), '[]'::jsonb),
    'queue_entries', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select q.created_at, q.status, q.customer_name, q.customer_phone,
               q.notes, o.name as organization_name
        from public.queue_entries q
        join public.organizations o on o.id = q.organization_id
        where q.booked_by_user_id = v_user_id
           or (v_customer_ids is not null and q.customer_id = any(v_customer_ids))
        order by q.created_at desc) x), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select r.created_at, r.rating, r.comment, r.reviewer_display_name,
               r.status, o.name as organization_name
        from public.reviews r
        join public.organizations o on o.id = r.organization_id
        where r.customer_user_id = v_user_id
        order by r.created_at desc) x), '[]'::jsonb),
    'followed_organizations', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select o.name, o.slug, f.followed_at
        from public.organization_follows f
        join public.organizations o on o.id = f.organization_id
        where f.follower_user_id = v_user_id and f.is_following
        order by f.followed_at desc) x), '[]'::jsonb),
    'followed_professionals', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select p.display_name, p.handle, f.followed_at
        from public.professional_follows f
        join public.professionals p on p.id = f.professional_id
        where f.follower_user_id = v_user_id and f.state = 'following'
        order by f.followed_at desc) x), '[]'::jsonb),
    'favorites', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select o.name as organization_name, cf.created_at
        from public.customer_favorites cf
        join public.organizations o on o.id = cf.organization_id
        where cf.user_id = v_user_id order by cf.created_at desc) x), '[]'::jsonb),
    'notifications', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select n.created_at, n.type, n.title, n.body, n.read_at
        from public.notifications n
        where n.user_id = v_user_id order by n.created_at desc) x), '[]'::jsonb),
    'shop_records', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select o.name as organization_name, c.name, c.phone, c.email, c.notes,
               c.created_at
        from public.customers c
        join public.organizations o on o.id = c.organization_id
        where c.user_id = v_user_id order by c.created_at) x), '[]'::jsonb)
  );
end;
$$;

comment on function public.export_my_data() is
  'MASTER_SPEC §16 — ce que FadeUp détient sur l''appelant, en un seul objet JSON lisible. Sans paramètre : la cible est toujours auth.uid(). Lecture seule. Inclut la fiche que chaque salon tient sur lui (shop_records, notes du salon comprises : ce sont ses données), son historique de rendez-vous et de files, ses avis, ses abonnements, ses favoris, ses notifications, son Passport et les CHEMINS de ses photos — pas les fichiers eux-mêmes, qui se téléchargent par l''API Storage avec les mêmes droits. N''expose rien d''autrui.';

grant execute on function public.export_my_data() to authenticated;

commit;
