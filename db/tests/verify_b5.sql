-- FadeUp — vérification B5 : suppression de compte, export, abonnements
-- nommés, genre et fréquence.
--
-- Modèle verify_b1/verify_x3 : UNE transaction, des assertions qui LÈVENT,
-- ROLLBACK final — ce script ne laisse RIEN derrière lui (QA_DATA règle 1).
-- Conçu d'abord pour le bac d'essai de restauration fidèle
-- (db/tests/b3_restore_sandbox.sh) ; sûr en production parce qu'il annule.
--
-- Il réutilise l'organisation QA partagée qa-f1b-shared (QA_DATA règle 3 :
-- réutiliser, ne pas accumuler) pour sa STRUCTURE — localisation, service,
-- barber, et les capacités booking + liveQueue d'un essai actif — en lecture
-- seule, et crée ses propres comptes et lignes dedans, tous annulés au
-- rollback. AUCUNE organisation nouvelle n'est créée par ce script.
--
-- Sections :
--   A. fixture : un client complet, avec tout ce qu'un client peut avoir
--   B. genre et fréquence : stockés, modifiables, effaçables
--   C. autorisation : on n'efface que son compte, et l'effaceur est hors
--      de portée de tout rôle client
--   D. les quatre refus nommés
--   E. l'effacement lui-même, puis la preuve TABLE PAR TABLE
--   F. ce qui reste au professionnel
--   G. la trace
--   H. les abonnements nommés
--   I. l'export
--   J. le genre n'atteint aucune surface publique

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_loc uuid;
  v_svc uuid;
  v_barber uuid;
  v_owner uuid;
  v_user uuid := 'b5000000-0000-4000-8000-00000000000a';
  v_other uuid := 'b5000000-0000-4000-8000-00000000000b';
  v_pro_user uuid := 'b5000000-0000-4000-8000-00000000000c';
  v_email text := 'qa_b5_victim@fadeup.test';
  v_customer uuid;
  v_appt_past uuid;
  v_queue uuid;
  v_review uuid;
  v_ticket uuid;
  v_sentinel text := '[deleted]';
  v_scope jsonb;
  v_erasure_id uuid;
  v_n integer;
  v_txt text;
  v_rating numeric;
  v_rating_after numeric;
  v_row record;
  v_detail text;
  v_export jsonb;
