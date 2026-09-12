-- FadeUp — M1c-a : vérification du push.
--
-- NE COMMET RIEN. Une transaction, un rollback final (même raison que B1/B2 :
-- une organisation insérée écrit une ligne append-only que personne ne peut
-- supprimer). Les appels pg_net émis pendant le test sont annulés par le
-- rollback — `net.http_post` insère dans une file transactionnelle, donc
-- AUCUNE notification ne part réellement d'ici.
--
-- CE QUE CE FICHIER ÉPROUVE, ET COMMENT
--
-- Les rôles. Les contrôles d'accès sont testés SOUS LES RÔLES CLIENTS
-- (`set local role anon` / `authenticated` + request.jwt.claims). Un test
-- exécuté en `postgres` est aveugle aux grants manquants — B5 l'a appris.
--
-- Les heures calmes. Aucune heure n'est codée en dur : le test CHERCHE un
-- fuseau actuellement en heure calme et un fuseau actuellement en journée,
-- puis vérifie le comportement des deux. Il donne donc le même verdict à
-- 3 h du matin et à midi.
--
-- Le transport. Les réponses du fournisseur sont SYNTHÉTISÉES dans
-- net._http_response (table non journalisée de pg_net) : c'est la seule
-- façon d'éprouver la réconciliation — ticket ok, DeviceNotRegistered,
-- reçu en erreur — sans licence Apple et sans appareil réel.
--
-- Exécution :
--   docker cp db/tests/verify_m1ca.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres -f /tmp/verify_m1ca.sql

\set ON_ERROR_STOP off

begin;

create temporary table m1ca_results (
  seq serial primary key,
  chantier text not null,
  check_name text not null,
  verdict text not null,
  detail text
) on commit drop;

create or replace function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into m1ca_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- FIXTURES
-- ===========================================================================

insert into public.organizations (id, name, slug, business_type, currency, country_code, marketplace_visible)
values ('1ca00001-0000-4000-8000-000000000001', 'M1ca Shop', 'm1ca-verify-shop', 'barbershop', 'EUR', 'FR', true);

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values ('1ca00101-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
        'M1ca Lieu', '2 rue de Rivoli', 'Paris', 'Île-de-France', '75001', 'FR', 'Europe/Paris', 48.8584, 2.3470);

insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
values ('1ca00201-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
        '1ca00101-0000-4000-8000-000000000001', 'M1ca Barber', true, true);

insert into public.barbers (id, organization_id, staff_profile_id, is_bookable)
values ('1ca00401-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
        '1ca00201-0000-4000-8000-000000000001', true);

insert into public.services (id, organization_id, name, duration_minutes, price_cents, is_active)
values ('1ca00701-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
        'M1ca Coupe', 30, 2500, true);

insert into public.service_locations (organization_id, service_id, location_id)
values ('1ca00001-0000-4000-8000-000000000001', '1ca00701-0000-4000-8000-000000000001', '1ca00101-0000-4000-8000-000000000001');

insert into public.barber_services (organization_id, barber_id, service_id)
values ('1ca00001-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001', '1ca00701-0000-4000-8000-000000000001');

-- La file exige la capacité `liveQueue` (R2) : sans plan, le trigger
-- enforce_queue_service_mode refuse l'insertion d'une entrée. On passe donc
-- la fixture en plan `solo`, le moins cher qui la porte — annulé au rollback.
update public.organization_commercial_state
   set plan_key = 'solo', status = 'active', entitlement_source = 'platform_grant'
 where organization_id = '1ca00001-0000-4000-8000-000000000001';

-- Deux comptes clients, et un tiers qui ne doit jamais rien voir.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('1caa0001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_m1ca_client@fadeup.test', 'x', now(), now(), now()),
  ('1caa0002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa_m1ca_tiers@fadeup.test',  'x', now(), now(), now());

insert into public.profiles (id, full_name, locale) values
  ('1caa0001-0000-4000-8000-000000000001', 'Client M1ca', 'fr'),
  ('1caa0002-0000-4000-8000-000000000002', 'Tiers M1ca', 'fr')
on conflict (id) do update set locale = excluded.locale;

insert into public.customers (id, organization_id, name, email, user_id)
values ('1cac0001-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
        'Client M1ca', 'qa_m1ca_client@fadeup.test', '1caa0001-0000-4000-8000-000000000001');

-- Une place VIVANTE (anonyme) et une place TERMINÉE.
insert into public.queue_entries (id, organization_id, location_id, barber_id, customer_name, status)
values
  ('1cae0001-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
   '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001', 'Anonyme M1ca', 'waiting'),
  ('1cae0002-0000-4000-8000-000000000002', '1ca00001-0000-4000-8000-000000000001',
   '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001', 'Fini M1ca', 'completed');

-- Une place d'un client CONNECTÉ, pour l'appel de file avec compte.
insert into public.queue_entries (id, organization_id, location_id, barber_id, customer_name, status, booked_by_user_id, customer_id)
values ('1cae0003-0000-4000-8000-000000000003', '1ca00001-0000-4000-8000-000000000001',
        '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
        'Client M1ca', 'waiting', '1caa0001-0000-4000-8000-000000000001', '1cac0001-0000-4000-8000-000000000001');

-- ===========================================================================
-- 1. LES JETONS D'APPAREIL
-- ===========================================================================

do $$
declare
  v_id uuid;
  v_n integer;
  v_user uuid := '1caa0001-0000-4000-8000-000000000001';
  v_other uuid := '1caa0002-0000-4000-8000-000000000002';
