-- FadeUp — vérification OS-1 : forçage de chevauchement tracé, réservation
-- manuelle, permission de revenu, collecte des durées, série de blocages.
--
-- Modèle verify_p1pro : UNE transaction, des assertions qui lèvent, ROLLBACK
-- final — ce script ne laisse RIEN derrière lui. Conçu pour le bac d'essai de
-- restauration fidèle (b3_restore_sandbox.sh), pas pour la production.
--
--   O1  deux rendez-vous ordinaires ne se chevauchent toujours pas (23P01,
--       motif slot_conflict), trace NULL par défaut
--   O2  forcer est REFUSÉ au client (force_not_allowed), au barber
--       (not_authorized — il ne déplace pas), au réceptionniste
--       (force_not_allowed) ; sans motif → force_reason_required
--   O3  l'owner force : trace sur la ligne (qui, quand, pourquoi) + journal
--       appointment_overlap_forces avec l'identifiant du rendez-vous recouvert
--   O4  rien d'ordinaire ne se pose sur du forcé : reschedule ordinaire
--       refusé (23P01 slot_conflict), booking public refusé
--   O5  un déplacement ORDINAIRE de la ligne forcée efface la trace ; un
--       forçage sans conflit réel ne pose PAS de trace
--   O6  create_appointment_as_business : barber refusé, réceptionniste crée
--       (confirmed, client rattaché, created_by), hors horaires refusé,
--       forçage réceptionniste refusé, forçage owner tracé (action create)
--   O7  « terminé » alimente service_duration_samples (source appointment,
--       starts_at → completed_at horodaté serveur)
--   O8  revenu : défaut « ne voit pas » (price_cents NULL pour le barber),
--       l'owner règle → le barber voit ; manager refusé (42501) ; cible non
--       barber refusée (22023) ; le réceptionniste ne voit pas
--   O9  time_blocks.series_id : une série s'insère en un INSERT sous RLS
--       (authenticated) et se retire d'un coup ; RLS refuse l'étranger

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_slug text;
  v_loc uuid;
  v_tz text;
  v_barber uuid;          -- barber A (rattaché au compte v_barber_user)
  v_barber_b uuid;        -- barber B (sans compte)
  v_service uuid;
  v_owner uuid;
  v_manager uuid;
  v_receptionist uuid;
  v_barber_user uuid;
  v_customer_user uuid;
  v_stranger_user uuid;
  v_users uuid[];
  v_barber_membership uuid;
  v_appt public.appointments;
  v_appt2 public.appointments;
  v_row record;
  v_detail text;
  v_state text;
  v_day date;
  v_t10 timestamptz;
  v_t11 timestamptz;
  v_t12 timestamptz;
  v_t14 timestamptz;
  v_i integer;
  v_count bigint;
  v_series uuid;
  v_price integer;
