-- FadeUp — vérification F4 : codes de refus nommés du tunnel de réservation
-- et plafond de réservations futures simultanées.
--
-- Modèle verify_b1 : UNE transaction, des assertions qui lèvent, ROLLBACK
-- final — ce script ne laisse RIEN derrière lui. Conçu pour le bac d'essai de
-- restauration fidèle (b3_restore_sandbox.sh), pas pour la production.
--
-- Il réutilise une organisation qa-f1-* léguée par F1, la réactive DANS la
-- transaction, pose des horaires déterministes, et vérifie :
--   A1  chaque refus de book_public_appointment porte son code nommé
--   A2  la branche pending (sans capacité booking) fonctionne et son
--       échéance respecte least(TTL, starts_at)
--   A3  la branche confirmed (capacité booking via essai actif) fonctionne
--   A4  le plafond de 5 réservations futures refuse la 6e du COMPTE, avec
--       son code — et ne compte pas l'anonyme
--   A5  service_mode_closed est nommé
--   A6  cancel_my_appointment et reschedule_appointment portent leurs codes

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_slug text;
  v_loc uuid;
  v_tz text;
  v_barber uuid;
  v_service uuid;
  v_user uuid := gen_random_uuid();
  v_starts timestamptz;
  v_detail text;
  v_sqlstate text;
  v_row record;
  v_i integer;
  v_day date;