begin
  -- 1.1 Anonyme, place vivante : accepté, SOUS LE RÔLE anon.
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    v_id := public.register_push_device('ExponentPushToken[m1ca-anon-1]', 'ios', 'fr',
                                        '1cae0001-0000-4000-8000-000000000001');
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme + place vivante : enregistrement accepté', v_id is not null);
  exception when others then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme + place vivante : enregistrement accepté', false, sqlerrm);
  end;

  -- 1.2 Anonyme sans place : refusé.
  execute 'set local role anon';
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-anon-2]', 'ios', 'fr', null);
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sans place : refusé', false, 'accepté à tort');
  exception when insufficient_privilege then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sans place : refusé', true, '42501');
  when others then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sans place : refusé', false, sqlerrm);
  end;

  -- 1.3 Anonyme sur place TERMINÉE : refusé, et avec le MÊME message (une
  -- réponse distincte permettrait d'énumérer les entrées de file).
  execute 'set local role anon';
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-anon-3]', 'ios', 'fr',
                                        '1cae0002-0000-4000-8000-000000000002');
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sur place terminée : refusé', false, 'accepté à tort');
  exception when insufficient_privilege then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sur place terminée : refusé', true, '42501');
  when others then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'anonyme sur place terminée : refusé', false, sqlerrm);
  end;

  -- 1.4 Jeton mal formé : refusé.
  begin
    perform public.register_push_device('pas-un-jeton-expo', 'ios', 'fr', null);
    perform pg_temp.record('jetons', 'jeton mal formé : refusé', false, 'accepté à tort');
  exception when others then
    perform pg_temp.record('jetons', 'jeton mal formé : refusé', sqlstate = '22023', sqlstate);
  end;

  -- 1.5 Plateforme inconnue : refusée.
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-x]', 'blackberry', 'fr', null);
    perform pg_temp.record('jetons', 'plateforme inconnue : refusée', false, 'acceptée à tort');
  exception when others then
    perform pg_temp.record('jetons', 'plateforme inconnue : refusée', sqlstate = '22023', sqlstate);
  end;

  -- 1.6 Deux appareils pour UN compte.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-phone]', 'ios', 'fr', null);
    perform public.register_push_device('ExponentPushToken[m1ca-tablet]', 'android', 'en', null);
    execute 'set local role none';
  exception when others then
    execute 'set local role none';
    perform pg_temp.record('jetons', 'deux appareils pour un compte', false, sqlerrm);
  end;
  select count(*) into v_n from public.push_devices where user_id = v_user and revoked_at is null;
  perform pg_temp.record('jetons', 'deux appareils pour un compte', v_n = 2, v_n::text || ' appareil(s)');

  -- 1.7 Ré-enregistrer le même jeton ne crée pas de seconde ligne.
  execute 'set local role authenticated';
  perform public.register_push_device('ExponentPushToken[m1ca-phone]', 'ios', 'en', null);
  execute 'set local role none';
  select count(*) into v_n from public.push_devices where token = 'ExponentPushToken[m1ca-phone]';
  perform pg_temp.record('jetons', 'ré-enregistrement = mise à jour, pas doublon', v_n = 1, v_n::text || ' ligne(s)');
  select count(*) into v_n from public.push_devices
   where token = 'ExponentPushToken[m1ca-phone]' and locale = 'en';
  perform pg_temp.record('jetons', 'la langue de l''appareil se met à jour', v_n = 1);

  -- Remis en français : la suite éprouve le rendu PAR APPAREIL, et il faut
  -- donc un appareil de chaque langue sur le même compte.
  execute 'set local role authenticated';
  perform public.register_push_device('ExponentPushToken[m1ca-phone]', 'ios', 'fr', null);
  execute 'set local role none';

  -- 1.8 Un TIERS ne peut pas révoquer mon jeton.
  perform set_config('request.jwt.claims', json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.revoke_push_device('ExponentPushToken[m1ca-phone]');
  execute 'set local role none';
  select count(*) into v_n from public.push_devices
   where token = 'ExponentPushToken[m1ca-phone]' and revoked_at is null;
  perform pg_temp.record('jetons', 'un tiers ne révoque pas mon appareil', v_n = 1);

  -- 1.9 Le propriétaire révoque, puis ré-enregistre : le jeton ressuscite.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.revoke_push_device('ExponentPushToken[m1ca-tablet]');
  execute 'set local role none';
  select count(*) into v_n from public.push_devices
   where token = 'ExponentPushToken[m1ca-tablet]' and revoked_at is not null
     and revoked_reason = 'client_revoked';
  perform pg_temp.record('jetons', 'révocation par le propriétaire', v_n = 1);

  execute 'set local role authenticated';
  perform public.register_push_device('ExponentPushToken[m1ca-tablet]', 'android', 'en', null);
  execute 'set local role none';
  select count(*) into v_n from public.push_devices
   where token = 'ExponentPushToken[m1ca-tablet]' and revoked_at is null;
  perform pg_temp.record('jetons', 'un jeton ré-enregistré redevient actif', v_n = 1);

  perform set_config('request.jwt.claims', '', true);
end $$;

-- ===========================================================================
-- 2. LES PRÉFÉRENCES PAR CATÉGORIE
-- ===========================================================================

do $$
declare
  v_row record;
  v_user uuid := '1caa0001-0000-4000-8000-000000000001';
  v_n integer;
begin
  -- 2.1 Sans ligne en base : les défauts, pas une erreur ni un vide.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_row from public.get_my_notification_preferences();
  execute 'set local role none';
  perform pg_temp.record('préférences', 'défauts rendus sans ligne en base',
    v_row.queue_call and v_row.booking_response and v_row.appointment_reminder and not v_row.social_post,
    format('file=%s demande=%s rappel=%s social=%s', v_row.queue_call, v_row.booking_response,
           v_row.appointment_reminder, v_row.social_post));

  -- 2.2 Écriture puis relecture.
  execute 'set local role authenticated';
  perform public.set_my_notification_preference('social_post', true);
  perform public.set_my_notification_preference('queue_call', false);
  select * into v_row from public.get_my_notification_preferences();
  execute 'set local role none';
  perform pg_temp.record('préférences', 'une préférence écrite se relit',
    v_row.social_post and not v_row.queue_call);

  -- 2.3 Catégorie inconnue : refus explicite.
  execute 'set local role authenticated';
  begin
    perform public.set_my_notification_preference('marketing_spam', true);
    execute 'set local role none';
    perform pg_temp.record('préférences', 'catégorie inconnue refusée', false, 'acceptée à tort');
  exception when others then
    execute 'set local role none';
    perform pg_temp.record('préférences', 'catégorie inconnue refusée', sqlstate = '22023', sqlstate);
  end;

  -- 2.4 Anonyme : la lecture des préférences n'est même pas exécutable —
  -- un compte est la condition d'existence d'une préférence.
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    select count(*) into v_n from public.get_my_notification_preferences();
    execute 'set local role none';
    perform pg_temp.record('préférences', 'anonyme : lecture des préférences refusée', false,
      'exécutée à tort, ' || v_n::text || ' ligne(s)');
  exception when insufficient_privilege then
    execute 'set local role none';
    perform pg_temp.record('préférences', 'anonyme : lecture des préférences refusée', true, '42501');
  when others then
    execute 'set local role none';
    perform pg_temp.record('préférences', 'anonyme : lecture des préférences refusée', false, sqlerrm);
  end;

  -- Remise à l'état utile pour la suite.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_my_notification_preference('queue_call', true);
  perform public.set_my_notification_preference('social_post', false);
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ===========================================================================
-- 3. LA MISE EN FILE : ÉVÉNEMENTS, PRÉFÉRENCES, HEURES CALMES
-- ===========================================================================

do $$
declare
  v_n integer;
  v_urgent boolean;
  v_when timestamptz;
  v_quiet_tz text;
  v_day_tz text;
  v_user uuid := '1caa0001-0000-4000-8000-000000000001';
  v_titles text;
begin
  -- 3.1 L'appel de file : un UPDATE de statut, comme le fait la face pro.
  update public.queue_entries set status = 'called'
   where id = '1cae0003-0000-4000-8000-000000000003';

  select count(*) into v_n from public.push_outbox o
   join public.push_devices d on d.id = o.device_id
   where o.category = 'queue_call' and o.user_id = v_user;
  -- Deux appareils actifs sur ce compte (téléphone + tablette ressuscitée).
  perform pg_temp.record('événements', 'appel de file : un push par appareil du compte', v_n = 2, v_n::text);

  select bool_and(o.urgent) into v_urgent from public.push_outbox o where o.category = 'queue_call';
  perform pg_temp.record('événements', 'l''appel de file est urgent', coalesce(v_urgent, false));

  select count(*) into v_n from public.push_outbox
   where category = 'queue_call' and next_attempt_at <= now();
  perform pg_temp.record('événements', 'l''appel de file part tout de suite (heures calmes ignorées)', v_n = 2, v_n::text);

  select count(*) into v_n from public.notifications
   where type = 'queue_called' and user_id = v_user;
  perform pg_temp.record('événements', 'l''appel de file écrit aussi la ligne in-app', v_n = 1, v_n::text);

  -- Rendu par langue D'APPAREIL : un appareil fr, un appareil en.
  select string_agg(distinct o.title, ' | ' order by o.title) into v_titles
    from public.push_outbox o where o.category = 'queue_call';
  perform pg_temp.record('événements', 'rendu par langue d''appareil (fr + en)',
    v_titles like '%C%est votre tour%' and v_titles like '%It%s your turn%', v_titles);

  -- 3.2 Idempotence : rejouer l'émission ne produit rien de plus.
  perform private.enqueue_push(
    p_template_key := 'queue_called',
    p_type := 'queue_called',
    p_payload := jsonb_build_object('organization_name', 'M1ca Shop'),
    p_data := '{}'::jsonb,
    p_dedupe_prefix := 'queue:1cae0003-0000-4000-8000-000000000003:called',
    p_user_id := v_user,
    p_urgent := true
  );
  select count(*) into v_n from public.push_outbox where category = 'queue_call';
  perform pg_temp.record('événements', 'émission rejouée : aucun doublon', v_n = 2, v_n::text);

  -- 3.3 Préférence coupée : rien n'est mis en file.
  perform set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_my_notification_preference('queue_call', false);
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);

  perform private.enqueue_push(
    p_template_key := 'queue_called',
    p_type := 'queue_called',
    p_payload := jsonb_build_object('organization_name', 'M1ca Shop'),
    p_data := '{}'::jsonb,
    p_dedupe_prefix := 'queue:pref-coupee',
    p_user_id := v_user,
    p_urgent := true
  );
  select count(*) into v_n from public.push_outbox where dedupe_key like 'queue:pref-coupee%';
  perform pg_temp.record('préférences', 'catégorie coupée : aucun push mis en file', v_n = 0, v_n::text);

  -- 3.4 Une catégorie DÉSACTIVÉE PAR DÉFAUT ne passe pas, même « urgent » :
  -- la catégorie vient du gabarit, pas de l'appelant.
  perform private.enqueue_push(
    p_template_key := 'post_published',
    p_type := 'post_published',
    p_payload := jsonb_build_object('author_name', 'M1ca Shop'),
    p_data := '{}'::jsonb,
    p_dedupe_prefix := 'post:usurpation',
    p_user_id := v_user,
    p_urgent := true
  );
  select count(*) into v_n from public.push_outbox where dedupe_key like 'post:usurpation%';
  perform pg_temp.record('préférences', 'un émetteur ne déguise pas un post en appel de file', v_n = 0, v_n::text);

  -- 3.5 HEURES CALMES — sans coder aucune heure : on cherche un fuseau
  -- actuellement en heure calme, et un autre en pleine journée.
  select name into v_quiet_tz from pg_timezone_names
   where extract(hour from (now() at time zone name)) not between 8 and 20
     and name like 'Etc/GMT%' limit 1;
  select name into v_day_tz from pg_timezone_names
   where extract(hour from (now() at time zone name)) between 8 and 20
     and name like 'Etc/GMT%' limit 1;

  perform pg_temp.record('heures calmes', 'un fuseau de nuit et un fuseau de jour ont été trouvés',
    v_quiet_tz is not null and v_day_tz is not null,
    coalesce(v_quiet_tz, '(aucun)') || ' / ' || coalesce(v_day_tz, '(aucun)'));

  if v_quiet_tz is not null then
    v_when := private.push_next_window(v_quiet_tz);
    perform pg_temp.record('heures calmes', 'en heure calme, l''envoi est DIFFÉRÉ à 08:00 locale',
      v_when > now() and extract(hour from (v_when at time zone v_quiet_tz)) = 8,
      v_quiet_tz || ' -> ' || v_when::text);
  end if;

  if v_day_tz is not null then
    v_when := private.push_next_window(v_day_tz);
    perform pg_temp.record('heures calmes', 'en journée, l''envoi part tout de suite', v_when <= now(),
      v_day_tz || ' -> ' || v_when::text);
  end if;

  -- Un fuseau illisible ne fait pas échouer un envoi : repli Europe/Paris.
  begin
    v_when := private.push_next_window('Mars/Olympus_Mons');
    perform pg_temp.record('heures calmes', 'fuseau illisible : repli, pas d''erreur', v_when is not null);
  exception when others then
    perform pg_temp.record('heures calmes', 'fuseau illisible : repli, pas d''erreur', false, sqlerrm);
  end;

  -- 3.6 Sans compte, seul l'appel de file passe.
  select count(*) into v_n from public.push_outbox o
   join public.push_devices d on d.id = o.device_id
   where d.token = 'ExponentPushToken[m1ca-anon-1]';
  perform pg_temp.record('événements', 'appareil anonyme : rien en file avant son appel', v_n = 0, v_n::text);

  perform private.enqueue_push(
    p_template_key := 'post_published',
    p_type := 'post_published',
    p_payload := jsonb_build_object('author_name', 'M1ca Shop'),
    p_data := '{}'::jsonb,
    p_dedupe_prefix := 'post:anonyme',
    p_queue_entry_id := '1cae0001-0000-4000-8000-000000000001',
    p_urgent := false
  );
  select count(*) into v_n from public.push_outbox where dedupe_key like 'post:anonyme%';
  perform pg_temp.record('événements', 'anonyme : aucune catégorie hors appel de file', v_n = 0, v_n::text);

  update public.queue_entries set status = 'called'
   where id = '1cae0001-0000-4000-8000-000000000001';
  select count(*) into v_n from public.push_outbox o
   join public.push_devices d on d.id = o.device_id
   where d.token = 'ExponentPushToken[m1ca-anon-1]' and o.category = 'queue_call';
  perform pg_temp.record('événements', 'anonyme : « c''est votre tour » lui parvient', v_n = 1, v_n::text);

  -- 3.7 Un jeton non résolu est une erreur, jamais un texte envoyé tel quel.
  begin
    perform private.render_push_template('queue_called', 'fr', '{}'::jsonb);
    perform pg_temp.record('gabarits', 'jeton non résolu : refus', false, 'rendu accepté à tort');
  exception when others then
    perform pg_temp.record('gabarits', 'jeton non résolu : refus', sqlstate = '22023', sqlstate);
  end;

  -- Les dix gabarits, dans les deux langues.
  select count(*) into v_n from public.push_templates;
  perform pg_temp.record('gabarits', 'cinq gabarits × deux langues', v_n = 10, v_n::text);
  select count(*) into v_n from public.push_templates t1
   where not exists (select 1 from public.push_templates t2
                     where t2.template_key = t1.template_key and t2.locale <> t1.locale);
  perform pg_temp.record('gabarits', 'aucun gabarit orphelin d''une langue', v_n = 0, v_n::text);
