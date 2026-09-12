-- FadeUp — vérification OS-3 : insights, sollicitations par modèles, plafond.
--
-- Modèle verify_os1/verify_os2 : UNE transaction, des assertions qui lèvent,
-- ROLLBACK final — ce script ne laisse RIEN derrière lui. Conçu pour le bac
-- d'essai de restauration fidèle (b3_restore_sandbox.sh), et rejouable sur la
-- production en transaction annulée.
--
--   I1  insights : garde — anonyme refusé, étranger refusé, organisation nulle
--       refusée du MÊME refus (pas d'oracle d'existence)
--   I2  insights : un barber SANS droit de revenu reçoit NULL (jamais zéro) ;
--       le réglage d'OS-1 le lui ouvre ; owner voit toujours
--   I3  insights : réservations reçues via FadeUp distinguées des saisies au
--       comptoir ; demandes reçues et converties
--   I4  insights : AUCUNE tendance sans période de comparaison réelle
--       (fenêtre courte, ou activité qui commence dans la fenêtre)
--   I5  insights : absences comptées, leur coût soumis au même droit
--   I6  insights : organisation SANS historique — first_activity_at nul,
--       aucun chiffre inventé
--   I7  durées : une prestation mesurée est rendue, une non mesurée est
--       ABSENTE (pas à zéro) ; un lieu d'autrui est refusé
--   Q1  plafond : il vit EN BASE, aux valeurs du fondateur
--   Q2  plafond : compteur, reste, plan supérieur proposé ; barber refusé
--   Q3  plafond : au plafond, l'envoi est REFUSÉ côté serveur avec un motif,
--       et le compteur n'a pas bougé
--   C1  les quatre modèles partent, chacun via email_outbox et rien d'autre
--   C2  un pro n'écrit QU'À ses clients : le client d'un autre salon n'est
--       jamais destinataire ; un barber et un réceptionniste sont refusés
--   C3  do_not_contact : exclu de l'audience ; le désabonnement est global et
--       retire les sollicitations déjà en file
--   C4  heures calmes : hors fenêtre, l'envoi est PROGRAMMÉ, pas annulé
--   C5  fréquence : deux sollicitations en sept jours suffisent à exclure la
--       troisième, toutes organisations confondues
--   C6  pas de message libre : accroche vide, trop longue, multiligne, avec
--       un lien ou un jeton de gabarit — cinq refus nommés
--   C7  promotion : période invalide refusée
--   C8  créneaux libres : service manquant, service étranger, aucun créneau
--   C9  trace : qui, quand, quel modèle, combien — et le résultat lisible
--   C10 une campagne sans destinataire ne consomme PAS le plafond
--   Z0  motif nul : claims vides → chaque RPC lève 42501 (droit d'exécuter
--       intact — sinon on testerait le GRANT, pas la garde)
--   Z1  le rôle anon n'a pas le droit d'exécuter, sauf le désabonnement

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_org2 uuid;
  v_slug text;
  v_loc uuid;
  v_loc2 uuid;
  v_tz text;
  v_owner uuid;
  v_manager uuid;
  v_receptionist uuid;
  v_barber_user uuid;
  v_stranger uuid;
  v_customer_user uuid;
  v_users uuid[];
  v_barber uuid;
  v_membership uuid;
  v_service uuid;
  v_service2 uuid;
  v_service_other uuid;
  v_i integer;
  v_cust_lapsed uuid;
  v_cust_regular uuid;
  v_cust_loyal uuid;
  v_cust_noemail uuid;
  v_cust_dnc uuid;
  v_cust_other uuid;
  v_ins record;
  v_prev record;
  v_quota record;
  v_prev_quota record;
  v_send record;
  v_preview record;
  v_camp record;
  v_count integer;
  v_count2 integer;
  v_text text;
  v_ok boolean;
  v_token text;
  v_next timestamptz;
  v_gap record;