begin
  -- ------------------------------------------------------------------
  -- Fixture : une organisation qa-f1 réactivée, horaires déterministes.
  -- ------------------------------------------------------------------
  select o.id, o.slug into v_org, v_slug
  from public.organizations o
  where o.slug like 'qa-f1-%'
  order by o.slug limit 1;
  if v_org is null then
    raise exception 'FIXTURE: aucune organisation qa-f1';
  end if;

  select l.id, l.timezone into v_loc, v_tz
  from public.locations l
  where l.organization_id = v_org and l.kind = 'physical_address'
  limit 1;

  update public.locations set is_active = true where id = v_loc;
  perform private.ensure_location_service_settings(v_loc);
  update public.location_service_settings
     set default_service_mode = 'hybrid'
   where location_id = v_loc;

  select b.id into v_barber
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.organization_id = v_org and sp.location_id = v_loc
  limit 1;
  update public.staff_profiles set is_active = true, is_public = true
  where id = (select staff_profile_id from public.barbers where id = v_barber);
  update public.barbers set is_bookable = true where id = v_barber;

  select s.id into v_service from public.services s
  where s.organization_id = v_org and s.is_active limit 1;
  if v_service is null then
    raise exception 'FIXTURE: aucun service actif sur %', v_slug;
  end if;
  update public.services set duration_minutes = 30 where id = v_service;
  insert into public.service_locations (organization_id, service_id, location_id)
  values (v_org, v_service, v_loc)
  on conflict do nothing;
  insert into public.barber_services (organization_id, barber_id, service_id)
  values (v_org, v_barber, v_service)
  on conflict do nothing;

  -- Horaires déterministes : lieu ET barber ouverts 08:00–20:00 tous les jours.
  delete from public.location_hours where location_id = v_loc;
  delete from public.barber_working_hours where barber_id = v_barber;
  for v_i in 0..6 loop
    insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
    values (v_org, v_loc, v_i, false, time '08:00', time '20:00');
    insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
    values (v_org, v_barber, v_i, false, time '08:00', time '20:00');
  end loop;

  -- Pas de capacité booking : l'essai éventuel est éteint dans la transaction.
  update public.organization_trials
     set status = 'expired', ends_at = now() - interval '1 hour', expired_at = now()
   where organization_id = v_org;
  if private.org_has_capability(v_org, 'booking') then
    raise exception 'FIXTURE: % détient encore la capacité booking', v_slug;
  end if;

  v_day := ((now() at time zone v_tz)::date + 1);
  v_starts := (v_day + time '10:00') at time zone v_tz;

  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------
  -- A1. Chaque refus porte son code nommé.
  -- ------------------------------------------------------------------
  begin
    perform * from public.book_public_appointment('zz-f4-inexistante', v_loc, v_barber, v_service, v_starts, 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1a: une organisation inconnue aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=unknown_organization' then
      raise exception 'A1a: detail attendu unknown_organization, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts, 'F4 Client', null, null);
    raise exception 'A1b: sans contact aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=missing_contact' then
      raise exception 'A1b: detail attendu missing_contact, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, now() - interval '1 hour', 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1c: un horaire passé aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=past_time' then
      raise exception 'A1c: detail attendu past_time, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, gen_random_uuid(), v_barber, v_service, v_starts, 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1d: un lieu inconnu aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=location_unavailable' then
      raise exception 'A1d: detail attendu location_unavailable, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, gen_random_uuid(), v_starts, 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1e: un service inconnu aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=service_unavailable' then
      raise exception 'A1e: detail attendu service_unavailable, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, v_loc, gen_random_uuid(), v_service, v_starts, 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1f: un barber inconnu aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=barber_unavailable' then
      raise exception 'A1f: detail attendu barber_unavailable, reçu %', v_detail;
    end if;
  end;

  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, (v_day + time '03:00') at time zone v_tz, 'F4 Client', null, 'f4@fadeup.test');
    raise exception 'A1g: 03:00 aurait dû être hors horaires';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=outside_hours' then
      raise exception 'A1g: detail attendu outside_hours, reçu %', v_detail;
    end if;
  end;

  raise notice 'A1 OK — les sept refus directs portent leur code';

  -- ------------------------------------------------------------------
  -- A2. Branche pending : demande anonyme, échéance plafonnée.
  -- ------------------------------------------------------------------
  select * into v_row from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts, 'F4 Anonyme', null, 'f4-anon@fadeup.test');
  if v_row.status <> 'pending' or v_row.is_request is not true then
    raise exception 'A2: attendu pending/is_request, reçu %/%', v_row.status, v_row.is_request;
  end if;
  if v_row.expires_at is null or v_row.expires_at > v_row.starts_at
     or v_row.expires_at > now() + interval '24 hours' + interval '1 minute' then
    raise exception 'A2: échéance % hors du plafond least(24h, starts_at=%)', v_row.expires_at, v_row.starts_at;
  end if;
  if v_row.claim_token is null then
    raise exception 'A2: un anonyme doit recevoir un claim_token';
  end if;
  raise notice 'A2 OK — pending, is_request, échéance %, jeton émis', v_row.expires_at;

  -- ------------------------------------------------------------------
  -- A3. Branche confirmed : essai actif → capacité booking.
  -- ------------------------------------------------------------------
  update public.organization_trials
     set status = 'active', ends_at = now() + interval '7 days', expired_at = null
   where organization_id = v_org;
  if not found then
    insert into public.organization_trials (organization_id, plan_key, started_at, ends_at, status)
    values (v_org, 'salon_pro', now(), now() + interval '7 days', 'active');
  end if;
  if not private.org_has_capability(v_org, 'booking') then
    raise exception 'A3 FIXTURE: la capacité booking devrait être là';
  end if;

  select * into v_row from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts + interval '1 hour', 'F4 Confirmé', null, 'f4-conf@fadeup.test');
  if v_row.status <> 'confirmed' or v_row.is_request is not false then
    raise exception 'A3: attendu confirmed, reçu %/%', v_row.status, v_row.is_request;
  end if;
  raise notice 'A3 OK — confirmed automatique avec capacité';

  -- ------------------------------------------------------------------
  -- A4. Plafond de 5 réservations futures pour un COMPTE.
  -- ------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'qa-f4-cap@fadeup.test', 'x', now(), now(), now(), '{"provider":"email"}', '{}');

  for v_i in 1..5 loop
    insert into public.appointments (
      organization_id, location_id, barber_id, service_id,
      customer_name, customer_email,
      starts_at, ends_at, status, booked_by_user_id
    ) values (
      v_org, v_loc, v_barber, v_service,
      'F4 Cap', 'qa-f4-cap@fadeup.test',
      v_starts + make_interval(hours => 1 + v_i), v_starts + make_interval(hours => 1 + v_i, mins => 30),
      'pending', v_user
    );
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts + interval '8 hours', 'F4 Cap', null, 'qa-f4-cap@fadeup.test');
    raise exception 'A4a: la 6e réservation du compte aurait dû être refusée';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=too_many_future_bookings' then
      raise exception 'A4a: detail attendu too_many_future_bookings, reçu %', v_detail;
    end if;
  end;

  -- L'anonyme n'est pas comptable : le même créneau passe sans compte.
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts + interval '8 hours', 'F4 Anonyme Deux', null, 'f4-anon2@fadeup.test');
  if v_row.id is null then
    raise exception 'A4b: l''anonyme aurait dû passer';
  end if;
  raise notice 'A4 OK — 6e du compte refusée avec code, anonyme non compté';

  -- ------------------------------------------------------------------
  -- A5. Mode de service fermé : code nommé.
  -- ------------------------------------------------------------------
  update public.location_service_settings
     set default_service_mode = 'unavailable'
   where location_id = v_loc;
  begin
    perform * from public.book_public_appointment(v_slug, v_loc, v_barber, v_service, v_starts + interval '9 hours', 'F4 Fermé', null, 'f4-ferme@fadeup.test');
    raise exception 'A5: mode unavailable aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail, v_sqlstate = returned_sqlstate;
    if v_detail <> 'fadeup_booking_refusal=service_mode_closed' then
      raise exception 'A5: detail attendu service_mode_closed, reçu % (sqlstate %)', v_detail, v_sqlstate;
    end if;
  end;
  update public.location_service_settings
     set default_service_mode = 'hybrid'
   where location_id = v_loc;
  raise notice 'A5 OK — service_mode_closed nommé';

  -- ------------------------------------------------------------------
  -- A6. cancel / reschedule : codes nommés.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform public.cancel_my_appointment(gen_random_uuid());
    raise exception 'A6a: annuler un rendez-vous inconnu aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=appointment_not_found' then
      raise exception 'A6a: detail attendu appointment_not_found, reçu %', v_detail;
    end if;
  end;

  begin
    perform public.reschedule_appointment(gen_random_uuid(), v_starts + interval '10 hours');
    raise exception 'A6b: reporter un rendez-vous inconnu aurait dû refuser';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=appointment_not_found' then
      raise exception 'A6b: detail attendu appointment_not_found, reçu %', v_detail;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'A6 OK — cancel et reschedule portent leurs codes';

  raise notice 'verify_f4 : TOUT PASSE';
end;
$verify$;

rollback;