end $$;

-- ===========================================================================
-- 4. LE RAPPEL AVANT RENDEZ-VOUS
-- ===========================================================================

do $$
declare
  v_n integer;
  v_first integer;
  v_second integer;
  v_appt public.appointments;
begin
  -- Préférences remises aux défauts pour ce chantier.
  update public.notification_push_preferences
     set queue_call = true, booking_response = true, appointment_reminder = true
   where user_id = '1caa0001-0000-4000-8000-000000000001';

  -- Un rendez-vous CONFIRMÉ dans une heure, et une DEMANDE en attente.
  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id, customer_id, customer_name, customer_email,
     starts_at, ends_at, status)
  values
    ('1caf0001-0000-4000-8000-000000000001', '1ca00001-0000-4000-8000-000000000001',
     '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
     '1ca00701-0000-4000-8000-000000000001', '1cac0001-0000-4000-8000-000000000001',
     'Client M1ca', 'qa_m1ca_client@fadeup.test', now() + interval '1 hour', now() + interval '90 minutes', 'confirmed'),
    ('1caf0002-0000-4000-8000-000000000002', '1ca00001-0000-4000-8000-000000000001',
     '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
     '1ca00701-0000-4000-8000-000000000001', '1cac0001-0000-4000-8000-000000000001',
     'Client M1ca', 'qa_m1ca_client@fadeup.test', now() + interval '110 minutes', now() + interval '140 minutes', 'pending');

  v_first := private.enqueue_appointment_reminders(50);
  v_second := private.enqueue_appointment_reminders(50);

  perform pg_temp.record('rappel', 'le rappel part une fois, et une seule',
    v_first >= 1 and v_second = 0, format('1er=%s 2e=%s', v_first, v_second));

  select count(*) into v_n from public.email_outbox
   where dedupe_key = '1caf0001-0000-4000-8000-000000000001:booking_reminder:customer';
  perform pg_temp.record('rappel', 'le gabarit e-mail booking_reminder de B2 est enfin déclenché', v_n = 1, v_n::text);

  /* Le rappel est DIFFÉRÉ par les heures calmes, et abandonné si le différé
     tombe après l'heure du rendez-vous. Le test calcule donc l'attendu au
     lieu de le supposer : il donne le même verdict à 3 h du matin et à midi. */
  select count(*) into v_n from public.push_outbox
   where category = 'appointment_reminder' and type = 'booking_reminder';
  if private.push_next_window('Europe/Paris') >= now() + interval '1 hour' then
    perform pg_temp.record('rappel', 'heure calme : le rappel n''est pas envoyé après l''heure du rendez-vous',
      v_n = 0, v_n::text || ' (fenêtre rouvre après le rendez-vous)');
  else
    perform pg_temp.record('rappel', 'le rappel part aussi en push (un par appareil)', v_n = 2, v_n::text);
  end if;

  select count(*) into v_n from public.push_outbox
   where category = 'appointment_reminder' and urgent;
  perform pg_temp.record('rappel', 'le rappel n''est JAMAIS urgent (il respecte les heures calmes)',
    v_n = 0, v_n::text);

  select count(*) into v_n from public.push_outbox
   where category = 'appointment_reminder' and next_attempt_at < now() - interval '1 minute';
  perform pg_temp.record('rappel', 'aucun rappel daté dans le passé', v_n = 0, v_n::text);

  -- Le registre, et le cas du comptoir : un rendez-vous SANS adresse doit
  -- être marqué lui aussi, sinon il revient à chaque tick.
  select count(*) into v_n from public.appointment_reminder_log
   where appointment_id = '1caf0001-0000-4000-8000-000000000001';
  perform pg_temp.record('rappel', 'le rendez-vous rappelé est inscrit au registre', v_n = 1, v_n::text);

  select count(*) into v_n from public.email_outbox
   where dedupe_key like '1caf0002-0000-4000-8000-000000000002:booking_reminder%';
  perform pg_temp.record('rappel', 'une DEMANDE en attente ne reçoit pas de rappel', v_n = 0, v_n::text);

  -- Demande acceptée : le troisième canal s'ajoute aux deux existants.
  select a.* into v_appt from public.appointments a where a.id = '1caf0001-0000-4000-8000-000000000001';
  perform private.emit_booking_notification(
    v_appt, 'booking_confirmed', 'customer', 'Your appointment is confirmed', null, 'booking_confirmed');
  -- Quatre lignes, et c'est correct : DEUX appareils × DEUX chemins
  -- d'émission de la fixture. Insérer un rendez-vous déjà confirmé déclenche
  -- `notify_new_appointment` (suffixe de dédoublonnage ':new', voulu depuis
  -- l'auto-confirmation), et l'appel explicite ci-dessus simule le chemin
  -- « le professionnel accepte une demande » (suffixe vide). Un rendez-vous
  -- réel emprunte l'UN ou l'AUTRE, jamais les deux.
  select count(*) into v_n from public.push_outbox where category = 'booking_response';
  perform pg_temp.record('rappel', 'demande acceptée : push en plus de l''in-app et de l''e-mail',
    v_n = 4, v_n::text || ' (2 appareils × 2 chemins d''émission)');

  select count(distinct dedupe_key) into v_n from public.push_outbox where category = 'booking_response';
  perform pg_temp.record('rappel', 'chaque push de réponse porte une clé distincte', v_n = 4, v_n::text);

  select count(*) into v_n from public.push_outbox
   where category = 'booking_response' and not urgent;
  perform pg_temp.record('rappel', 'la réponse à une demande est transactionnelle (immédiate)', v_n = 0, v_n::text);
end $$;

-- ===========================================================================
-- 4ter. CE QUE LA REVUE A TROUVÉ — et qui ne doit plus jamais passer
-- ===========================================================================

do $$
declare
  v_n integer;
  v_status text;
  v_user uuid := '1caa0001-0000-4000-8000-000000000001';
  v_other uuid := '1caa0002-0000-4000-8000-000000000002';
  v_before integer;
begin
  -- R1. Un gabarit manquant NE DOIT PAS faire échouer l'appel de file.
  --     Le gabarit est une DONNÉE, éditable : sa disparition ne peut pas
  --     empêcher un salon d'appeler son client.
  insert into public.queue_entries (id, organization_id, location_id, barber_id, customer_name, status, booked_by_user_id)
  values ('1cae0004-0000-4000-8000-000000000004', '1ca00001-0000-4000-8000-000000000001',
          '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
          'Sans gabarit', 'waiting', v_user);

  select count(*) into v_before from public.push_outbox;
  delete from public.push_templates where template_key = 'queue_called';
  begin
    update public.queue_entries set status = 'called'
     where id = '1cae0004-0000-4000-8000-000000000004';
    select status::text into v_status from public.queue_entries
     where id = '1cae0004-0000-4000-8000-000000000004';
    perform pg_temp.record('revue', 'gabarit manquant : l''appel de file PASSE quand même',
      v_status = 'called', coalesce(v_status, 'null'));
  exception when others then
    perform pg_temp.record('revue', 'gabarit manquant : l''appel de file PASSE quand même', false, sqlerrm);
  end;

  select count(*) into v_n from public.push_outbox;
  perform pg_temp.record('revue', 'gabarit manquant : rien n''est mis en file, et rien ne casse',
    v_n = v_before, v_n::text || ' vs ' || v_before::text);

  -- On remet le gabarit pour la suite.
  insert into public.push_templates (template_key, locale, category, title, body) values
    ('queue_called', 'fr', 'queue_call', 'C''est votre tour', '{{organization_name}} vous appelle.'),
    ('queue_called', 'en', 'queue_call', 'It''s your turn', '{{organization_name}} is calling you.')
  on conflict (template_key, locale) do nothing;

  /* R2. Plafond d'appareils par entrée de file : sans lui, un client de la
         salle d'attente fait échouer l'appel en saturant sa propre place.
         Entrée DÉDIÉE : celle du chantier 1 porte déjà un appareil, et un
         bloc `exception` de plpgsql ANNULE le travail du bloc (sous-
         transaction implicite) — piège rencontré en écrivant ce test. */
  insert into public.queue_entries (id, organization_id, location_id, barber_id, customer_name, status)
  values ('1cae0005-0000-4000-8000-000000000005', '1ca00001-0000-4000-8000-000000000001',
          '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
          'Saturation QA', 'waiting');

  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  for v_n in 1..5 loop
    perform public.register_push_device(
      'ExponentPushToken[m1ca-flood-' || v_n || ']', 'ios', 'fr',
      '1cae0005-0000-4000-8000-000000000005');
  end loop;
  execute 'set local role none';

  select count(*) into v_n from public.push_devices
   where queue_entry_id = '1cae0005-0000-4000-8000-000000000005' and revoked_at is null;
  perform pg_temp.record('revue', 'cinq appareils par entrée de file : acceptés', v_n = 5, v_n::text);

  execute 'set local role anon';
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-flood-6]', 'ios', 'fr',
                                        '1cae0005-0000-4000-8000-000000000005');
    execute 'set local role none';
    perform pg_temp.record('revue', 'au-delà du plafond : refusé', false, 'accepté à tort');
  exception when others then
    execute 'set local role none';
    perform pg_temp.record('revue', 'au-delà du plafond : refusé', sqlstate = '54000', sqlstate);
  end;

  -- R3. Un appareil rattaché à une entrée ne doit pas rendre cette entrée
  --     indestructible (un lieu et une organisation cascadent vers elle).
  begin
    delete from public.queue_entries where id = '1cae0001-0000-4000-8000-000000000001';
    perform pg_temp.record('revue', 'une entrée de file reste supprimable avec des appareils rattachés', true);
  exception when others then
    perform pg_temp.record('revue', 'une entrée de file reste supprimable avec des appareils rattachés',
      false, sqlerrm);
  end;

  -- R4. Un compte connecté ne peut pas s'accrocher à l'entrée d'un AUTRE.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform public.register_push_device('ExponentPushToken[m1ca-hijack]', 'ios', 'fr',
                                        '1cae0004-0000-4000-8000-000000000004');
    execute 'set local role none';
    perform pg_temp.record('revue', 'un compte ne s''accroche pas à l''entrée d''un autre', false,
      'accepté à tort');
  exception when insufficient_privilege then
    execute 'set local role none';
    perform pg_temp.record('revue', 'un compte ne s''accroche pas à l''entrée d''un autre', true, '42501');
  when others then
    execute 'set local role none';
    perform pg_temp.record('revue', 'un compte ne s''accroche pas à l''entrée d''un autre', false, sqlerrm);
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- R5. Le rendez-vous du COMPTOIR, sans adresse : marqué une fois, jamais
--     repris — sinon il affame les vrais rappels (limit global).
do $$
declare
  v_tick1 integer;
  v_tick2 integer;
  v_tick3 integer;
  v_n integer;