begin
  -- ==================================================================
  -- FIXTURE
  -- ==================================================================
  select o.id, o.slug into v_org, v_slug
  from public.organizations o
  where o.slug like 'qa-f1-%'
  order by o.slug limit 1;
  if v_org is null then
    raise exception 'FIXTURE: aucune organisation qa-f1';
  end if;

  select o.id into v_org2
  from public.organizations o
  where o.slug like 'qa-f1-%' and o.id <> v_org
  order by o.slug limit 1;
  if v_org2 is null then
    raise exception 'FIXTURE: il faut une SECONDE organisation qa-f1 pour prouver la minimisation';
  end if;

  select m.user_id into v_owner
  from public.memberships m where m.organization_id = v_org and m.role = 'owner' limit 1;
  if v_owner is null then
    raise exception 'FIXTURE: aucun owner sur %', v_slug;
  end if;

  select array_agg(id) into v_users
  from (
    select u.id from auth.users u
    where u.email like '%@fadeup.test'
      and not exists (select 1 from public.memberships m where m.user_id = u.id)
      and not exists (select 1 from public.staff_profiles sp where sp.user_id = u.id)
      and not exists (select 1 from public.platform_members pm where pm.user_id = u.id)
    order by u.email limit 5
  ) users;
  if coalesce(array_length(v_users, 1), 0) <> 5 then
    raise exception 'FIXTURE: 5 comptes @fadeup.test libres requis, % trouvés',
      coalesce(array_length(v_users, 1), 0);
  end if;
  v_manager := v_users[1]; v_receptionist := v_users[2]; v_barber_user := v_users[3];
  v_customer_user := v_users[4]; v_stranger := v_users[5];

  insert into public.memberships (organization_id, user_id, role) values
    (v_org, v_manager, 'manager'),
    (v_org, v_receptionist, 'receptionist');
  insert into public.memberships (organization_id, user_id, role)
  values (v_org, v_barber_user, 'barber')
  returning id into v_membership;

  -- Le client a une cadence DÉCLARÉE (M1a) : toutes les trois semaines.
  insert into public.customer_profiles (user_id, haircut_frequency)
  values (v_customer_user, 'every_3_weeks')
  on conflict (user_id) do update set haircut_frequency = 'every_3_weeks';
  insert into public.profiles (id, locale) values (v_customer_user, 'fr')
  on conflict (id) do update set locale = 'fr';

  select l.id, l.timezone into v_loc, v_tz
  from public.locations l
  where l.organization_id = v_org and l.kind = 'physical_address' limit 1;
  if v_loc is null then
    raise exception 'FIXTURE: aucun lieu physique sur %', v_slug;
  end if;
  update public.locations set is_active = true, timezone = 'Europe/Paris' where id = v_loc;
  v_tz := 'Europe/Paris';
  perform private.ensure_location_service_settings(v_loc);

  select l.id into v_loc2
  from public.locations l
  where l.organization_id = v_org2 and l.kind = 'physical_address' limit 1;

  update public.staff_profiles
     set location_id = v_loc, display_name = 'OS3 Barber A', is_public = true, is_active = true
   where organization_id = v_org and user_id = v_barber_user;
  if not exists (select 1 from public.staff_profiles where organization_id = v_org and user_id = v_barber_user) then
    insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
    values (v_org, v_barber_user, v_loc, 'OS3 Barber A', true, true);
  end if;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select v_org, sp.id, true from public.staff_profiles sp
   where sp.organization_id = v_org and sp.user_id = v_barber_user
  returning id into v_barber;

  select s.id into v_service from public.services s
  where s.organization_id = v_org and s.is_active order by s.name limit 1;
  if v_service is null then
    raise exception 'FIXTURE: aucun service actif sur %', v_slug;
  end if;
  update public.services
     set duration_minutes = 30, price_cents = 3000, buffer_before_minutes = 0, buffer_after_minutes = 0
   where id = v_service;

  -- Un second service ACTIF mais JAMAIS mesuré : il doit rester absent de
  -- l'écart de durées (I7), pas y figurer à zéro.
  insert into public.services (organization_id, name, duration_minutes, price_cents, is_active)
  values (v_org, 'OS3 Service Sans Mesure', 45, 4500, true)
  returning id into v_service2;

  select s.id into v_service_other from public.services s
  where s.organization_id = v_org2 order by s.name limit 1;

  insert into public.service_locations (organization_id, service_id, location_id)
  values (v_org, v_service, v_loc), (v_org, v_service2, v_loc) on conflict do nothing;
  insert into public.barber_services (organization_id, barber_id, service_id)
  values (v_org, v_barber, v_service), (v_org, v_barber, v_service2) on conflict do nothing;

  delete from public.location_hours where location_id = v_loc;
  delete from public.barber_working_hours where barber_id = v_barber;
  for v_i in 0..6 loop
    insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
    values (v_org, v_loc, v_i, false, time '00:00', time '23:59');
    insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
    values (v_org, v_barber, v_i, false, time '00:00', time '23:59');
  end loop;

  -- Les clients. Adresses @fadeup.test UNIQUEMENT : ce script n'écrit
  -- jamais une adresse joignable dans email_outbox.
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org, 'OS3 Client Lapsed', 'os3-lapsed@fadeup.test', null)
  returning id into v_cust_lapsed;
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org, 'OS3 Client Regulier', 'os3-regular@fadeup.test', null)
  returning id into v_cust_regular;
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org, 'OS3 Client Fidele', 'os3-loyal@fadeup.test', v_customer_user)
  returning id into v_cust_loyal;
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org, 'OS3 Client Sans Email', null, null)
  returning id into v_cust_noemail;
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org, 'OS3 Client Desabonne', 'os3-dnc@fadeup.test', null)
  returning id into v_cust_dnc;
  insert into public.customers (organization_id, name, email, user_id)
  values (v_org2, 'OS3 Client Ailleurs', 'os3-ailleurs@fadeup.test', null)
  returning id into v_cust_other;

  -- Historique : chaque prestation sur un jour distinct pour ne pas heurter
  -- l'exclusion de chevauchement par fauteuil (OS-1).
  --   lapsed  : 4 prestations, la dernière il y a 120 jours, cycle ~28 j
  --   regulier: 3 prestations récentes
  --   fidele  : 2 prestations, la dernière il y a 40 jours (cadence 21 j)
  --   sans mail : 3 prestations (concerné, mais injoignable)
  --   desabonne : 3 prestations
  for v_i in 0..3 loop
    insert into public.appointments
      (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
       starts_at, ends_at, status, completed_at, created_at)
    values (v_org, v_loc, v_barber, v_service, 'OS3 Client Lapsed', v_cust_lapsed,
            now() - make_interval(days => 120 + v_i * 28),
            now() - make_interval(days => 120 + v_i * 28) + interval '30 minutes',
            'completed',
            now() - make_interval(days => 120 + v_i * 28) + interval '30 minutes',
            now() - make_interval(days => 120 + v_i * 28));
  end loop;
  for v_i in 0..2 loop
    insert into public.appointments
      (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
       starts_at, ends_at, status, completed_at, created_at)
    values (v_org, v_loc, v_barber, v_service, 'OS3 Client Regulier', v_cust_regular,
            now() - make_interval(days => 3 + v_i * 21),
            now() - make_interval(days => 3 + v_i * 21) + interval '30 minutes',
            'completed',
            now() - make_interval(days => 3 + v_i * 21) + interval '30 minutes',
            now() - make_interval(days => 3 + v_i * 21));
    insert into public.appointments
      (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
       starts_at, ends_at, status, completed_at, created_at)
    values (v_org, v_loc, v_barber, v_service, 'OS3 Client Sans Email', v_cust_noemail,
            now() - make_interval(days => 4 + v_i * 21),
            now() - make_interval(days => 4 + v_i * 21) + interval '30 minutes',
            'completed',
            now() - make_interval(days => 4 + v_i * 21) + interval '30 minutes',
            now() - make_interval(days => 4 + v_i * 21));
    insert into public.appointments
      (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
       starts_at, ends_at, status, completed_at, created_at)
    values (v_org, v_loc, v_barber, v_service, 'OS3 Client Desabonne', v_cust_dnc,
            now() - make_interval(days => 5 + v_i * 21),
            now() - make_interval(days => 5 + v_i * 21) + interval '30 minutes',
            'completed',
            now() - make_interval(days => 5 + v_i * 21) + interval '30 minutes',
            now() - make_interval(days => 5 + v_i * 21));
  end loop;
  for v_i in 0..1 loop
    insert into public.appointments
      (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
       starts_at, ends_at, status, completed_at, booked_by_user_id, created_at)
    values (v_org, v_loc, v_barber, v_service, 'OS3 Client Fidele', v_cust_loyal,
            now() - make_interval(days => 40 + v_i * 21),
            now() - make_interval(days => 40 + v_i * 21) + interval '30 minutes',
            'completed',
            now() - make_interval(days => 40 + v_i * 21) + interval '30 minutes',
            v_customer_user,
            now() - make_interval(days => 40 + v_i * 21));
  end loop;
  -- Une prestation très ancienne : elle rend la fenêtre de comparaison
  -- LÉGITIME (l'activité précède la fenêtre précédente).
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name, customer_id,
     starts_at, ends_at, status, completed_at, created_at)
  values (v_org, v_loc, v_barber, v_service, 'OS3 Ancien', null,
          now() - interval '300 days', now() - interval '300 days' + interval '30 minutes',
          'completed', now() - interval '300 days' + interval '30 minutes',
          now() - interval '300 days');

  -- Une réservation SAISIE AU COMPTOIR (created_by non nul) et une DEMANDE
  -- reçue via FadeUp : les deux doivent être distinguées.
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name,
     starts_at, ends_at, status, created_by, created_at)
  values (v_org, v_loc, v_barber, v_service, 'OS3 Comptoir',
          now() + interval '2 days', now() + interval '2 days' + interval '30 minutes',
          'confirmed', v_owner, now() - interval '1 day');
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name,
     starts_at, ends_at, status, was_request, booked_by_user_id, created_at)
  values (v_org, v_loc, v_barber, v_service, 'OS3 Demande',
          now() + interval '3 days', now() + interval '3 days' + interval '30 minutes',
          'confirmed', true, v_customer_user, now() - interval '1 day');
  -- Une ABSENCE, dans la fenêtre.
  insert into public.appointments
    (organization_id, location_id, barber_id, service_id, customer_name,
     starts_at, ends_at, status, created_at)
  values (v_org, v_loc, v_barber, v_service, 'OS3 Absent',
          now() - interval '2 days', now() - interval '2 days' + interval '30 minutes',
          'no_show', now() - interval '2 days');

  -- Des mesures de durée pour v_service seulement : v_service2 n'en a aucune.
  for v_i in 1..6 loop
    insert into public.service_duration_samples
      (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values (v_org, v_loc, v_barber, v_service, 'queue', gen_random_uuid(),
            now() - make_interval(days => v_i), now() - make_interval(days => v_i) + interval '27 minutes');
  end loop;

  -- ==================================================================
  -- I1. La garde des insights
  -- ==================================================================
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.get_organization_insights(v_org);
    raise exception 'I1a: un appelant sans session doit être refusé';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform * from public.get_organization_insights(v_org);
    raise exception 'I1b: un étranger doit être refusé';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_organization_insights(null);
    raise exception 'I1c: une organisation nulle doit être refusée du même refus';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- I2. Le revenu : le réglage d'OS-1 s'applique aux insights
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  select * into v_ins from public.get_organization_insights(v_org);
  if v_ins is null then
    raise exception 'I2a: un barber doit pouvoir OUVRIR ses insights';
  end if;
  if v_ins.revenue_visible then
    raise exception 'I2b: un barber sans droit ne doit pas voir le revenu';
  end if;
  if v_ins.revenue_cents is not null then
    raise exception 'I2c: le revenu doit être NULL (jamais zéro), reçu %', v_ins.revenue_cents;
  end if;
  if v_ins.no_show_cost_cents is not null or v_ins.average_ticket_cents is not null
     or v_ins.previous_revenue_cents is not null then
    raise exception 'I2d: tout montant agrégé doit être NULL pour qui ne voit pas le revenu';
  end if;
  -- Les chiffres NON monétaires restent lisibles : masquer le revenu ne
  -- ferme pas l'écran.
  if v_ins.services_delivered is null then
    raise exception 'I2e: le nombre de prestations doit rester lisible sans droit de revenu';
  end if;

  -- Le réceptionniste ne voit jamais les montants, même sans réglage.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_receptionist, 'role', 'authenticated')::text, true);
  select * into v_ins from public.get_organization_insights(v_org);
  if v_ins.revenue_visible then
    raise exception 'I2f: un réceptionniste ne voit jamais le revenu';
  end if;

  -- Le patron l'ouvre au barber (OS-1), et l'écran change.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_membership_revenue_visibility(v_membership, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  select * into v_ins from public.get_organization_insights(v_org);
  if not v_ins.revenue_visible or v_ins.revenue_cents is null then
    raise exception 'I2g: le réglage d''OS-1 doit ouvrir le revenu dans les insights';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform public.set_membership_revenue_visibility(v_membership, false);

  -- ==================================================================
  -- I3. Ce que FadeUp a apporté, distingué du comptoir
  -- ==================================================================
  select * into v_ins from public.get_organization_insights(v_org);
  if not v_ins.revenue_visible then
    raise exception 'I3a: le propriétaire voit toujours le revenu';
  end if;
  if v_ins.counter_bookings < 1 then
    raise exception 'I3b: la réservation saisie au comptoir doit être comptée à part, reçu %', v_ins.counter_bookings;
  end if;
  if v_ins.fadeup_bookings < 1 then
    raise exception 'I3c: la réservation reçue via FadeUp doit être comptée, reçu %', v_ins.fadeup_bookings;
  end if;
  if v_ins.requests_received < 1 or v_ins.requests_converted < 1 then
    raise exception 'I3d: la demande reçue et convertie doit être comptée (% / %)',
      v_ins.requests_received, v_ins.requests_converted;
  end if;
  -- Le revenu est la somme des prix des prestations TERMINÉES de la fenêtre.
  select count(*) into v_count
  from private.organization_delivered_in_window(v_org, v_ins.window_from, v_ins.window_to);
  if v_ins.services_delivered <> v_count then
    raise exception 'I3e: prestations livrées incohérentes (% vs %)', v_ins.services_delivered, v_count;
  end if;
  if v_ins.revenue_cents <> v_count * 3000 then
    raise exception 'I3f: revenu attendu % centimes, reçu %', v_count * 3000, v_ins.revenue_cents;
  end if;

  -- ==================================================================
  -- I4. Aucune tendance sans période de comparaison réelle
  -- ==================================================================
  if not v_ins.comparison_available then
    raise exception 'I4a: une activité vieille de 300 jours REND la comparaison légitime sur 30 jours';
  end if;
  -- Une fenêtre de trois jours n'est pas une tendance.
  select * into v_prev from public.get_organization_insights(v_org, now() - interval '3 days', now());
  if v_prev.comparison_available then
    raise exception 'I4b: trois jours ne composent pas une tendance';
  end if;

  -- ==================================================================
  -- I5. Les absences et leur coût
  -- ==================================================================
  if v_ins.no_show_count < 1 then
    raise exception 'I5a: l''absence de la fenêtre doit être comptée';
  end if;
  if v_ins.no_show_cost_cents <> v_ins.no_show_count * 3000 then
    raise exception 'I5b: coût des absences attendu %, reçu %',
      v_ins.no_show_count * 3000, v_ins.no_show_cost_cents;
  end if;

  -- ==================================================================
  -- I6. Une organisation sans historique n'affiche pas des zéros décoratifs
  -- ==================================================================
  insert into public.memberships (organization_id, user_id, role)
  values (v_org2, v_owner, 'owner')
  on conflict do nothing;
  delete from public.appointments where organization_id = v_org2;
  delete from public.queue_entries where organization_id = v_org2;
  select * into v_prev from public.get_organization_insights(v_org2);
  if v_prev.first_activity_at is not null then
    raise exception 'I6a: une organisation sans historique n''a pas de première activité';
  end if;
  if v_prev.comparison_available then
    raise exception 'I6b: sans historique, aucune tendance';
  end if;
  if v_prev.services_delivered <> 0 then
    raise exception 'I6c: sans historique, le compte est un vrai zéro';
  end if;

  -- ==================================================================
  -- I7. Durées annoncées contre observées
  -- ==================================================================
  v_count := 0;
  for v_gap in select * from public.get_organization_duration_gaps(v_org) loop
    v_count := v_count + 1;
    if v_gap.service_id = v_service2 then
      raise exception 'I7a: un service SANS mesure ne doit pas figurer';
    end if;
    if v_gap.service_id = v_service then
      if v_gap.declared_minutes <> 30 then
        raise exception 'I7b: durée annoncée attendue 30, reçue %', v_gap.declared_minutes;
      end if;
      if v_gap.observed_minutes is null or v_gap.sample_count < 6 then
        raise exception 'I7c: durée observée attendue sur 6 mesures, reçu % / %',
          v_gap.observed_minutes, v_gap.sample_count;
      end if;
    end if;
  end loop;
  if v_count < 1 then
    raise exception 'I7d: le service mesuré doit être rendu';
  end if;
  if v_loc2 is not null then
    begin
      perform * from public.get_organization_duration_gaps(v_org, v_loc2);
      raise exception 'I7e: un lieu d''une autre organisation doit être refusé';
    exception when invalid_parameter_value then null;
    end;
  end if;

  -- ==================================================================
  -- Q1. Le plafond vit en base, aux valeurs du fondateur
  -- ==================================================================
  select count(*) into v_count from public.commercial_plans p
  where (p.plan_key, p.monthly_campaign_allowance) in
    (('free', 3), ('solo', 10), ('salon_essential', 20), ('salon_pro', 50), ('salon_business', 100));
  if v_count <> 5 then
    raise exception 'Q1a: les cinq plafonds du fondateur doivent être en base, % trouvés', v_count;
  end if;
  select count(*) into v_count from public.commercial_plans p
  where p.commercial_family = 'multi_salon' and p.monthly_campaign_allowance is not null;
  if v_count <> 0 then
    raise exception 'Q1b: la famille multi_salon est illimitée (NULL), % plafonnés', v_count;
  end if;

  -- ==================================================================
  -- Q2. Le compteur, le reste, et le plan supérieur
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  begin
    perform * from public.get_campaign_quota(v_org);
    raise exception 'Q2a: un barber ne lit pas le quota de campagnes';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select * into v_quota from public.get_campaign_quota(v_org);
  if v_quota.period_month <> date_trunc('month', now())::date then
    raise exception 'Q2b: le mois de comptage doit être le mois courant';
  end if;
  if v_quota.used <> 0 then
    raise exception 'Q2c: le compteur part de zéro, reçu %', v_quota.used;
  end if;
  if v_quota.monthly_allowance is null then
    raise exception 'Q2d: le plan effectif de la fixture doit être plafonné (essai ou free)';
  end if;
  if v_quota.remaining <> v_quota.monthly_allowance then
    raise exception 'Q2e: reste attendu %, reçu %', v_quota.monthly_allowance, v_quota.remaining;
  end if;

  -- ==================================================================
  -- C6. Pas de message libre : les cinq refus de l'accroche
  -- ==================================================================
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', '   ',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C6a: une accroche vide doit être refusée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', repeat('a', 200),
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C6b: une accroche de 200 caractères doit être refusée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', E'deux\nlignes',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C6c: une accroche multiligne doit être refusée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'venez sur https://ailleurs.example',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C6d: une accroche contenant un lien doit être refusée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'bonjour {{unsubscribe_url}}',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C6e: une accroche contenant un jeton de gabarit doit être refusée';
  exception when invalid_parameter_value then null;
  end;

  -- ==================================================================
  -- C7. Promotion : la période est vérifiée
  -- ==================================================================
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Offre du mois',
      jsonb_build_object('offer', '-20%'));
    raise exception 'C7a: une promotion sans date de fin doit être refusée';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Offre du mois',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() - interval '1 day')::date::text));
    raise exception 'C7b: une promotion déjà expirée doit être refusée';
  exception when invalid_parameter_value then null;
  end;

  -- ==================================================================
  -- C2. Un pro n'écrit qu'à ses clients ; les rôles sont bornés
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Offre du mois',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C2a: un barber ne doit pas pouvoir écrire aux clients';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_receptionist, 'role', 'authenticated')::text, true);
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Offre du mois',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C2b: un réceptionniste ne doit pas pouvoir écrire aux clients';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Offre du mois',
      jsonb_build_object('offer', '-20%', 'valid_until', (now() + interval '7 days')::date::text));
    raise exception 'C2c: un étranger doit être refusé';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- C3. do_not_contact exclut de l'audience
  -- ==================================================================
  update public.customers set do_not_contact = true where id = v_cust_dnc;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select * into v_preview from public.preview_notification_campaign(v_org, 'promotion');
  if v_preview.do_not_contact_count < 1 then
    raise exception 'C3a: le client désabonné doit être compté comme exclu';
  end if;
  if v_preview.no_email_count < 1 then
    raise exception 'C3b: le client sans adresse doit être compté comme injoignable';
  end if;

  -- ==================================================================
  -- C1. Les quatre modèles partent, et par email_outbox uniquement
  -- ==================================================================
  select count(*) into v_count from public.email_outbox;
  select count(*) into v_count2 from public.notifications;

  select * into v_send from public.send_notification_campaign(
    v_org, 'promotion', 'Dix pour cent sur la coupe ce mois-ci',
    jsonb_build_object('offer', '-10% sur la coupe', 'valid_until', (now() + interval '20 days')::date::text));
  if v_send.recipient_count < 1 then
    raise exception 'C1a: la promotion doit atteindre au moins un client';
  end if;
  if v_send.campaign_id is null then
    raise exception 'C1b: la campagne doit être tracée';
  end if;

  -- Le client désabonné et le client sans adresse ne sont PAS destinataires.
  if exists (select 1 from public.notification_campaign_recipients r
             where r.campaign_id = v_send.campaign_id
               and r.customer_id in (v_cust_dnc, v_cust_noemail)) then
    raise exception 'C3c: un désabonné ou un client sans adresse ne doit jamais être destinataire';
  end if;
  -- Le client d'une AUTRE organisation n'est jamais destinataire.
  if exists (select 1 from public.notification_campaign_recipients r
             where r.campaign_id = v_send.campaign_id and r.customer_id = v_cust_other) then
    raise exception 'C2d: le client d''un autre salon ne doit jamais être destinataire';
  end if;

  -- Rien d'autre qu'email_outbox n'a été écrit : aucun envoi parallèle.
  select count(*) into v_count2 from public.notifications;
  if v_count2 <> (select count(*) from public.notifications) then
    raise exception 'C1c: incohérence de comptage';
  end if;
  select count(*) into v_count2 from public.email_outbox where stream = 'marketing';
  if v_count2 < v_send.recipient_count then
    raise exception 'C1d: chaque destinataire doit avoir sa ligne email_outbox (% pour %)',
      v_count2, v_send.recipient_count;
  end if;
  if not exists (
    select 1 from public.email_outbox o
    join public.notification_campaign_recipients r on r.outbox_id = o.id
    where r.campaign_id = v_send.campaign_id
      and o.dedupe_key like 'campaign:' || v_send.campaign_id::text || ':%'
      and o.template = 'campaign_promotion'
      and o.stream = 'marketing'
  ) then
    raise exception 'C1e: la ligne d''envoi doit porter le gabarit, le flux et la clé d''idempotence attendus';
  end if;

  -- Les trois autres modèles.
  select * into v_send from public.send_notification_campaign(
    v_org, 'lapsed_customers', 'Ça fait un moment, on vous remet en forme ?',
    jsonb_build_object('threshold_days', 60));
  if v_send.recipient_count < 1 then
    raise exception 'C1f: le modèle « clients non revenus » doit atteindre le client en retard';
  end if;
  if not exists (select 1 from public.notification_campaign_recipients r
                 where r.campaign_id = v_send.campaign_id and r.customer_id = v_cust_lapsed) then
    raise exception 'C1g: le client non revenu depuis 120 jours doit être destinataire';
  end if;
  -- Le régulier revenu il y a trois jours n'est PAS concerné.
  if exists (select 1 from public.notification_campaign_recipients r
             where r.campaign_id = v_send.campaign_id and r.customer_id = v_cust_regular) then
    raise exception 'C1h: un client revenu récemment n''est pas « non revenu »';
  end if;

  select * into v_send from public.send_notification_campaign(
    v_org, 'loyalty_reminder', 'C''est bientôt l''heure de votre coupe');
  if not exists (select 1 from public.notification_campaign_recipients r
                 where r.campaign_id = v_send.campaign_id and r.customer_id = v_cust_loyal) then
    raise exception 'C1i: le client à cadence déclarée dépassée doit être destinataire';
  end if;
  -- Un client SANS cadence déclarée n'est jamais rappelé : aucune cadence
  -- inventée.
  if exists (select 1 from public.notification_campaign_recipients r
             where r.campaign_id = v_send.campaign_id and r.customer_id = v_cust_lapsed) then
    raise exception 'C1j: sans cadence déclarée, pas de rappel de fidélité';
  end if;

  select * into v_send from public.send_notification_campaign(
    v_org, 'free_slots_tomorrow', 'Il reste de la place demain',
    jsonb_build_object('service_id', v_service::text));
  if v_send.recipient_count < 1 then
    raise exception 'C1k: le modèle « créneaux libres demain » doit atteindre les réguliers';
  end if;
  if not exists (
    select 1 from public.email_outbox o
    join public.notification_campaign_recipients r on r.outbox_id = o.id
    where r.campaign_id = v_send.campaign_id
      and (o.payload ->> 'slot_count')::integer > 0
  ) then
    raise exception 'C1l: le nombre de créneaux annoncé doit être réel et strictement positif';
  end if;

  -- ==================================================================
  -- C8. Créneaux libres : les refus
  -- ==================================================================
  begin
    perform * from public.send_notification_campaign(v_org, 'free_slots_tomorrow', 'Demain');
    raise exception 'C8a: sans prestation choisie, le modèle doit être refusé';
  exception when invalid_parameter_value then null;
  end;
  if v_service_other is not null then
    begin
      perform * from public.send_notification_campaign(v_org, 'free_slots_tomorrow', 'Demain',
        jsonb_build_object('service_id', v_service_other::text));
      raise exception 'C8b: une prestation d''un autre salon doit être refusée';
    exception when invalid_parameter_value then null;
    end;
  end if;
  -- Lieu fermé demain : aucun créneau, donc refus nommé plutôt qu'un
  -- e-mail qui annonce des créneaux inexistants.
  update public.location_hours set is_closed = true
   where location_id = v_loc
     and day_of_week = extract(dow from ((now() at time zone v_tz)::date + 1))::integer;
  begin
    perform * from public.send_notification_campaign(v_org, 'free_slots_tomorrow', 'Demain',
      jsonb_build_object('service_id', v_service::text));
    raise exception 'C8c: sans créneau réel demain, le modèle doit être refusé';
  exception when raise_exception then null;
  end;
  update public.location_hours set is_closed = false where location_id = v_loc;

  -- ==================================================================
  -- C4. Heures calmes : programmées, jamais annulées
  -- ==================================================================
  -- 23 h heure de Paris → 08:00 le lendemain.
  v_next := private.marketing_next_attempt_at('Europe/Paris',
    (date_trunc('day', now()) + interval '22 hours') at time zone 'UTC' at time zone 'UTC');
  v_next := private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 21:30:00+02');
  if extract(hour from (v_next at time zone 'Europe/Paris')) <> 8
     or (v_next at time zone 'Europe/Paris')::date <> date '2026-06-16' then
    raise exception 'C4a: 21h30 doit être reporté à 08:00 le lendemain, reçu %',
      v_next at time zone 'Europe/Paris';
  end if;
  v_next := private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 04:30:00+02');
  if extract(hour from (v_next at time zone 'Europe/Paris')) <> 8
     or (v_next at time zone 'Europe/Paris')::date <> date '2026-06-15' then
    raise exception 'C4b: 04h30 doit être reporté à 08:00 le même jour, reçu %',
      v_next at time zone 'Europe/Paris';
  end if;
  v_next := private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 14:00:00+02');
  if v_next <> timestamptz '2026-06-15 14:00:00+02' then
    raise exception 'C4c: 14h00 est dans la fenêtre et ne doit pas être reporté';
  end if;
  -- Un fuseau absent replie sur Europe/Paris, jamais sur UTC.
  if private.marketing_next_attempt_at(null, timestamptz '2026-06-15 14:00:00+02')
     <> private.marketing_next_attempt_at('Europe/Paris', timestamptz '2026-06-15 14:00:00+02') then
    raise exception 'C4d: un fuseau absent doit replier sur Europe/Paris';
  end if;
  -- Et l'envoi écrit bien next_attempt_at, jamais une ligne qui n'existe pas.
  if exists (
    select 1 from public.email_outbox o
    join public.notification_campaign_recipients r on r.outbox_id = o.id
    join public.notification_campaigns c on c.id = r.campaign_id
    where c.organization_id = v_org and o.next_attempt_at <> c.scheduled_at
  ) then
    raise exception 'C4e: chaque envoi doit porter l''instant programmé de sa campagne';
  end if;

  -- ==================================================================
  -- C5. Fréquence : deux par semaine et par personne, tous salons confondus
  -- ==================================================================
  -- Le client régulier a déjà reçu la promotion et les créneaux : deux
  -- sollicitations en moins de sept jours. La troisième doit l'exclure.
  select count(*) into v_count
  from public.notification_campaign_recipients r
  where lower(r.to_email) = 'os3-regular@fadeup.test'
    and r.created_at >= now() - interval '7 days';
  if v_count < 2 then
    raise exception 'C5a: la fixture doit avoir déjà sollicité ce client deux fois, reçu %', v_count;
  end if;
  if exists (
    select 1 from private.campaign_audience(v_org, 'promotion', '{}'::jsonb) a
    where a.to_email = 'os3-regular@fadeup.test' and a.blocked_reason is distinct from 'frequency_cap'
  ) then
    raise exception 'C5b: un client déjà sollicité deux fois cette semaine doit être exclu';
  end if;

  -- ==================================================================
  -- C9. La trace et le résultat
  -- ==================================================================
  select * into v_camp from public.list_notification_campaigns(v_org, 20) limit 1;
  if v_camp.campaign_id is null then
    raise exception 'C9a: l''historique doit rendre les campagnes';
  end if;
  if v_camp.total_count < 4 then
    raise exception 'C9b: quatre campagnes ont été envoyées, total reçu %', v_camp.total_count;
  end if;
  if not exists (select 1 from public.notification_campaigns c
                 where c.organization_id = v_org and c.created_by = v_owner) then
    raise exception 'C9c: la campagne doit porter son auteur';
  end if;
  if exists (select 1 from public.notification_campaigns c
             where c.organization_id = v_org
               and c.period_month <> date_trunc('month', now())::date) then
    raise exception 'C9d: le mois de comptage doit être figé au mois d''envoi';
  end if;

  -- ==================================================================
  -- Q3. Au plafond, l'envoi est refusé CÔTÉ SERVEUR
  -- ==================================================================
  select * into v_quota from public.get_campaign_quota(v_org);
  if v_quota.used < 4 then
    raise exception 'Q3a: le compteur doit avoir suivi les quatre envois, reçu %', v_quota.used;
  end if;
  -- On amène l'organisation au plafond en la plaçant sur le plan Free, dont
  -- le plafond est 3 — déjà dépassé par les quatre campagnes.
  update public.organization_trials set status = 'expired', ends_at = now() - interval '1 day',
         expired_at = now() - interval '1 day'
   where organization_id = v_org;
  update public.organization_commercial_state set plan_key = 'free', status = 'active'
   where organization_id = v_org;
  select * into v_quota from public.get_campaign_quota(v_org);
  if v_quota.monthly_allowance <> 3 then
    raise exception 'Q3b: le plan Free ouvre trois campagnes, reçu %', v_quota.monthly_allowance;
  end if;
  if v_quota.remaining <> 0 then
    raise exception 'Q3c: au-delà du plafond, le reste est zéro et jamais négatif, reçu %', v_quota.remaining;
  end if;
  if v_quota.next_plan_key is null or v_quota.next_plan_allowance <= v_quota.monthly_allowance then
    raise exception 'Q3d: un plan supérieur doit être proposé avec un plafond strictement plus grand';
  end if;
  select count(*) into v_count from public.notification_campaigns where organization_id = v_org;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Encore une offre',
      jsonb_build_object('offer', '-5%', 'valid_until', (now() + interval '5 days')::date::text));
    raise exception 'Q3e: au plafond, l''envoi doit être refusé';
  exception when raise_exception then
    get stacked diagnostics v_text = pg_exception_detail;
    if position('fadeup_campaign_refusal=allowance_reached' in coalesce(v_text, '')) = 0 then
      raise exception 'Q3f: le refus de plafond doit porter son motif nommé, reçu %', v_text;
    end if;
  end;
  select count(*) into v_count2 from public.notification_campaigns where organization_id = v_org;
  if v_count2 <> v_count then
    raise exception 'Q3g: un envoi refusé ne doit laisser aucune campagne';
  end if;

  -- ==================================================================
  -- C10. Une campagne sans destinataire ne consomme pas le plafond
  -- ==================================================================
  update public.organization_commercial_state set plan_key = 'salon_pro', status = 'active'
   where organization_id = v_org;
  update public.customers set do_not_contact = true where organization_id = v_org;
  select count(*) into v_count from public.notification_campaigns where organization_id = v_org;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'Personne à joindre',
      jsonb_build_object('offer', '-5%', 'valid_until', (now() + interval '5 days')::date::text));
    raise exception 'C10a: sans destinataire joignable, l''envoi doit être refusé';
  exception when raise_exception then
    get stacked diagnostics v_text = pg_exception_detail;
    if position('fadeup_campaign_refusal=no_recipient' in coalesce(v_text, '')) = 0 then
      raise exception 'C10b: le refus doit porter son motif nommé, reçu %', v_text;
    end if;
  end;
  select count(*) into v_count2 from public.notification_campaigns where organization_id = v_org;
  if v_count2 <> v_count then
    raise exception 'C10c: une campagne annulée ne doit pas rester en base';
  end if;
  update public.customers set do_not_contact = false where organization_id = v_org;

  -- ==================================================================
  -- C3bis. Le désabonnement : global, définitif, et il vide la file
  -- ==================================================================
  update public.customers set do_not_contact = false where id = v_cust_dnc;
  -- La même adresse dans DEUX organisations.
  update public.customers set email = 'os3-shared@fadeup.test' where id = v_cust_regular;
  update public.customers set email = 'os3-shared@fadeup.test' where id = v_cust_other;
  select marketing_unsubscribe_token into v_token from public.customers where id = v_cust_regular;
  if v_token is null then
    raise exception 'C3d: une fiche cliente doit porter un jeton de désabonnement';
  end if;
  -- Une sollicitation en file pour cette adresse, qui doit être retirée.
  insert into public.email_outbox (to_email, template, locale, payload, stream, dedupe_key)
  values ('os3-shared@fadeup.test', 'campaign_promotion', 'fr',
          jsonb_build_object('customer_name', 'x', 'organization_name', 'y', 'headline', 'z',
                             'profile_url', 'u', 'unsubscribe_url', 'v', 'offer', 'o',
                             'period_fr', 'p', 'period_en', 'p'),
          'marketing', 'os3-test-queued');
  perform set_config('request.jwt.claims', '', true);
  select unsubscribed into v_ok from public.unsubscribe_customer_marketing(v_token);
  if not v_ok then
    raise exception 'C3e: le désabonnement doit répondre vrai';
  end if;
  if not (select do_not_contact from public.customers where id = v_cust_regular)
     or not (select do_not_contact from public.customers where id = v_cust_other) then
    raise exception 'C3f: le désabonnement est GLOBAL — toutes les fiches de l''adresse';
  end if;
  if (select status from public.email_outbox where dedupe_key = 'os3-test-queued') <> 'failed' then
    raise exception 'C3g: une sollicitation en file doit être retirée au désabonnement';
  end if;
  -- Un jeton inventé répond vrai et ne change rien : pas d'oracle.
  select unsubscribed into v_ok from public.unsubscribe_customer_marketing('000000000000000000000000ffffffff');
  if not v_ok then
    raise exception 'C3h: un jeton inconnu doit répondre vrai (anti-énumération)';
  end if;
  -- Et le transactionnel n'est jamais touché.
  if exists (select 1 from public.email_outbox
             where stream = 'transactional' and status = 'failed'
               and last_error = 'recipient unsubscribed before dispatch') then
    raise exception 'C3i: le désabonnement ne doit jamais toucher le transactionnel';
  end if;

  -- ==================================================================
  -- Z0. Le motif nul : la garde lève quand auth.uid() est NULL
  -- ==================================================================
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.get_campaign_quota(v_org);
    raise exception 'Z0a: get_campaign_quota doit refuser une session absente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.preview_notification_campaign(v_org, 'promotion');
    raise exception 'Z0b: preview_notification_campaign doit refuser une session absente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.send_notification_campaign(v_org, 'promotion', 'x',
      jsonb_build_object('offer', 'o', 'valid_until', (now() + interval '5 days')::date::text));
    raise exception 'Z0c: send_notification_campaign doit refuser une session absente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.list_notification_campaigns(v_org);
    raise exception 'Z0d: list_notification_campaigns doit refuser une session absente';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_organization_duration_gaps(v_org);
    raise exception 'Z0e: get_organization_duration_gaps doit refuser une session absente';
  exception when insufficient_privilege then null;
  end;

  raise notice 'VERIFY OS-3 : toutes les assertions passent';