begin
  -- ------------------------------------------------------------------
  -- Fixture : une organisation qa-f1 réactivée (motif verify_p1pro).
  -- ------------------------------------------------------------------
  select o.id, o.slug into v_org, v_slug
  from public.organizations o
  where o.slug like 'qa-f1-%'
  order by o.slug limit 1;
  if v_org is null then
    raise exception 'FIXTURE: aucune organisation qa-f1';
  end if;

  select m.user_id into v_owner
  from public.memberships m
  where m.organization_id = v_org and m.role = 'owner'
  limit 1;
  if v_owner is null then
    raise exception 'FIXTURE: aucun owner sur %', v_slug;
  end if;

  -- Cinq comptes auth EXISTANTS hors de toute organisation : manager,
  -- réceptionniste, barber salarié, client, étranger.
  select array_agg(id) into v_users
  from (
    select u.id
    from auth.users u
    where u.email like '%@fadeup.test'
      and not exists (select 1 from public.memberships m where m.user_id = u.id)
      and not exists (select 1 from public.staff_profiles sp where sp.user_id = u.id)
    order by u.email
    limit 5
  ) users;
  if coalesce(array_length(v_users, 1), 0) <> 5 then
    raise exception 'FIXTURE: pas assez de comptes @fadeup.test hors organisation (5 requis)';
  end if;
  v_manager := v_users[1];
  v_receptionist := v_users[2];
  v_barber_user := v_users[3];
  v_customer_user := v_users[4];
  v_stranger_user := v_users[5];

  insert into public.memberships (organization_id, user_id, role) values
    (v_org, v_manager, 'manager'),
    (v_org, v_receptionist, 'receptionist'),
    (v_org, v_barber_user, 'barber');
  select id into v_barber_membership from public.memberships
   where organization_id = v_org and user_id = v_barber_user;

  select l.id, l.timezone into v_loc, v_tz
  from public.locations l
  where l.organization_id = v_org and l.kind = 'physical_address'
  limit 1;
  update public.locations set is_active = true where id = v_loc;
  perform private.ensure_location_service_settings(v_loc);
  update public.location_service_settings
     set default_service_mode = 'hybrid'
   where location_id = v_loc;

  -- Barber A = le compte barber salarié ; barber B = un fauteuil sans compte.
  -- (handle_new_membership a déjà créé la fiche staff du membre : on la
  -- complète au lieu de l'insérer.)
  update public.staff_profiles
     set location_id = v_loc, display_name = 'OS1 Barber A', is_public = true, is_active = true
   where organization_id = v_org and user_id = v_barber_user;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select v_org, sp.id, true from public.staff_profiles sp where sp.organization_id = v_org and sp.user_id = v_barber_user
  returning id into v_barber;
  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
  values (v_org, null, v_loc, 'OS1 Barber B', true, true);
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select v_org, sp.id, true from public.staff_profiles sp where sp.organization_id = v_org and sp.display_name = 'OS1 Barber B'
  returning id into v_barber_b;

  select s.id into v_service from public.services s
  where s.organization_id = v_org and s.is_active limit 1;
  if v_service is null then
    raise exception 'FIXTURE: aucun service actif sur %', v_slug;
  end if;
  update public.services set duration_minutes = 30, buffer_before_minutes = 0, buffer_after_minutes = 0, price_cents = 2500
   where id = v_service;
  insert into public.service_locations (organization_id, service_id, location_id)
  values (v_org, v_service, v_loc) on conflict do nothing;
  insert into public.barber_services (organization_id, barber_id, service_id)
  values (v_org, v_barber, v_service), (v_org, v_barber_b, v_service) on conflict do nothing;

  delete from public.location_hours where location_id = v_loc;
  delete from public.barber_working_hours where barber_id in (v_barber, v_barber_b);
  for v_i in 0..6 loop
    insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
    values (v_org, v_loc, v_i, false, time '08:00', time '20:00');
    insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
    values (v_org, v_barber, v_i, false, time '08:00', time '20:00'),
           (v_org, v_barber_b, v_i, false, time '08:00', time '20:00');
  end loop;

  -- Capacité booking : le forçage se joue sur des rendez-vous CONFIRMÉS.
  update public.organization_trials
     set status = 'active', ends_at = now() + interval '7 days', expired_at = null
   where organization_id = v_org;
  if not private.org_has_capability(v_org, 'booking') then
    raise exception 'FIXTURE: % n''a pas la capacité booking (essai)', v_slug;
  end if;

  v_day := ((now() at time zone v_tz)::date + 2);
  v_t10 := (v_day + time '10:00') at time zone v_tz;
  v_t11 := (v_day + time '11:00') at time zone v_tz;
  v_t12 := (v_day + time '12:00') at time zone v_tz;
  v_t14 := (v_day + time '14:00') at time zone v_tz;

  -- ------------------------------------------------------------------
  -- O1. Deux réservations ordinaires : la seconde sur le même créneau refuse.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user)::text, true);
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, v_t10, 'OS1 Client Un', null, 'qa-os1-un@fadeup.test');
  if v_row.status <> 'confirmed' then
    raise exception 'O1a: attendu confirmed, reçu %', v_row.status;
  end if;
  select * into v_appt from public.appointments where id = v_row.id;
  if v_appt.overlap_forced_at is not null or v_appt.overlap_forced_reason is not null then
    raise exception 'O1b: la trace de forçage doit être NULL par défaut';
  end if;

  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.book_public_appointment(
      v_slug, v_loc, v_barber, v_service, v_t10, 'OS1 Client Deux', null, 'qa-os1-deux@fadeup.test');
    raise exception 'O1c: le même créneau aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '23P01' then
      raise exception 'O1c: SQLSTATE attendu 23P01, reçu %', v_state;
    end if;
  end;

  -- Un second rendez-vous à 11:00 (celui qu'on va déplacer/forcer).
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, v_t11, 'OS1 Client Deux', null, 'qa-os1-deux@fadeup.test');
  select * into v_appt2 from public.appointments where id = v_row.id;

  -- ------------------------------------------------------------------
  -- O2. Forcer est refusé aux rôles non habilités.
  -- ------------------------------------------------------------------
  -- Le client propriétaire du rendez-vous 10:00 (Client Un) : il peut
  -- déplacer, pas forcer.
  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user)::text, true);
  begin
    perform public.reschedule_appointment(v_appt.id, v_t11, null, true, 'je veux');
    raise exception 'O2a: un client ne force jamais';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=force_not_allowed' then
      raise exception 'O2a: detail attendu force_not_allowed, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_barber_user)::text, true);
  begin
    perform public.reschedule_appointment(v_appt2.id, v_t10, null, true, 'je veux');
    raise exception 'O2b: un barber ne déplace pas';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_authorized' then
      raise exception 'O2b: detail attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_receptionist)::text, true);
  begin
    perform public.reschedule_appointment(v_appt2.id, v_t10, null, true, 'client insistant');
    raise exception 'O2c: un réceptionniste ne force pas';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=force_not_allowed' then
      raise exception 'O2c: detail attendu force_not_allowed, reçu %', v_detail;
    end if;
  end;
  -- Sans forçage, le réceptionniste subit la contrainte comme tout le monde.
  begin
    perform public.reschedule_appointment(v_appt2.id, v_t10);
    raise exception 'O2d: sans forçage, le chevauchement aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '23P01' then
      raise exception 'O2d: SQLSTATE attendu 23P01, reçu %', v_state;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.reschedule_appointment(v_appt2.id, v_t10, null, true, '   ');
    raise exception 'O2e: forcer sans motif aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=force_reason_required' then
      raise exception 'O2e: detail attendu force_reason_required, reçu %', v_detail;
    end if;
  end;

  -- ------------------------------------------------------------------
  -- O3. L'owner force : trace sur la ligne + journal.
  -- ------------------------------------------------------------------
  select * into v_appt2 from public.reschedule_appointment(
    v_appt2.id, v_t10, null, true, 'Client fidèle, deux fauteuils en même temps');
  if v_appt2.starts_at <> v_t10 then
    raise exception 'O3a: la ligne aurait dû être déplacée à 10:00';
  end if;
  if v_appt2.overlap_forced_at is null or v_appt2.overlap_forced_by <> v_owner
     or v_appt2.overlap_forced_reason <> 'Client fidèle, deux fauteuils en même temps' then
    raise exception 'O3b: trace incomplète (at %, by %, reason %)',
      v_appt2.overlap_forced_at, v_appt2.overlap_forced_by, v_appt2.overlap_forced_reason;
  end if;
  select count(*) into v_count from public.appointment_overlap_forces f
   where f.appointment_id = v_appt2.id and f.action = 'reschedule'
     and f.forced_by = v_owner and f.reason = 'Client fidèle, deux fauteuils en même temps'
     and f.conflicting_appointment_ids @> array[v_appt.id];
  if v_count <> 1 then
    raise exception 'O3c: journal attendu (1 ligne reschedule, conflit = rendez-vous 10:00), reçu %', v_count;
  end if;
  -- La ligne 10:00 d'origine est intacte et NON forcée : c'est elle qui est
  -- dans l'index, l'autre est hors index.
  select * into v_appt from public.appointments where id = v_appt.id;
  if v_appt.overlap_forced_at is not null or v_appt.starts_at <> v_t10 then
    raise exception 'O3d: le rendez-vous recouvert ne doit pas changer';
  end if;

  -- Le manager aussi peut forcer (retour à 11:00 pour libérer, puis on
  -- re-force avec lui).
  select * into v_appt2 from public.reschedule_appointment(v_appt2.id, v_t11);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  select * into v_appt2 from public.reschedule_appointment(v_appt2.id, v_t10, null, true, 'Manager : ok pour Karim');
  if v_appt2.overlap_forced_by <> v_manager then
    raise exception 'O3e: le manager aurait dû pouvoir forcer';
  end if;

  -- ------------------------------------------------------------------
  -- O4. Rien d'ordinaire ne se pose sur du forcé.
  -- ------------------------------------------------------------------
  -- Le rendez-vous forcé occupe 10:00–10:30 hors index. On libère la ligne
  -- ordinaire 10:00 (annulation) : seul le forcé reste sur ce créneau.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.cancel_appointment_as_business(v_appt.id, 'OS1 verify');
  -- Booking public à 10:00 : le trigger refuse (23P01, slot_conflict).
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.book_public_appointment(
      v_slug, v_loc, v_barber, v_service, v_t10, 'OS1 Client Trois', null, 'qa-os1-trois@fadeup.test');
    raise exception 'O4a: un booking ordinaire sur un créneau forcé aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    if v_state <> '23P01' or v_detail <> 'fadeup_booking_refusal=slot_conflict' then
      raise exception 'O4a: attendu 23P01/slot_conflict, reçu %/%', v_state, v_detail;
    end if;
  end;
  -- Un rendez-vous ordinaire à 14:00, qu'on tente de déplacer sur le forcé.
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, v_t14, 'OS1 Client Trois', null, 'qa-os1-trois@fadeup.test');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.reschedule_appointment(v_row.id, v_t10);
    raise exception 'O4b: un déplacement ordinaire sur un créneau forcé aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_detail = pg_exception_detail;
    if v_state <> '23P01' or v_detail <> 'fadeup_booking_refusal=slot_conflict' then
      raise exception 'O4b: attendu 23P01/slot_conflict, reçu %/%', v_state, v_detail;
    end if;
  end;
  -- get_available_slots ne propose pas 10:00 (le forcé compte comme occupé).
  select count(*) into v_count from public.get_available_slots(v_org, v_loc, v_barber, v_service, v_day, 30) s
   where s.slot_start = v_t10;
  if v_count <> 0 then
    raise exception 'O4c: 10:00 ne devrait pas être proposé (créneau forcé occupé)';
  end if;

  -- ------------------------------------------------------------------
  -- O5. Un déplacement ordinaire efface la trace ; un forçage sans conflit
  --     réel ne la pose pas.
  -- ------------------------------------------------------------------
  select * into v_appt2 from public.reschedule_appointment(v_appt2.id, v_t12);
  if v_appt2.overlap_forced_at is not null or v_appt2.overlap_forced_reason is not null then
    raise exception 'O5a: un déplacement ordinaire aurait dû effacer la trace';
  end if;
  select * into v_appt2 from public.reschedule_appointment(v_appt2.id, v_t11, null, true, 'par précaution');
  if v_appt2.overlap_forced_at is not null then
    raise exception 'O5b: un forçage sans conflit réel ne doit pas poser de trace';
  end if;
  select count(*) into v_count from public.appointment_overlap_forces f where f.appointment_id = v_appt2.id;
  if v_count <> 2 then
    raise exception 'O5c: le journal doit compter exactement les 2 forçages réels, reçu %', v_count;
  end if;

  -- ------------------------------------------------------------------
  -- O6. create_appointment_as_business.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_barber_user)::text, true);
  begin
    perform public.create_appointment_as_business(v_loc, v_barber, v_service, v_t12, 'OS1 Tel');
    raise exception 'O6a: un barber ne crée pas';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_authorized' then
      raise exception 'O6a: detail attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_receptionist)::text, true);
  select * into v_appt from public.create_appointment_as_business(
    v_loc, v_barber, v_service, v_t12, '  OS1 Tel  ', '+33612345678', null, ' appelé ce matin ');
  if v_appt.status <> 'confirmed' or v_appt.customer_name <> 'OS1 Tel' or v_appt.notes <> 'appelé ce matin'
     or v_appt.created_by <> v_receptionist or v_appt.booked_by_user_id is not null
     or v_appt.ends_at <> v_t12 + interval '30 minutes' then
    raise exception 'O6b: création manuelle incorrecte (% % % %)', v_appt.status, v_appt.customer_name, v_appt.created_by, v_appt.ends_at;
  end if;
  if v_appt.customer_id is null then
    raise exception 'O6c: le client aurait dû être rattaché (téléphone)';
  end if;
  begin
    perform public.create_appointment_as_business(v_loc, v_barber, v_service, (v_day + time '21:00') at time zone v_tz, 'OS1 Tard');
    raise exception 'O6d: hors horaires aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=outside_hours' then
      raise exception 'O6d: detail attendu outside_hours, reçu %', v_detail;
    end if;
  end;
  begin
    perform public.create_appointment_as_business(v_loc, v_barber, v_service, v_t12, 'OS1 Double');
    raise exception 'O6e: sans forçage, le chevauchement aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '23P01' then
      raise exception 'O6e: SQLSTATE attendu 23P01, reçu %', v_state;
    end if;
  end;
  begin
    perform public.create_appointment_as_business(v_loc, v_barber, v_service, v_t12, 'OS1 Double', null, null, null, true, 'client insistant');
    raise exception 'O6f: un réceptionniste ne force pas à la création';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=force_not_allowed' then
      raise exception 'O6f: detail attendu force_not_allowed, reçu %', v_detail;
    end if;
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select * into v_appt2 from public.create_appointment_as_business(
    v_loc, v_barber, v_service, v_t12, 'OS1 Double', null, null, null, true, 'Deux clients, un apprenti');
  if v_appt2.overlap_forced_at is null or v_appt2.overlap_forced_by <> v_owner then
    raise exception 'O6g: la création forcée aurait dû porter la trace';
  end if;
  select count(*) into v_count from public.appointment_overlap_forces f
   where f.appointment_id = v_appt2.id and f.action = 'create' and f.conflicting_appointment_ids @> array[v_appt.id];
  if v_count <> 1 then
    raise exception 'O6h: journal attendu (1 ligne create), reçu %', v_count;
  end if;

  -- ------------------------------------------------------------------
  -- O7. « Terminé » alimente la collecte des durées.
  -- ------------------------------------------------------------------
  -- completed_at est horodaté serveur (now()) ; starts_at est dans deux
  -- jours : la garde ended > started refuserait la mesure. On recule la
  -- ligne à hier (rôle postgres, chemin sanctionné du verify — pas un usage
  -- client) pour que la mesure existe.
  perform set_config('fadeup.appointment_reschedule', 'on', true);
  update public.appointments
     set starts_at = now() - interval '40 minutes', ends_at = now() - interval '10 minutes'
   where id = v_appt.id;
  perform set_config('fadeup.appointment_reschedule', 'off', true);
  select * into v_appt from public.complete_appointment(v_appt.id);
  if v_appt.status <> 'completed' or v_appt.completed_at is null then
    raise exception 'O7a: terminé aurait dû horodater completed_at';
  end if;
  select count(*) into v_count from public.service_duration_samples s
   where s.source = 'appointment' and s.source_entry_id = v_appt.id
     and s.barber_id = v_barber and s.service_id = v_service
     and s.started_at = v_appt.starts_at and s.ended_at = v_appt.completed_at
     and s.duration_minutes between 39 and 41;
  if v_count <> 1 then
    raise exception 'O7b: une mesure de durée (~40 min) aurait dû être enregistrée, reçu %', v_count;
  end if;

  -- ------------------------------------------------------------------
  -- O8. La permission de revenu.
  -- ------------------------------------------------------------------
  select can_view_revenue into v_row from public.memberships where id = v_barber_membership;
  if v_row.can_view_revenue then
    raise exception 'O8a: le défaut doit être « ne voit pas »';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_barber_user)::text, true);
  select max(c.price_cents) into v_price from public.get_calendar_appointments(v_org, v_t10 - interval '1 day', v_t14 + interval '1 day') c;
  if v_price is not null then
    raise exception 'O8b: un barber sans permission ne doit recevoir aucun prix (reçu %)', v_price;
  end if;
  select count(*) into v_count from public.get_calendar_appointments(v_org, v_t10 - interval '1 day', v_t14 + interval '1 day') c;
  if v_count = 0 then
    raise exception 'O8b2: le barber doit quand même voir les rendez-vous';
  end if;
  -- Le manager ne règle pas.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager)::text, true);
  begin
    perform public.set_membership_revenue_visibility(v_barber_membership, true);
    raise exception 'O8c: seul l''owner règle';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '42501' then
      raise exception 'O8c: SQLSTATE attendu 42501, reçu %', v_state;
    end if;
  end;
  -- L'owner règle ; cible non-barber refusée.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.set_membership_revenue_visibility(
      (select id from public.memberships where organization_id = v_org and user_id = v_receptionist), true);
    raise exception 'O8d: le réglage ne s''applique qu''au rôle barber';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state <> '22023' then
      raise exception 'O8d: SQLSTATE attendu 22023, reçu %', v_state;
    end if;
  end;
  select * into v_row from public.set_membership_revenue_visibility(v_barber_membership, true);
  if not v_row.can_view_revenue then
    raise exception 'O8e: l''owner aurait dû pouvoir autoriser';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_barber_user)::text, true);
  select max(c.price_cents) into v_price from public.get_calendar_appointments(v_org, v_t10 - interval '1 day', v_t14 + interval '1 day') c;
  if v_price <> 2500 then
    raise exception 'O8f: le barber autorisé aurait dû voir le prix (reçu %)', v_price;
  end if;
  -- Le réceptionniste ne voit pas les montants (contrat P1PRO §8).
  perform set_config('request.jwt.claims', json_build_object('sub', v_receptionist)::text, true);
  select max(c.price_cents) into v_price from public.get_calendar_appointments(v_org, v_t10 - interval '1 day', v_t14 + interval '1 day') c;
  if v_price is not null then
    raise exception 'O8g: le réceptionniste ne doit recevoir aucun prix';
  end if;
  -- L'owner voit, et reçoit la trace de forçage dans l'agenda.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select count(*) into v_count from public.get_calendar_appointments(v_org, v_t10 - interval '1 day', v_t14 + interval '1 day') c
   where c.price_cents = 2500 and c.id = v_appt2.id and c.overlap_forced_at is not null and c.overlap_forced_reason = 'Deux clients, un apprenti';
  if v_count <> 1 then
    raise exception 'O8h: l''owner aurait dû voir le prix et la trace de forçage';
  end if;

  -- ------------------------------------------------------------------
  -- O9. Série de blocages sous RLS (rôle authenticated réel).
  -- ------------------------------------------------------------------
  v_series := gen_random_uuid();
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason, series_id)
  select v_org, v_loc, v_barber_b, (v_day + n * 7 + time '12:00') at time zone v_tz, (v_day + n * 7 + time '13:00') at time zone v_tz, 'Pause déjeuner', v_series
  from generate_series(0, 3) n;
  select count(*) into v_count from public.time_blocks where series_id = v_series;
  if v_count <> 4 then
    raise exception 'O9a: 4 occurrences attendues, reçu %', v_count;
  end if;
  -- L'étranger ne voit rien et ne retire rien.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_user, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.time_blocks where series_id = v_series;
  if v_count <> 0 then
    raise exception 'O9b: un étranger ne doit pas voir la série';
  end if;
  delete from public.time_blocks where series_id = v_series;
  execute 'reset role';
  select count(*) into v_count from public.time_blocks where series_id = v_series;
  if v_count <> 4 then
    raise exception 'O9c: un étranger ne doit pas pouvoir retirer la série (reste %)', v_count;
  end if;
  -- L'owner retire la série d'un coup.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.time_blocks where series_id = v_series;
  execute 'reset role';
  select count(*) into v_count from public.time_blocks where series_id = v_series;
  if v_count <> 0 then
    raise exception 'O9d: la série aurait dû être retirée d''un coup (reste %)', v_count;
  end if;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'OS1 : TOUT PASSE (O1–O9)';
end;
$verify$;

rollback;