begin
  insert into public.appointments
    (id, organization_id, location_id, barber_id, service_id, customer_name,
     customer_email, starts_at, ends_at, status)
  values
    ('1caf0003-0000-4000-8000-000000000003', '1ca00001-0000-4000-8000-000000000001',
     '1ca00101-0000-4000-8000-000000000001', '1ca00401-0000-4000-8000-000000000001',
     '1ca00701-0000-4000-8000-000000000001', 'Walk-in QA',
     null, now() + interval '30 minutes', now() + interval '60 minutes', 'confirmed');

  v_tick1 := private.enqueue_appointment_reminders(50);
  v_tick2 := private.enqueue_appointment_reminders(50);
  v_tick3 := private.enqueue_appointment_reminders(50);

  perform pg_temp.record('revue', 'un rendez-vous sans adresse n''est pas repris à chaque tick',
    v_tick2 = 0 and v_tick3 = 0, format('tick1=%s tick2=%s tick3=%s', v_tick1, v_tick2, v_tick3));

  select count(*) into v_n from public.appointment_reminder_log
   where appointment_id = '1caf0003-0000-4000-8000-000000000003';
  perform pg_temp.record('revue', 'il est marqué quand même (rien à lui envoyer)', v_n = 1, v_n::text);
exception when others then
  perform pg_temp.record('revue', 'le rendez-vous du comptoir sans adresse', false, sqlerrm);