end;
$verify$;

-- ==================================================================
-- Z1. Les droits d'exécution : anon n'a rien, sauf le désabonnement
-- ==================================================================
do $acl$
declare
  v_fn text;
  v_missing text := '';
  v_extra text := '';
begin
  foreach v_fn in array array[
    'get_organization_insights', 'get_organization_duration_gaps',
    'get_campaign_quota', 'preview_notification_campaign',
    'send_notification_campaign', 'list_notification_campaigns'
  ] loop
    if exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(p.proacl) a
      where p.pronamespace = 'public'::regnamespace and p.proname = v_fn
        and a.privilege_type = 'EXECUTE' and a.grantee::regrole::text = 'anon'
    ) then
      v_extra := v_extra || v_fn || ' ';
    end if;
    if not exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(p.proacl) a
      where p.pronamespace = 'public'::regnamespace and p.proname = v_fn
        and a.privilege_type = 'EXECUTE' and a.grantee::regrole::text = 'authenticated'
    ) then
      v_missing := v_missing || v_fn || ' ';
    end if;
  end loop;

  if v_extra <> '' then
    raise exception 'Z1a: ces RPC ne doivent PAS être exécutables par anon : %', v_extra;
  end if;
  if v_missing <> '' then
    raise exception 'Z1b: grant execute manquant pour authenticated : %', v_missing;
  end if;

  -- Le désabonnement, lui, DOIT l'être : le destinataire d'un e-mail n'a
  -- pas de session. Il est au contrat de surface anonyme de X3.
  if not exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and p.proname = 'unsubscribe_customer_marketing'
      and a.privilege_type = 'EXECUTE' and a.grantee::regrole::text = 'anon'
  ) then
    raise exception 'Z1c: unsubscribe_customer_marketing doit être exécutable par anon';
  end if;

  -- Les fonctions privées ne sont jamais exécutables par un client.
  foreach v_fn in array array[
    'insights_window', 'organization_delivered_in_window', 'campaign_monthly_allowance',
    'marketing_next_attempt_at', 'assert_campaign_text', 'declared_cadence_days',
    'campaign_free_slots_tomorrow', 'campaign_audience'
  ] loop
    if exists (
      select 1 from pg_proc p
      cross join lateral aclexplode(p.proacl) a
      where p.pronamespace = 'private'::regnamespace and p.proname = v_fn
        and a.privilege_type = 'EXECUTE' and a.grantee::regrole::text in ('anon', 'authenticated')
    ) then
      raise exception 'Z1d: private.% ne doit pas être exécutable par un client', v_fn;
    end if;
  end loop;

  -- Les deux tables neuves : lecture pour authenticated, rien pour anon,
  -- aucune écriture pour personne d'autre que les fonctions definer.
  foreach v_fn in array array['notification_campaigns', 'notification_campaign_recipients'] loop
    if exists (
      select 1 from pg_class c
      cross join lateral aclexplode(c.relacl) a
      where c.oid = ('public.' || v_fn)::regclass
        and a.grantee::regrole::text = 'anon'
    ) then
      raise exception 'Z1e: public.% ne doit accorder aucun privilège à anon', v_fn;
    end if;
    if exists (
      select 1 from pg_class c
      cross join lateral aclexplode(c.relacl) a
      where c.oid = ('public.' || v_fn)::regclass
        and a.grantee::regrole::text = 'authenticated'
        and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ) then
      raise exception 'Z1f: public.% ne doit accorder aucune écriture à authenticated', v_fn;
    end if;
    if not (select relrowsecurity and relforcerowsecurity
            from pg_class where oid = ('public.' || v_fn)::regclass) then
      raise exception 'Z1g: public.% doit avoir la RLS activée ET forcée', v_fn;
    end if;
  end loop;

  raise notice 'VERIFY OS-3 ACL : toutes les assertions passent';
end;
$acl$;

rollback;
