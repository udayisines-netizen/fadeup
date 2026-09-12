-- B5 — chantier 1, addendum : ce que la production a gagné PENDANT le lot.
--
-- À APPLIQUER EN postgres.
--
-- ORDRE D'APPLICATION — CONTRAINTE DURE, ET LA RAISON DE SON HORODATAGE.
-- Ce fichier DOIT s'appliquer APRÈS :
--   * les cinq migrations OS-2 (20260911110000 à 20260911110400) — il lit
--     et écrit public.customer_notes, et appelle get_my_customer_notes() ;
--   * la migration PLAT-2 (20260911200000) — il redéfinit
--     public.reject_support_ticket_message_mutation, que PLAT-2 crée.
-- D'où 20260911210000, et pas l'horodatage 160300 de sa première écriture :
-- dans l'ordre des NOMS, 160300 passait AVANT PLAT-2, et le
-- `create or replace` de PLAT-2 — qui ne connaît pas le caviardage — aurait
-- ÉCRASÉ l'exemption sur toute base rejouée à blanc (CI, bac d'essai, base
-- neuve). L'effacement de compte se serait alors cassé silencieusement sur
-- le premier fil de support. Défaut trouvé par PLAT-2 de session à session,
-- pas par une suite : en production il est invisible, puisque B5 a appliqué
-- APRÈS. Renommage plutôt que contournement.
--
-- POURQUOI CE FICHIER EXISTE. Entre la sauvegarde de début de lot
-- (pre-b5-20260911-173831) et l'application, OS-2 et PLAT-2 ont livré en
-- production 5 tables neuves et une soixantaine de RPC — dont trois tables
-- qui portent du TEXTE LIBRE sur une personne :
--
--   public.customer_notes          la note du salon sur son client, avec
--                                  auteur et date (OS-2 la substitue à
--                                  customers.notes, désormais refusée en
--                                  écriture par reject_legacy_customer_notes).
--                                  Rattachée au CLIENT (customer_id, cascade
--                                  depuis customers) — or la fiche client
--                                  SURVIT à l'effacement : la note aussi,
--                                  donc, si personne ne s'en occupe.
--   public.support_tickets         sujet, corps et résolution en texte libre,
--   public.support_ticket_messages corps en texte libre.
--                                  Les identifiants s'effacent seuls (clés
--                                  étrangères ON DELETE SET NULL) ; le texte,
--                                  non.
--
-- Les trois sont VIDES aujourd'hui (0 ligne, mesuré) : le coût de les traiter
-- maintenant est nul, celui de les oublier serait une fuite silencieuse le
-- jour où elles se remplissent.
--
-- CE QUI EST TRANCHÉ ICI
--
--   La note du salon est SUPPRIMÉE, pas anonymisée. Une note libre écrite sur
--   une personne nommée est la donnée de cette personne, quoi qu'en dise la
--   main qui l'a écrite ; et une note anonymisée — « [deleted] » — ne dit
--   plus rien à personne. Le salon garde tout ce qui est comptable (le
--   rendez-vous, le service, la durée, la date) ; il perd l'appréciation
--   qu'il portait sur quelqu'un qui a demandé à disparaître. C'est le bon
--   partage.
--
--   Le billet de support est CAVIARDÉ, pas supprimé — et c'est PLAT-2 qui
--   tranche ainsi, pas B5 : support_ticket_messages est en AJOUT SEUL
--   (reject_support_ticket_message_mutation, aucune exemption). Une cascade
--   de suppression s'y casse le nez, et c'est très bien : un fil de support
--   dont des messages peuvent disparaître n'est plus un fil de support.
--   Donc la ligne RESTE — sa place dans le fil, son horodatage, son type —
--   et son TEXTE est remplacé par le jeton d'effacement. Ici, contrairement
--   aux journaux du chantier 1, la donnée personnelle n'est pas un
--   identifiant mais le CORPS lui-même : le caviarder est le seul effacement
--   possible, et la seule alternative — tout garder — n'en est pas une.
--   Sont visés les quatre chemins par lesquels un billet peut désigner
--   quelqu'un : le billet dont il est le SUJET, celui qu'il a OUVERT, et ceux
--   qui portent l'un de ses rendez-vous ou l'une de ses entrées de file.
--
--   L'exemption ajoutée à reject_support_ticket_message_mutation a la même
--   forme étroite que les cinq autres (private.erasure_update_allowed, valeurs
--   énumérées) : le DELETE reste refusé à tout le monde, sans exception, et
--   l'UPDATE n'autorise que body -> jeton, author_user_id -> NULL,
--   metadata -> {}. PLAT-2 a été prévenu de session à session (précédent X3
--   §10), et sa garde reste la sienne : aucun autre champ ne bouge.
--
-- ET, sans rapport avec OS-2 : les GRANTS de public.account_erasure_log.
-- X3 a durci les ACL par défaut des TABLES sur les quatre verbes
-- TRUNCATE/TRIGGER/REFERENCES/MAINTAIN, et a LAISSÉ volontairement les quatre
-- verbes CRUD « gouvernés par RLS » (X3 §2). Une table neuve naît donc encore
-- avec SELECT/INSERT/UPDATE/DELETE pour anon et authenticated. Pour cette
-- table-ci, la RLS activée et FORCÉE sans aucune policy suffit déjà à ne rien
-- laisser passer — mais une trace d'effacement ne doit pas dépendre d'une
-- seule couche. Les grants sont RETIRÉS explicitement.
-- Concédant vérifié avant révocation : postgres (mesuré — c'est lui qui crée
-- la table, donc lui qui concède le défaut). Un REVOKE par le bon rôle,
-- jamais un no-op silencieux.