end $$;

-- ===========================================================================
-- 4bis. LE NOUVEAU POST D'UN PROFESSIONNEL SUIVI
-- ===========================================================================

do $$
declare
  v_n integer;
  v_first integer;
  v_second integer;
  v_user uuid := '1caa0001-0000-4000-8000-000000000001';
begin
  -- Le compte suit le salon, et accepte les notifications sociales.
  insert into public.organization_follows (follower_user_id, organization_id, is_following, followed_at)
  values (v_user, '1ca00001-0000-4000-8000-000000000001', true, now())
  on conflict (follower_user_id, organization_id) do update set is_following = true;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_my_notification_preference('social_post', true);
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);

  insert into public.posts (id, author_kind, organization_id, caption, visibility)
  values ('1cad0001-0000-4000-8000-000000000001', 'organization',
          '1ca00001-0000-4000-8000-000000000001', 'Post QA M1ca', 'public');

  v_first := private.enqueue_post_pushes(20);
  v_second := private.enqueue_post_pushes(20);

  perform pg_temp.record('post', 'un nouveau post est diffusé une fois, et une seule',
    v_first >= 1 and v_second = 0, format('1er=%s 2e=%s', v_first, v_second));

  select count(*) into v_n from public.push_post_fanout
   where post_id = '1cad0001-0000-4000-8000-000000000001';
  perform pg_temp.record('post', 'le registre de diffusion est posé', v_n = 1, v_n::text);

  select count(*) into v_n from public.push_outbox
   where category = 'social_post' and type = 'post_published' and not urgent;
  perform pg_temp.record('post', 'un push social par appareil, JAMAIS urgent', v_n >= 1, v_n::text);

  -- Heures calmes : non urgent, donc soit tout de suite (journée au lieu),
  -- soit différé — mais JAMAIS avant maintenant.
  select count(*) into v_n from public.push_outbox
   where category = 'social_post' and next_attempt_at < now() - interval '1 minute';
  perform pg_temp.record('post', 'aucun push social daté dans le passé', v_n = 0, v_n::text);

  -- Préférence coupée : plus rien pour un nouveau post.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.set_my_notification_preference('social_post', false);
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);

  insert into public.posts (id, author_kind, organization_id, caption, visibility)
  values ('1cad0002-0000-4000-8000-000000000002', 'organization',
          '1ca00001-0000-4000-8000-000000000001', 'Post QA M1ca 2', 'public');
  perform private.enqueue_post_pushes(20);
  select count(*) into v_n from public.push_outbox
   where data ->> 'post_id' = '1cad0002-0000-4000-8000-000000000002';
  perform pg_temp.record('post', 'catégorie sociale coupée : aucun push', v_n = 0, v_n::text);

  -- Un post CACHÉ n'est jamais diffusé.
  -- `posts_moderation_stamp_complete` exige un MOTIF avec la date de masquage :
  -- un post caché sans raison n'est pas représentable (PLAT-2).
  insert into public.posts (id, author_kind, organization_id, caption, visibility, hidden_at, hidden_reason)
  values ('1cad0003-0000-4000-8000-000000000003', 'organization',
          '1ca00001-0000-4000-8000-000000000001', 'Post QA M1ca cache', 'public', now(), 'abusive_content');
  perform private.enqueue_post_pushes(20);
  select count(*) into v_n from public.push_post_fanout
   where post_id = '1cad0003-0000-4000-8000-000000000003';
  perform pg_temp.record('post', 'un post masqué n''est pas diffusé', v_n = 0, v_n::text);