begin
  select o.id, l.id, s.id, b.id
    into v_org, v_loc, v_svc, v_barber
  from public.organizations o
  -- PAS de filtre `l.is_active` : la tenue de fin de campagne e2e de F1b
  -- NEUTRALISE volontairement cette organisation partagée — localisation
  -- désactivée, file fermée, nom préfixé « ZZ dead », marketplace_visible à
  -- faux (e2e/f1b/barber-queues.spec.ts, afterAll). Exiger une localisation
  -- active rendait donc ce script vert ou rouge selon qu'une campagne e2e
  -- venait ou non de tourner — une dépendance invisible et fausse. Ce script
  -- n'a besoin que de la STRUCTURE de l'organisation (une localisation, un
  -- service, un barber rattaché à une identité professionnelle) ; il ne
  -- réserve rien et ne dépend d'aucune disponibilité.
  join public.locations l on l.organization_id = o.id
  join public.services s on s.organization_id = o.id
  join public.barbers b on b.organization_id = o.id
  where o.slug = 'qa-f1b-shared'
    -- Un barber RATTACHÉ à une identité professionnelle : sans lui, il n'y a
    -- pas d'avis possible, et l'avis est le cœur de la démonstration §F.
    and b.professional_id is not null
  order by s.duration_minutes, b.created_at, b.id
  limit 1;

  if v_org is null then
    raise exception 'FIXTURE : qa-f1b-shared introuvable';
  end if;

  -- ==================================================================
  -- A. Le client, avec TOUT ce qu'un client peut porter.
  -- ==================================================================
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at,
                          raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', v_email, 'x', now(), now(), now(),
          jsonb_build_object('full_name', 'Victime QA B5'));

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_other, '00000000-0000-0000-0000-000000000000', 'authenticated',
          'authenticated', 'qa_b5_other@fadeup.test', 'x', now(), now(), now());

  insert into public.profiles (id, full_name, avatar_url, locale)
  values (v_user, 'Victime QA B5', 'https://example.test/a.jpg', 'fr')
  on conflict (id) do update set full_name = excluded.full_name;

  insert into public.customer_profiles
    (user_id, display_name, phone, email, haircut_frequency, gender,
     onboarding_completed_at)
  values (v_user, 'Victime QA B5', '+33600000001', v_email,
          'every_2_weeks', 'man', now());

  insert into public.customers (organization_id, name, phone, email, user_id)
  values (v_org, 'Victime QA B5', '+33600000001', v_email, v_user)
  returning id into v_customer;

  -- La note du salon vit désormais dans customer_notes (OS-2 : customers.notes
  -- est refusée en écriture par reject_legacy_customer_notes).
  insert into public.customer_notes (organization_id, customer_id, body)
  values (v_org, v_customer, 'Victime QA B5 préfère le samedi matin.');

  -- Un billet de support dont le SUJET est ce compte (PLAT-2).
  insert into public.support_tickets (reference, origin, subject, body,
                                      subject_user_id, organization_id)
  values ('QA-B5-' || substr(v_user::text, 1, 8), 'phone',
          'Problème de réservation',
          'Victime QA B5 signale un créneau refusé.', v_user, v_org)
  returning id into v_ticket;

  insert into public.support_ticket_messages (ticket_id, kind, body)
  values (v_ticket, 'note', 'Rappeler Victime QA B5 au +33600000001.');

  insert into public.appointments
    (organization_id, location_id, barber_id, service_id,
     customer_name, customer_phone, customer_email,
     starts_at, ends_at, status, notes, customer_id, booked_by_user_id)
  values (v_org, v_loc, v_barber, v_svc,
          'Victime QA B5', '+33600000001', v_email,
          now() - interval '30 days', now() - interval '30 days' + interval '30 minutes',
          'confirmed', 'Note du client', v_customer, v_user)
  returning id into v_appt_past;

  update public.appointments set status = 'completed' where id = v_appt_past;

  -- La file de l'organisation partagée peut avoir été laissée fermée par une
  -- campagne précédente (F1b la referme en fin de campagne). On la rouvre
  -- DANS la transaction : le rollback la remet exactement comme elle était.
  update public.location_service_settings
     set queue_open = true
   where location_id = v_loc;

  insert into public.queue_entries
    (organization_id, location_id, barber_id, service_id,
     customer_name, customer_phone, status, notes, customer_id, booked_by_user_id)
  values (v_org, v_loc, v_barber, v_svc, 'Victime QA B5', '+33600000001',
          'waiting', 'Note de file', v_customer, v_user)
  returning id into v_queue;

  update public.queue_entries set status = 'in_service' where id = v_queue;
  update public.queue_entries set status = 'completed' where id = v_queue;

  insert into public.organization_follows
    (organization_id, follower_user_id, is_following, followed_at)
  values (v_org, v_user, true, now());

  insert into public.customer_favorites (user_id, organization_id)
  values (v_user, v_org);

  insert into public.notifications (user_id, type, title, body, dedupe_key)
  values (v_user, 'booking_confirmed', 'Rendez-vous confirmé',
          'Bonjour Victime QA B5, votre rendez-vous est confirmé.',
          'b5-verify-' || v_user::text);

  -- LES DEUX COPIES, comme private.emit_booking_notification les écrit :
  -- celle du CLIENT, adressée à son e-mail…
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values (v_email, 'booking_confirmed', 'fr',
          jsonb_build_object('customer_name', 'Victime QA B5',
                             'appointment_id', v_appt_past::text),
          'transactional', 'b5-verify:' || v_appt_past::text || ':customer');

  -- …et celle du SALON, adressée au propriétaire, portant le MÊME payload
  -- donc le MÊME nom de client. C'est elle que l'effacement oubliait : le
  -- filtre ne portait que sur to_email, et cette ligne-ci n'est pas adressée
  -- au client. Sans elle dans la fixture, l'assertion E3 ne pouvait pas
  -- échouer — la fixture ne créait qu'une copie sur les deux.
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values ('qa_b5_shop@fadeup.test', 'booking_request_created', 'fr',
          jsonb_build_object('customer_name', 'Victime QA B5',
                             'appointment_id', v_appt_past::text,
                             'business_name', 'QA B5'),
          'transactional', 'b5-verify:' || v_appt_past::text || ':business');

  -- Le journal d'authentification de GoTrue, tel que GoTrue l'écrit : il ne
  -- naît PAS d'une insertion SQL, donc sans ces deux lignes la fixture ne
  -- porte aucune entrée et §E1 ne peut pas échouer — exactement l'angle mort
  -- qui a laissé 619 entrées orphelines en production. Les DEUX chemins de
  -- rattachement sont représentés, parce que GoTrue emploie les deux :
  --   actor_id          quand la personne agit elle-même (connexion) ;
  --   traits.user_id    quand c'est le service qui agit sur elle (inscription).
  insert into auth.audit_log_entries (id, instance_id, payload, created_at, ip_address)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
          json_build_object('action', 'login', 'log_type', 'account',
                            'actor_id', v_user::text,
                            'actor_username', v_email,
                            'actor_name', 'Victime QA B5'),
          now(), '127.0.0.1');

  insert into auth.audit_log_entries (id, instance_id, payload, created_at, ip_address)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
          json_build_object('action', 'user_signedup', 'log_type', 'team',
                            'actor_id', '00000000-0000-0000-0000-000000000000',
                            'actor_username', 'service_role',
                            'traits', json_build_object(
                              'provider', 'email',
                              'user_email', v_email,
                              'user_id', v_user::text,
                              'user_phone', '+33600000001')),
          now(), '127.0.0.1');

  insert into public.analytics_events
    (event_name, event_version, occurred_at, actor_type, actor_user_id,
     customer_id, organization_id, event_origin)
  values ('b5_verify_probe', 1, now(), 'customer', v_user, v_customer, v_org,
          'customer_mobile');

  -- Le Passport a été émis par trigger à la création de customer_profiles.
  update public.customer_passports
     set usual_haircut = 'fade bas', preferences_notes = 'Pas de tondeuse sur la nuque'
   where user_id = v_user;

  insert into public.customer_passport_photos (user_id, storage_path, caption)
  values (v_user, v_user::text || '/photo1.jpg', 'Ma coupe préférée');

  select count(*) into v_n from public.customer_passports where user_id = v_user;
  if v_n <> 1 then
    raise exception 'A1 ÉCHEC : le Passport n''a pas été émis (% ligne)', v_n;
  end if;

  -- La fixture DOIT produire les deux notifications SALON qui survivent à la
  -- cascade, sinon la preuve §E3 ne prouverait rien : celle qui porte le nom
  -- du client dans son corps, et celle qui porte son identifiant en TEXTE
  -- dans sa clé de déduplication.
  select count(*) into v_n from public.notifications n
   where n.appointment_id = v_appt_past and n.user_id <> v_user
     and n.body = 'Victime QA B5';
  if v_n < 1 then
    raise exception 'A1 ÉCHEC : aucune notification salon nommant le client (fixture sans valeur)';
  end if;
  select count(*) into v_n from public.notifications n
   where n.dedupe_key like '%' || v_user::text || '%' and n.user_id <> v_user;
  if v_n < 1 then
    raise exception 'A1 ÉCHEC : aucune notification salon portant l''identifiant en texte (fixture sans valeur)';
  end if;
  raise notice 'A1 ok  fixture complète : compte, profil, fiche salon, rendez-vous, file, abonnement, favori, notification, e-mail, événement analytique, Passport, photo';

  -- ==================================================================
  -- B. Genre et fréquence : stockés, modifiables, effaçables.
  -- ==================================================================
  select gender::text, haircut_frequency::text into v_txt, v_detail
  from public.customer_profiles where user_id = v_user;
  if v_txt <> 'man' or v_detail <> 'every_2_weeks' then
    raise exception 'B1 ÉCHEC : genre/fréquence non stockés (% / %)', v_txt, v_detail;
  end if;
  raise notice 'B1 ok  genre et fréquence stockés (man / every_2_weeks)';

  update public.customer_profiles
     set gender = 'no_preference', haircut_frequency = 'monthly'
   where user_id = v_user;
  select gender::text, haircut_frequency::text into v_txt, v_detail
  from public.customer_profiles where user_id = v_user;
  if v_txt <> 'no_preference' or v_detail <> 'monthly' then
    raise exception 'B2 ÉCHEC : genre/fréquence non modifiables';
  end if;
  raise notice 'B2 ok  genre et fréquence modifiables';

  update public.customer_profiles
     set gender = null, haircut_frequency = null
   where user_id = v_user;
  select count(*) into v_n from public.customer_profiles
   where user_id = v_user and gender is null and haircut_frequency is null;
  if v_n <> 1 then
    raise exception 'B3 ÉCHEC : genre/fréquence non effaçables';
  end if;
  raise notice 'B3 ok  genre et fréquence effaçables (NULL)';

  update public.customer_profiles
     set gender = 'man', haircut_frequency = 'every_2_weeks'
   where user_id = v_user;

  begin
    update public.customer_profiles set gender = 'nonbinaire'::public.customer_gender
     where user_id = v_user;
    raise exception 'B4 ÉCHEC : une valeur hors enum a été acceptée';
  exception when invalid_text_representation or undefined_object then
    raise notice 'B4 ok  l''enum refuse toute valeur hors contrat client';
  end;

  -- L'avis, posé par la RPC réelle (pas par un insert direct) : c'est ce
  -- chemin-là qui devra survivre à l'effacement.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  select r.id into v_review from public.submit_review(v_appt_past, 5, 'Très bonne coupe.') r;
  perform set_config('request.jwt.claims', '', true);

  if v_review is null then
    raise exception 'A2 ÉCHEC : l''avis n''a pas été créé';
  end if;
  update public.reviews set status = 'published' where id = v_review;

  select rr.rating_sum::numeric / nullif(rr.rating_count, 0) into v_rating
  from public.review_reputation rr
  where rr.subject_kind = 'professional'
    and rr.subject_id = (select professional_id from public.barbers where id = v_barber);
  raise notice 'A2 ok  avis publié (note 5), réputation du professionnel = % (somme/compte)', v_rating;

  -- ==================================================================
  -- C. On n'efface que son propre compte.
  -- ==================================================================
  -- C1. public.delete_my_account() n'a AUCUN paramètre : il n'existe
  --     littéralement pas de signature où passer l'identifiant d'autrui.
  select count(*) into v_n
  from pg_proc p
  where p.oid = 'public.delete_my_account'::regproc and p.pronargs = 0;
  if v_n <> 1 then
    raise exception 'C1 ÉCHEC : delete_my_account n''est pas la fonction sans paramètre attendue';
  end if;
  select count(*) into v_n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'delete_my_account';
  if v_n <> 1 then
    raise exception 'C1 ÉCHEC : % surcharges de delete_my_account — une seule doit exister', v_n;
  end if;
  raise notice 'C1 ok  delete_my_account() est unique et sans paramètre : rien à forger';

  -- C2. L'effaceur, lui, prend un identifiant — et n'est concédé à PERSONNE.
  select count(*) into v_n
  from pg_proc p
  cross join lateral aclexplode(p.proacl) a
  where p.oid = 'private.erase_customer_account(uuid)'::regprocedure
    and a.privilege_type = 'EXECUTE'
    and a.grantee::regrole::text in ('anon', 'authenticated', 'service_role', 'public');
  if v_n <> 0 then
    raise exception 'C2 ÉCHEC : private.erase_customer_account est exécutable par un rôle client (% grants)', v_n;
  end if;
  raise notice 'C2 ok  private.erase_customer_account n''est exécutable par aucun rôle client';

  -- C3. En rôle authenticated réel, l'appel direct est refusé.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  begin
    execute 'set local role authenticated';
    begin
      perform private.erase_customer_account(v_user);
      execute 'set local role none';
      raise exception 'C3 ÉCHEC : un authentifié a pu appeler l''effaceur sur le compte d''un autre';
    exception when insufficient_privilege then
      execute 'set local role none';
      raise notice 'C3 ok  appel direct de l''effaceur sur le compte d''autrui : 42501';
    end;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- ==================================================================
  -- D. Les quatre refus nommés.
  -- ==================================================================
  -- D1. Anonyme.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.delete_my_account();
    raise exception 'D1 ÉCHEC : un appel sans session a été accepté';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = message_text;
    if v_detail not like '%fadeup_erasure_refusal=not_authenticated%' then
      raise exception 'D1 ÉCHEC : refus non nommé (%)', v_detail;
    end if;
    raise notice 'D1 ok  sans session : fadeup_erasure_refusal=not_authenticated';
  end;

  -- D2. Engagements en cours : une SECONDE entrée, encore en attente.
  --     (La première est terminée et le restera : une transition terminale ne
  --     se rouvre pas, c'est une garantie F1b qu'on ne contourne pas ici.)
  insert into public.queue_entries
    (organization_id, location_id, barber_id, service_id,
     customer_name, customer_phone, status, customer_id, booked_by_user_id)
  values (v_org, v_loc, v_barber, v_svc, 'Victime QA B5', '+33600000001',
          'waiting', v_customer, v_user);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  begin
    perform * from public.delete_my_account();
    raise exception 'D2 ÉCHEC : un compte avec une file en cours a été effacé';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = message_text;
    if v_detail not like '%fadeup_erasure_refusal=active_commitments%' then
      raise exception 'D2 ÉCHEC : refus non nommé (%)', v_detail;
    end if;
    raise notice 'D2 ok  file en cours : fadeup_erasure_refusal=active_commitments';
  end;
  update public.queue_entries set status = 'cancelled'
   where booked_by_user_id = v_user and status = 'waiting';

  -- D3. Compte d'entreprise.
  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_user, 'owner');
  begin
    perform * from public.delete_my_account();
    raise exception 'D3 ÉCHEC : un compte membre d''une organisation a été effacé';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = message_text;
    if v_detail not like '%fadeup_erasure_refusal=business_account%' then
      raise exception 'D3 ÉCHEC : refus non nommé (%)', v_detail;
    end if;
    raise notice 'D3 ok  compte d''entreprise : fadeup_erasure_refusal=business_account';
  end;
  -- handle_new_membership() a créé une fiche staff au passage : elle compte
  -- AUSSI comme compte d'entreprise, et doit donc partir avec le membership.
  delete from public.memberships where organization_id = v_org and user_id = v_user;
  delete from public.staff_profiles where organization_id = v_org and user_id = v_user;

  -- D4. Photos non purgées : un objet de stockage sous {uid}/.
  insert into storage.objects (bucket_id, name, owner_id)
  values ('passport-photos', v_user::text || '/photo1.jpg', v_user::text);
  begin
    perform * from public.delete_my_account();
    raise exception 'D4 ÉCHEC : un compte avec des photos en stockage a été effacé';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = message_text;
    if v_detail not like '%fadeup_erasure_refusal=media_not_purged%' then
      raise exception 'D4 ÉCHEC : refus non nommé (%)', v_detail;
    end if;
    raise notice 'D4 ok  photo encore en stockage : fadeup_erasure_refusal=media_not_purged';
  end;
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'passport-photos' and name = v_user::text || '/photo1.jpg';
  perform set_config('storage.allow_delete_query', 'false', true);

  -- ==================================================================
  -- H. Les abonnements nommés — AVANT l'effacement, tant que le compte vit.
  -- ==================================================================
  select count(*) into v_n
  from public.list_my_followed_organizations() f
  where f.organization_id = v_org
    and f.organization_name is not null
    and f.organization_slug = 'qa-f1b-shared';
  if v_n <> 1 then
    raise exception 'H1 ÉCHEC : list_my_followed_organizations ne rend pas le nom du salon suivi';
  end if;
  raise notice 'H1 ok  list_my_followed_organizations rend nom, slug, ville et pays';

  -- Rien de plus qu'un profil public : la signature est comparée colonne par
  -- colonne à ce que les RPC publiques rendent déjà en anonyme.
  select string_agg(a.attname, ',' order by a.attnum) into v_txt
  from pg_proc p
  join lateral unnest(p.proallargtypes, p.proargnames) with ordinality
       t(typ, nom, ord) on true
  join lateral (select t.nom as attname, t.ord as attnum) a on true
  where p.oid = 'public.list_my_followed_organizations'::regproc;
  if v_txt <> 'organization_id,organization_name,organization_slug,city,country_code,followed_at' then
    raise exception 'H2 ÉCHEC : signature inattendue (%)', v_txt;
  end if;
  raise notice 'H2 ok  signature exacte : % — aucune colonne de plus', v_txt;

  -- ==================================================================
  -- I. L'export, pendant que le compte existe encore.
  -- ==================================================================
  v_export := public.export_my_data();
  if v_export -> 'account' ->> 'email' <> v_email then
    raise exception 'I1 ÉCHEC : l''export ne rend pas le compte';
  end if;
  if jsonb_array_length(v_export -> 'appointments') < 1
     or jsonb_array_length(v_export -> 'queue_entries') < 1
     or jsonb_array_length(v_export -> 'reviews') < 1
     or jsonb_array_length(v_export -> 'followed_organizations') < 1
     or jsonb_array_length(v_export -> 'shop_records') < 1
     or jsonb_array_length(v_export -> 'shop_notes') < 1 then
    raise exception 'I1 ÉCHEC : l''export est incomplet (%)', v_export;
  end if;
  if v_export -> 'profile' ->> 'gender' <> 'man'
     or v_export -> 'profile' ->> 'haircut_frequency' <> 'every_2_weeks' then
    raise exception 'I2 ÉCHEC : genre/fréquence absents de l''export';
  end if;
  raise notice 'I1 ok  export complet : compte, profil, Passport, rendez-vous, files, avis, abonnements, favoris, notifications, fiches salon, notes de salon';
  raise notice 'I2 ok  genre et fréquence font partie de l''export';

  -- L'export ne rend QUE l'appelant.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  v_export := public.export_my_data();
  if v_export -> 'account' ->> 'email' = v_email
     or jsonb_array_length(v_export -> 'appointments') <> 0 then
    raise exception 'I3 ÉCHEC : l''export d''un tiers contient les données de la victime';
  end if;
  raise notice 'I3 ok  l''export d''un autre compte ne contient rien de celui-ci';
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  -- ==================================================================
  -- E. L'EFFACEMENT, puis la preuve table par table.
  -- ==================================================================
  select e.erasure_id, e.scope into v_erasure_id, v_scope
  from public.delete_my_account() e;
  perform set_config('request.jwt.claims', '', true);

  if v_erasure_id is null then
    raise exception 'E0 ÉCHEC : aucun reçu rendu';
  end if;
  raise notice 'E0 ok  compte effacé, reçu %, périmètre %', v_erasure_id, v_scope;

  -- E1. Le compte lui-même et toute la surface auth.
  if exists (select 1 from auth.users where id = v_user) then
    raise exception 'E1 ÉCHEC : auth.users survit';
  end if;
  if exists (select 1 from auth.identities where user_id = v_user)
     or exists (select 1 from auth.sessions where user_id = v_user) then
    raise exception 'E1 ÉCHEC : une ligne auth rattachée survit';
  end if;
  -- Le schéma auth est balayé ENTIER, et non plus table par table nommée :
  -- auth.audit_log_entries n'a AUCUNE clé étrangère vers auth.users, donc
  -- aucune cascade ne l'atteint, et son payload porte l'adresse e-mail
  -- d'ouverture de session, le nom civil et le téléphone. Une liste écrite à
  -- la main ne pouvait pas le voir ; ce balayage le voit, et verra la
  -- prochaine table qu'une montée de version de GoTrue ajoutera.
  v_n := 0;
  for v_row in
    select c.table_name, c.column_name, c.data_type
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'auth' and t.table_type = 'BASE TABLE'
      and (c.data_type in ('uuid', 'text', 'character varying', 'jsonb', 'json'))
    order by 1, 2
  loop
    if v_row.data_type = 'uuid' then
      execute format('select count(*) from auth.%I where %I = $1',
                     v_row.table_name, v_row.column_name)
        into v_detail using v_user;
    else
      execute format(
        'select count(*) from auth.%I
          where %I::text like ''%%'' || $1 || ''%%''
             or %I::text like ''%%'' || $2 || ''%%''
             or %I::text like ''%%'' || $3 || ''%%''
             or %I::text like ''%%'' || $4 || ''%%''',
        v_row.table_name, v_row.column_name, v_row.column_name,
        v_row.column_name, v_row.column_name)
        into v_detail using v_email, '+33600000001', 'Victime QA B5', v_user::text;
    end if;
    if v_detail::integer <> 0 then
      raise exception 'E1 ÉCHEC : auth.%.% porte encore une donnée du compte (% ligne(s))',
        v_row.table_name, v_row.column_name, v_detail;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'E1 ok  BALAYAGE DU SCHÉMA auth : % colonnes balayées (users, identities, sessions, refresh_tokens, mfa_*, ET audit_log_entries) — ni identifiant, ni e-mail, ni téléphone, ni nom', v_n;

  -- E2. LE BALAYAGE UNIVERSEL : plus AUCUNE colonne uuid de public, dans
  --     AUCUNE table, ne contient l'identifiant du compte. C'est la forme la
  --     plus forte de « vérifié table par table » — elle ne dépend pas d'une
  --     liste écrite à la main, donc une table ajoutée par un lot futur est
  --     couverte le jour où elle apparaît.
  v_n := 0;
  for v_row in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type = 'uuid'
    order by 1, 2
  loop
    execute format('select count(*) from public.%I where %I = $1',
                   v_row.table_name, v_row.column_name)
      into v_detail using v_user;
    if v_detail::integer <> 0 then
      raise exception 'E2 ÉCHEC : %.% contient encore l''identifiant du compte (% ligne(s))',
        v_row.table_name, v_row.column_name, v_detail;
    end if;
    v_n := v_n + 1;
  end loop;
  if exists (select 1 from public.profiles where id = v_user) then
    raise exception 'E2 ÉCHEC : profiles (full_name, avatar_url) survit';
  end if;
  raise notice 'E2 ok  BALAYAGE UNIVERSEL : l''identifiant du compte est absent des % colonnes uuid de public (profil, Passport, photos, partages, favoris, abonnements, likes, notifications, signalements, relations, candidatures, revendications, profiles compris)', v_n;

  -- E3. Aucun e-mail, aucun téléphone, aucun nom, ET aucun identifiant écrit
  --     EN TEXTE (une clé de déduplication en contient : un balayage de
  --     colonnes uuid ne l'aurait jamais vu) — balayage LITTÉRAL de toutes
  --     les colonnes texte de public.
  --     DEUX ÉLARGISSEMENTS, chacun payé par un défaut réel que la version
  --     précédente de ce balayage ne POUVAIT PAS voir :
  --       * le jsonb est inclus. email_outbox.payload est du jsonb et portait
  --         le nom du client dans la copie SALON de chaque e-mail ;
  --         restreindre le balayage à text/varchar rendait ce défaut
  --         invisible par construction.
  --       * la recherche est un `like`, plus une égalité. Une égalité ne
  --         trouve un nom que s'il occupe la colonne ENTIÈRE ; noyé dans un
  --         texte libre — corps d'avis, titre de notification, charge utile
  --         d'e-mail — il passait au travers.
  v_n := 0;
  for v_row in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      and c.data_type in ('text', 'character varying', 'jsonb', 'json')
    order by 1, 2
  loop
    execute format(
      'select count(*) from public.%I
        where %I::text like ''%%'' || $1 || ''%%''
           or %I::text like ''%%'' || $2 || ''%%''
           or %I::text like ''%%'' || $3 || ''%%''
           or %I::text like ''%%'' || $4 || ''%%''',
      v_row.table_name, v_row.column_name, v_row.column_name,
      v_row.column_name, v_row.column_name)
      into v_detail using v_email, '+33600000001', 'Victime QA B5', v_user::text;
    if v_detail::integer <> 0 then
      raise exception 'E3 ÉCHEC : %.% contient encore une donnée personnelle (% ligne(s))',
        v_row.table_name, v_row.column_name, v_detail;
    end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'E3 ok  BALAYAGE LITTÉRAL sur % colonnes texte ET jsonb de public : e-mail, téléphone, nom et identifiant-en-texte introuvables, y compris NOYÉS dans un texte libre ou une charge utile', v_n;

  -- E4. Les notes libres écrites sur la personne sont parties aussi.
  if exists (select 1 from public.appointments where id = v_appt_past and notes is not null)
     or exists (select 1 from public.queue_entries where id = v_queue and notes is not null)
     or exists (select 1 from public.customers where id = v_customer and notes is not null)
     or exists (select 1 from public.customer_notes where customer_id = v_customer)
     or exists (select 1 from public.support_tickets st
                 where st.id = v_ticket and st.body <> v_sentinel)
     or exists (select 1 from public.support_ticket_messages sm
                 where sm.ticket_id = v_ticket and sm.body <> v_sentinel) then
    raise exception 'E4 ÉCHEC : une note libre sur la personne survit';
  end if;
  -- Le fil de support reste ENTIER : caviardé, jamais amputé.
  if not exists (select 1 from public.support_tickets where id = v_ticket)
     or not exists (select 1 from public.support_ticket_messages where ticket_id = v_ticket) then
    raise exception 'E4 ÉCHEC : le fil de support en ajout seul a été amputé';
  end if;
  raise notice 'E4 ok  textes libres effacés : rendez-vous, file, fiche salon, note de salon (OS-2), billet et messages de support caviardés sans être amputés (PLAT-2)';

  -- E5. Le journal analytique est désidentifié.
  if exists (select 1 from public.analytics_events where actor_user_id = v_user) then
    raise exception 'E5 ÉCHEC : analytics_events porte encore l''identifiant';
  end if;
  select count(*) into v_n from public.analytics_events
   where event_name = 'b5_verify_probe' and organization_id = v_org;
  if v_n <> 1 then
    raise exception 'E5 ÉCHEC : l''événement analytique a été SUPPRIMÉ au lieu d''être désidentifié';
  end if;
  raise notice 'E5 ok  analytics_events : actor_user_id à NULL, l''événement lui-même intact';

  -- E6. L'ajout seul tient toujours : rien d'autre n'est réécrivable.
  begin
    update public.analytics_events set event_name = 'b5_tampered'
     where event_name = 'b5_verify_probe';
    raise exception 'E6 ÉCHEC : une ligne analytique a pu être réécrite hors effacement';
  exception when sqlstate '22023' then
    raise notice 'E6 ok  hors effacement, analytics_events reste en ajout seul';
  end;

  -- E7. Même avec le drapeau posé à la main, on ne peut PAS réécrire autre
  --     chose qu'un identifiant vers NULL.
  perform set_config('fadeup.account_erasure', 'on', true);
  begin
    update public.analytics_events set event_name = 'b5_tampered'
     where event_name = 'b5_verify_probe';
    raise exception 'E7 ÉCHEC : le drapeau d''effacement a permis de réécrire un champ quelconque';
  exception when sqlstate '22023' then
    raise notice 'E7 ok  le drapeau n''ouvre QUE l''effacement d''un identifiant vers NULL';
  end;
  perform set_config('fadeup.account_erasure', '', true);

  -- E8. Le stockage : plus un objet sous l'identifiant.
  select count(*) into v_n from storage.objects
   where (storage.foldername(name))[1] = v_user::text;
  if v_n <> 0 then
    raise exception 'E8 ÉCHEC : % objet(s) de stockage survivent', v_n;
  end if;
  raise notice 'E8 ok  aucun objet de stockage sous l''identifiant (précondition + cascade)';

  -- ==================================================================
  -- F. Ce qui reste au professionnel.
  -- ==================================================================
  select count(*) into v_n from public.appointments where id = v_appt_past;
  if v_n <> 1 then
    raise exception 'F1 ÉCHEC : le rendez-vous du salon a disparu';
  end if;
  select status::text into v_txt from public.appointments where id = v_appt_past;
  if v_txt <> 'completed' then
    raise exception 'F1 ÉCHEC : le statut du rendez-vous a changé (%)', v_txt;
  end if;
  select count(*) into v_n from public.appointments
   where id = v_appt_past and barber_id = v_barber and service_id = v_svc
     and organization_id = v_org and completed_at is not null;
  if v_n <> 1 then
    raise exception 'F1 ÉCHEC : les faits comptables du rendez-vous ont bougé';
  end if;
  raise notice 'F1 ok  le rendez-vous reste : date, service, barber, statut, horodatage de fin intacts';

  select count(*) into v_n from public.queue_entries where id = v_queue;
  if v_n <> 1 then
    raise exception 'F2 ÉCHEC : l''entrée de file du salon a disparu';
  end if;
  select count(*) into v_n from public.customers where id = v_customer;
  if v_n <> 1 then
    raise exception 'F2 ÉCHEC : la fiche client du salon a disparu';
  end if;
  select user_id is null into v_txt from public.customers where id = v_customer;
  if v_txt <> 'true' then
    raise exception 'F2 ÉCHEC : la fiche client pointe encore vers un compte';
  end if;
  raise notice 'F2 ok  file et fiche client conservées, détachées du compte';

  select count(*) into v_n from public.reviews where id = v_review;
  if v_n <> 1 then
    raise exception 'F3 ÉCHEC : l''avis a été supprimé — la réputation du professionnel a été modifiée';
  end if;
  select rating, customer_user_id is null, reviewer_display_name
    into v_n, v_txt, v_detail
  from public.reviews where id = v_review;
  if v_n <> 5 or v_txt <> 'true' or v_detail <> v_sentinel then
    raise exception 'F3 ÉCHEC : avis mal anonymisé (note %, orphelin %, nom %)', v_n, v_txt, v_detail;
  end if;
  select rr.rating_sum::numeric / nullif(rr.rating_count, 0) into v_rating_after
  from public.review_reputation rr
  where rr.subject_kind = 'professional'
    and rr.subject_id = (select professional_id from public.barbers where id = v_barber);
  if v_rating_after is distinct from v_rating then
    raise exception 'F3 ÉCHEC : la réputation a bougé (% -> %)', v_rating, v_rating_after;
  end if;
  raise notice 'F3 ok  l''avis reste publié, note 5, sans auteur — réputation inchangée (%)', v_rating_after;

  -- ==================================================================
  -- G. La trace : elle existe, et ne contient aucune donnée personnelle.
  -- ==================================================================
  select count(*) into v_n from public.account_erasure_log where id = v_erasure_id;
  if v_n <> 1 then
    raise exception 'G1 ÉCHEC : aucune trace enregistrée';
  end if;
  select l.scope::text into v_txt from public.account_erasure_log l where l.id = v_erasure_id;
  if v_txt like '%' || v_user::text || '%'
     or v_txt like '%' || v_email || '%'
     or v_txt like '%Victime%'
     or v_txt like '%+33600000001%' then
    raise exception 'G1 ÉCHEC : la trace contient une donnée personnelle (%)', v_txt;
  end if;
  select count(*) into v_n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'account_erasure_log'
    and column_name in ('user_id', 'email', 'phone', 'actor_user_id', 'subject_id');
  if v_n <> 0 then
    raise exception 'G1 ÉCHEC : la trace porte une colonne d''identité';
  end if;
  raise notice 'G1 ok  trace présente (quand, acteur, périmètre chiffré), aucune donnée personnelle, aucune colonne d''identité';

  begin
    update public.account_erasure_log set actor_kind = 'self' where id = v_erasure_id;
    raise exception 'G2 ÉCHEC : la trace est modifiable';
  exception when insufficient_privilege then
    raise notice 'G2 ok  la trace est en ajout seul';
  end;

  -- ==================================================================
  -- J. Le genre n'atteint aucune surface.
  -- ==================================================================
  select count(*) into v_n
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    -- Les DEUX seules fonctions qui ont le droit de connaître le genre :
    -- celle qui le rend à son titulaire, et celle qui l'efface (le mot n'y
    -- apparaît d'ailleurs que dans un commentaire — la colonne part par
    -- cascade de customer_profiles).
    and p.proname not in ('export_my_data', 'erase_customer_account')
    and p.prosrc ilike '%gender%';
  if v_n <> 0 then
    raise exception 'J1 ÉCHEC : % fonction(s) hors export/effacement mentionnent le genre', v_n;
  end if;
  select count(*) into v_n
  from pg_proc p
  cross join lateral aclexplode(p.proacl) a
  where p.oid = 'public.export_my_data'::regproc
    and a.privilege_type = 'EXECUTE'
    and a.grantee::regrole::text in ('anon', 'public');
  if v_n <> 0 then
    raise exception 'J1 ÉCHEC : export_my_data est exécutable en anonyme';
  end if;
  raise notice 'J1 ok  AUCUNE fonction hors export_my_data/erase_customer_account ne mentionne gender, et l''export n''est pas exécutable en anonyme';

  raise notice '--- B5 : toutes les assertions passent ---';
end
$verify$;

rollback;