begin;

revoke select, insert, update, delete on public.account_erasure_log from anon;
revoke select, insert, update, delete on public.account_erasure_log from authenticated;

-- La garde d'ajout seul des messages de support (PLAT-2), munie de la MÊME
-- exemption étroite que les cinq du chantier 1 : le DELETE reste refusé à
-- tout le monde, l'UPDATE n'ouvre que le caviardage.
create or replace function public.reject_support_ticket_message_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and private.erasure_update_allowed(
           to_jsonb(old), to_jsonb(new),
           jsonb_build_object(
             'body', jsonb_build_array(private.erasure_display_sentinel()),
             'author_user_id', jsonb_build_array(null),
             'metadata', jsonb_build_array('{}'::jsonb))) then
    return new;
  end if;

  raise exception
    'support_ticket_messages est en ajout seul : % n''est pas permis', tg_op
    using errcode = '42501';
end;
$$;

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
  v_queue_ids uuid[];
  v_ticket_ids uuid[];
  v_n integer;
begin
  if p_user_id is null then
    raise exception 'private.erase_customer_account requires a user id'
      using errcode = '22023';
  end if;

  perform set_config('fadeup.account_erasure', 'on', true);

  select array_remove(array_agg(distinct lower(e)), null) into v_emails
  from (
    select u.email::text as e from auth.users u where u.id = p_user_id
    union all
    select cp.email from public.customer_profiles cp where cp.user_id = p_user_id
  ) s;

  select array_remove(array_agg(c.id), null) into v_customer_ids
  from public.customers c where c.user_id = p_user_id;

  -- 6.1 La fiche client du salon : elle RESTE (c'est sa comptabilité), elle
  --     ne nomme plus personne. `notes` est la colonne héritée qu'OS-2 a
  --     retirée du service : la mettre à NULL reste permis (la garde ne
  --     refuse qu'une ÉCRITURE non vide) et garantit qu'une ligne ancienne
  --     ne la porte plus.
  update public.customers c
     set name = v_sentinel, phone = null, email = null, notes = null
   where c.user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('customers_anonymised', v_n);

  -- 6.1bis La note du salon sur son client (OS-2) : supprimée.
  if v_customer_ids is not null and array_length(v_customer_ids, 1) > 0 then
    delete from public.customer_notes cn where cn.customer_id = any(v_customer_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('customer_notes_deleted', v_n);

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
  select array_remove(array_agg(q.id), null) into v_queue_ids
  from public.queue_entries q
  where q.booked_by_user_id = p_user_id
     or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));

  update public.queue_entries q
     set customer_name = v_sentinel,
         customer_phone = null,
         notes = null
   where q.booked_by_user_id = p_user_id
      or (v_customer_ids is not null and q.customer_id = any(v_customer_ids));
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('queue_entries_anonymised', v_n);

  -- 6.3bis Les billets de support (PLAT-2) : caviardés, jamais supprimés —
  --        le fil est en ajout seul et le reste.
  select array_remove(array_agg(st.id), null) into v_ticket_ids
  from public.support_tickets st
  where st.subject_user_id = p_user_id
     or st.opened_by = p_user_id
     or (v_appointment_ids is not null and st.appointment_id = any(v_appointment_ids))
     or (v_queue_ids is not null and st.queue_entry_id = any(v_queue_ids));

  if v_ticket_ids is not null and array_length(v_ticket_ids, 1) > 0 then
    update public.support_tickets st
       set subject = v_sentinel,
           body = v_sentinel,
           resolution = case when st.resolution is null then null else v_sentinel end
     where st.id = any(v_ticket_ids);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('support_tickets_redacted', v_n);

    update public.support_ticket_messages sm
       set body = v_sentinel,
           author_user_id = null,
           metadata = '{}'::jsonb
     where sm.ticket_id = any(v_ticket_ids)
       and (sm.body is distinct from v_sentinel
            or sm.author_user_id is not null
            or sm.metadata is distinct from '{}'::jsonb);
    get diagnostics v_n = row_count;
    v_scope := v_scope || jsonb_build_object('support_messages_redacted', v_n);
  else
    v_scope := v_scope || jsonb_build_object(
      'support_tickets_redacted', 0, 'support_messages_redacted', 0);
  end if;

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
  --     sont capturés AVANT l'anonymisation.
  select array_remove(array_agg(r.id), null) into v_review_ids
  from public.reviews r where r.customer_user_id = p_user_id;

  update public.reviews r
     set customer_user_id = null,
         reviewer_display_name = v_sentinel
   where r.customer_user_id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('reviews_anonymised', v_n);

  -- 6.6 Les demandes d'intérêt (profils non revendiqués, F4).
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

  -- 6.7 Les photos d'avis : les objets de stockage sont DÉJÀ partis
  --     (précondition media_not_purged) ; les lignes partent avec.
  if v_review_ids is not null and array_length(v_review_ids, 1) > 0 then
    delete from public.review_photos rp where rp.review_id = any(v_review_ids);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('review_photos_deleted', v_n);

  -- 6.7bis Les notifications reçues par le SALON (voir 20260911160200 §6.7bis).
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

  -- 6.8 Les e-mails transactionnels.
  if v_emails is not null and array_length(v_emails, 1) > 0 then
    delete from public.email_outbox eo where lower(eo.to_email) = any(v_emails);
    get diagnostics v_n = row_count;
  else
    v_n := 0;
  end if;
  v_scope := v_scope || jsonb_build_object('email_outbox_deleted', v_n);

  -- 6.9 Le compte lui-même, et toutes ses cascades.
  delete from auth.users u where u.id = p_user_id;
  get diagnostics v_n = row_count;
  v_scope := v_scope || jsonb_build_object('auth_users_deleted', v_n);

  -- 6.10 Le journal analytique, EN DERNIER.
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

-- L'export gagne les mêmes lignes : ce que le salon écrit SUR quelqu'un fait
-- partie de ce que FadeUp détient sur lui, donc de ce qu'il a le droit de
-- lire. Le corps de la note est rendu ; l'identité de son AUTEUR ne l'est pas
-- (c'est une donnée de l'employé, pas du client).
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
  v_base jsonb;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'fadeup_export_refusal=not_authenticated'
      using errcode = '42501';
  end if;

  select array_remove(array_agg(c.id), null) into v_customer_ids
  from public.customers c where c.user_id = v_user_id;

  v_base := jsonb_build_object(
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
        where c.user_id = v_user_id order by c.created_at) x), '[]'::jsonb));

  -- shop_notes DÉLÈGUE à public.get_my_customer_notes() (OS-2) plutôt que de
  -- relire la table. Ce n'est pas de la paresse : cette RPC EST la définition
  -- côté client de « ce que le salon a écrit sur moi », et l'écran compte la
  -- rend déjà. Si l'export répondait autrement — en cachant l'auteur, par
  -- exemple — FadeUp donnerait DEUX réponses à UNE question RGPD, et c'est
  -- exactement ce qu'un export ne doit jamais faire. Le jour où OS-2 change
  -- ce que le sujet a le droit de voir, l'export suit sans qu'on y touche.
  return v_base || jsonb_build_object(
    'shop_notes', coalesce((
      select jsonb_agg(to_jsonb(n))
      from public.get_my_customer_notes() n), '[]'::jsonb));
end;
$$;

comment on function public.export_my_data() is
  'MASTER_SPEC §16 — ce que FadeUp détient sur l''appelant, en un seul objet JSON lisible. Sans paramètre : la cible est toujours auth.uid(). Lecture seule. Inclut la fiche que chaque salon tient sur lui (shop_records) et les notes que le salon écrit sur lui (shop_notes) — ces dernières DÉLÉGUÉES à public.get_my_customer_notes() (OS-2), qui est la définition unique de ce que le sujet a le droit de voir : l''export ne doit jamais répondre autrement que l''écran. Les CHEMINS des photos du Passport sont rendus, pas les fichiers : ils se téléchargent par l''API Storage avec les mêmes droits. N''expose rien d''autrui.';

commit;