exception when others then
  perform pg_temp.record('post', 'diffusion d''un nouveau post', false, sqlerrm);
end $$;

-- ===========================================================================
-- 5. LE TRANSPORT — dépêche, tickets, reçus, jetons morts
-- ===========================================================================

do $$
declare
  v_row public.push_outbox;
  v_dead public.push_outbox;
  v_n integer;
  v_dispatched integer;
  v_fake_request bigint := -424242;
  v_fake_dead bigint := -424243;
  v_fake_receipt bigint := -424244;
begin
  -- 5.1 Dépêche : la ligne passe en « sending » avec un identifiant pg_net.
  -- L'appel HTTP est ANNULÉ par le rollback final — rien ne part.
  v_dispatched := private.push_dispatch_batch(5);
  perform pg_temp.record('transport', 'la dépêche prend des lignes en file', v_dispatched > 0, v_dispatched::text);

  select count(*) into v_n from public.push_outbox
   where status = 'sending' and net_request_id is not null and dispatched_at is not null;
  perform pg_temp.record('transport', 'une ligne dépêchée retient son identifiant pg_net', v_n = v_dispatched, v_n::text);

  select count(*) into v_n from public.push_outbox where status = 'queued' and attempts > 1;
  perform pg_temp.record('transport', 'aucune ligne n''est dépêchée deux fois', v_n = 0, v_n::text);

  -- 5.2 Réconciliation d'un ticket « ok » (réponse SYNTHÉTISÉE).
  select * into v_row from public.push_outbox where status = 'sending' limit 1;
  update public.push_outbox set net_request_id = v_fake_request where id = v_row.id;
  insert into net._http_response (id, status_code, content_type, content, timed_out)
  values (v_fake_request, 200, 'application/json',
          '{"data":[{"status":"ok","id":"m1ca-ticket-ok"}]}', false);

  perform private.push_reconcile_batch(50);
  select count(*) into v_n from public.push_outbox
   where id = v_row.id and status = 'sent' and provider_ticket_id = 'm1ca-ticket-ok' and sent_at is not null;
  perform pg_temp.record('transport', 'ticket ok : la ligne est « sent » et garde le ticket', v_n = 1, v_n::text);

  -- 5.3 DeviceNotRegistered au TICKET : le jeton est retiré.
  select * into v_dead from public.push_outbox where status = 'sending' limit 1;
  if v_dead.id is null then
    -- Toutes les lignes ont été conclues : on en refait une.
    insert into public.push_outbox (device_id, user_id, category, type, template_key, locale, title, body, status, dedupe_key)
    select d.id, d.user_id, 'queue_call', 'queue_called', 'queue_called', 'fr', 'x', 'y', 'sending', 'm1ca:dead'
      from public.push_devices d where d.revoked_at is null limit 1
    returning * into v_dead;
  end if;
  update public.push_outbox set net_request_id = v_fake_dead, status = 'sending' where id = v_dead.id;
  insert into net._http_response (id, status_code, content_type, content, timed_out)
  values (v_fake_dead, 200, 'application/json',
          '{"data":[{"status":"error","message":"not registered","details":{"error":"DeviceNotRegistered"}}]}', false);

  perform private.push_reconcile_batch(50);
  select count(*) into v_n from public.push_devices
   where id = v_dead.device_id and revoked_at is not null and revoked_reason = 'DeviceNotRegistered';
  perform pg_temp.record('transport', 'DeviceNotRegistered : le jeton est retiré', v_n = 1, v_n::text);
  select count(*) into v_n from public.push_outbox where id = v_dead.id and status = 'failed';
  perform pg_temp.record('transport', 'un jeton mort n''est pas réessayé', v_n = 1, v_n::text);

  -- Un jeton révoqué n'est plus jamais dépêché.
  insert into public.push_outbox (device_id, user_id, category, type, template_key, locale, title, body, dedupe_key)
  values (v_dead.device_id, v_dead.user_id, 'queue_call', 'queue_called', 'queue_called', 'fr',
          'x', 'y', 'm1ca:apres-revocation');
  perform private.push_dispatch_batch(5);
  select count(*) into v_n from public.push_outbox
   where dedupe_key = 'm1ca:apres-revocation' and status = 'queued';
  perform pg_temp.record('transport', 'un appareil révoqué n''est plus dépêché', v_n = 1, v_n::text);

  -- 5.4 Les reçus : demande, puis résolution avec un reçu en erreur.
  select count(*) into v_n from public.push_outbox
   where status = 'sent' and provider_ticket_id is not null;
  if v_n > 0 then
    update public.push_outbox set sent_at = now() - interval '5 minutes'
     where status = 'sent' and provider_ticket_id is not null;
    perform private.push_receipt_request_batch(100);
    select count(*) into v_n from public.push_receipt_requests where resolved_at is null;
    perform pg_temp.record('transport', 'une demande de reçus est enregistrée', v_n = 1, v_n::text);
    select count(*) into v_n from public.push_outbox
     where provider_ticket_id = 'm1ca-ticket-ok' and receipt_requested_at is not null;
    perform pg_temp.record('transport', 'un reçu n''est pas réclamé deux fois', v_n = 1, v_n::text);

    update public.push_receipt_requests set net_request_id = v_fake_receipt where resolved_at is null;
    insert into net._http_response (id, status_code, content_type, content, timed_out)
    values (v_fake_receipt, 200, 'application/json',
            '{"data":{"m1ca-ticket-ok":{"status":"error","message":"gone","details":{"error":"DeviceNotRegistered"}}}}', false);
    perform private.push_receipt_resolve_batch(10);
    select count(*) into v_n from public.push_outbox
     where provider_ticket_id = 'm1ca-ticket-ok' and status = 'failed'
       and last_error = 'DeviceNotRegistered (receipt)';
    perform pg_temp.record('transport', 'DeviceNotRegistered au REÇU : conclu et jeton retiré', v_n = 1, v_n::text);
    select count(*) into v_n from public.push_receipt_requests where resolved_at is null;
    perform pg_temp.record('transport', 'la demande de reçus est close', v_n = 0, v_n::text);
  else
    perform pg_temp.record('transport', 'une demande de reçus est enregistrée', false, 'aucune ligne « sent »');
  end if;

  -- 5.5 La trace : chaque ligne dit quoi, à qui, quand, avec quel résultat.
  select count(*) into v_n from public.push_outbox
   where category is null or type is null or title is null or created_at is null;
  perform pg_temp.record('transport', 'chaque envoi est tracé (quoi, à qui, quand, résultat)', v_n = 0, v_n::text);
end $$;

-- ===========================================================================
-- 6. PRIVILÈGES — l'invariant X3 sur tout objet neuf
-- ===========================================================================

do $$
declare
  v_n integer;
  v_bad text;
begin
  -- 6.1 Les RPC clientes ont un grant EXPLICITE, et le bon.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('register_push_device', 'revoke_push_device')
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform pg_temp.record('privilèges', 'enregistrement et retrait : anon + authenticated', v_n = 2, v_n::text);

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_my_notification_preferences', 'set_my_notification_preference')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE');
  perform pg_temp.record('privilèges', 'préférences : authenticated seul', v_n = 2, v_n::text);

  -- 6.2 Le tick n'appartient qu'au scheduler.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'run_push_maintenance'
     and has_function_privilege('fadeup_scheduler', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  perform pg_temp.record('privilèges', 'run_push_maintenance : fadeup_scheduler seul', v_n = 1, v_n::text);

  -- 6.3 Aucune fonction private du lot n'est exécutable par un client.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and (p.proname like 'push\_%' or p.proname like 'enqueue\_p%' or p.proname in ('render_push_template', 'expo_access_token'))
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.record('privilèges', 'aucune fonction private du lot n''est cliente', v_bad is null, coalesce(v_bad, 'aucune'));

  -- 6.4 Le trigger d'appel de file n'est pas appelable par un client.
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'queue_entries_notify_called'
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  perform pg_temp.record('privilèges', 'la fonction de trigger n''est pas cliente', v_n = 0, v_n::text);

  -- 6.5 Les six tables : RLS activée ET forcée, aucun verbe d'écriture client.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('push_devices', 'notification_push_preferences', 'push_templates',
                       'push_outbox', 'push_receipt_requests', 'push_post_fanout')
     and not (c.relrowsecurity and c.relforcerowsecurity);
  perform pg_temp.record('privilèges', 'RLS activée et forcée sur les six tables', v_bad is null, coalesce(v_bad, 'toutes'));

  select string_agg(t.tbl || ':' || t.verb, ', ') into v_bad from (
    select c.relname as tbl, v.verb
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) v(verb)
     where n.nspname = 'public'
       and c.relname in ('push_devices', 'notification_push_preferences', 'push_templates',
                         'push_outbox', 'push_receipt_requests', 'push_post_fanout')
       and (has_table_privilege('anon', c.oid, v.verb) or has_table_privilege('authenticated', c.oid, v.verb))
  ) t;
  perform pg_temp.record('privilèges', 'aucun verbe d''écriture client sur les tables du lot',
    v_bad is null, coalesce(v_bad, 'aucun'));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('push_devices', 'notification_push_preferences', 'push_templates',
                       'push_outbox', 'push_receipt_requests', 'push_post_fanout')
     and has_table_privilege('anon', c.oid, 'SELECT');
  perform pg_temp.record('privilèges', 'anon ne lit aucune table du lot', v_bad is null, coalesce(v_bad, 'aucune'));
end $$;

-- Un client authentifié TIERS ne lit aucun jeton, aucune préférence, aucun envoi.
do $$
declare
  v_devices integer;
  v_prefs integer;
  v_outbox integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '1caa0002-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_devices from public.push_devices;
  select count(*) into v_prefs from public.notification_push_preferences;
  select count(*) into v_outbox from public.push_outbox;
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('RLS', 'un tiers ne lit aucun jeton d''appareil', v_devices = 0, v_devices::text);
  perform pg_temp.record('RLS', 'un tiers ne lit aucune préférence', v_prefs = 0, v_prefs::text);
  perform pg_temp.record('RLS', 'un tiers ne lit aucun envoi', v_outbox = 0, v_outbox::text);
exception when others then
  execute 'set local role none';
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('RLS', 'un tiers est isolé', false, sqlerrm);
end $$;

-- ===========================================================================
-- RÉSULTATS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from m1ca_results order by seq;

select verdict, count(*) from m1ca_results group by verdict order by verdict;

rollback;
