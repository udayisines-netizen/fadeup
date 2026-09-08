-- FadeUp — vérification P1PRO : contre-proposition d'horaire, historique des
-- demandes, capacités de réservation en lot.
--
-- Modèle verify_b1/f4 : UNE transaction, des assertions qui lèvent, ROLLBACK
-- final — ce script ne laisse RIEN derrière lui. Conçu pour le bac d'essai de
-- restauration fidèle (b3_restore_sandbox.sh), pas pour la production.
--
--   P1  book_public_appointment sans capacité → pending, was_request stampé
--   P2  counter_propose : anonyme et non-membre refusés ; owner déplace la
--       ligne, retient le créneau, redémarre l'échéance, garde l'horaire
--       d'origine ; notification + e-mail émis
--   P3  confirm refusé tant que la contre-proposition attend (counter_pending)
--   P4  get_booking_requests expose les colonnes de contre-proposition
--   P5  accept : mauvais client refusé ; le bon → confirmed, les deux
--       parties notifiées
--   P6  decline → cancelled / cancelled_by_customer, salon notifié
--   P7  re-proposition : counter_original_starts_at jamais réécrit
--   P8  le créneau proposé est RETENU (un booking public dessus refuse)
--   P9  l'historique liste les traitées (was_request), jamais les pending
--   P10 get_public_booking_capabilities : false sans capacité, >50 refuse,
--       slug inconnu = zéro ligne
--   P11 garde-fous du propose : passé, hors horaires, non-pending

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
  v_owner uuid;
  v_customer_user uuid;
  v_customer_user_p6 uuid;
  v_customer_user_p7 uuid;
  v_stranger_user uuid;
  v_users uuid[];
  v_customer_id uuid;
  v_appt public.appointments;
  v_row record;
  v_detail text;
  v_starts timestamptz;
  v_proposed timestamptz;
  v_original timestamptz;
  v_day date;
  v_i integer;
  v_count bigint;
begin
  -- ------------------------------------------------------------------
  -- Fixture : une organisation qa-f1 réactivée (motif verify_f4).
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

  -- Quatre comptes auth EXISTANTS hors de l'organisation (les notifications
  -- portent une FK vers auth.users, et customers est unique par
  -- (organization, user) — un compte par scénario) : trois clients, un
  -- étranger.
  select array_agg(id) into v_users
  from (
    select u.id
    from auth.users u
    where u.email like '%@fadeup.test'
      and not exists (select 1 from public.memberships m where m.user_id = u.id)
    order by u.email
    limit 4
  ) users;
  if coalesce(array_length(v_users, 1), 0) <> 4 then
    raise exception 'FIXTURE: pas assez de comptes @fadeup.test hors organisation';
  end if;
  v_customer_user := v_users[1];
  v_customer_user_p6 := v_users[2];
  v_customer_user_p7 := v_users[3];
  v_stranger_user := v_users[4];

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
  values (v_org, v_service, v_loc) on conflict do nothing;
  insert into public.barber_services (organization_id, barber_id, service_id)
  values (v_org, v_barber, v_service) on conflict do nothing;

  delete from public.location_hours where location_id = v_loc;
  delete from public.barber_working_hours where barber_id = v_barber;
  for v_i in 0..6 loop
    insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
    values (v_org, v_loc, v_i, false, time '08:00', time '20:00');
    insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
    values (v_org, v_barber, v_i, false, time '08:00', time '20:00');
  end loop;

  -- Pas de capacité booking : c'est le monde « Sur demande ».
  update public.organization_trials
     set status = 'expired', ends_at = now() - interval '1 hour', expired_at = now()
   where organization_id = v_org;
  if private.org_has_capability(v_org, 'booking') then
    raise exception 'FIXTURE: % détient encore la capacité booking', v_slug;
  end if;

  v_day := ((now() at time zone v_tz)::date + 2);
  v_starts := (v_day + time '10:00') at time zone v_tz;
  v_proposed := (v_day + time '15:00') at time zone v_tz;

  -- ------------------------------------------------------------------
  -- P1. La demande naît pending et marquée was_request.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, v_starts,
    'P1PRO Client', null, 'qa-p1pro-client@fadeup.test');
  if v_row.status <> 'pending' then
    raise exception 'P1: attendu pending, reçu %', v_row.status;
  end if;
  select * into v_appt from public.appointments where id = v_row.id;
  if not v_appt.was_request then
    raise exception 'P1: was_request aurait dû être stampé';
  end if;
  v_original := v_appt.starts_at;

  -- Le client possède la demande (FK auth réelle pour les notifications).
  update public.customers set user_id = v_customer_user where id = v_appt.customer_id;
  v_customer_id := v_appt.customer_id;

  -- ------------------------------------------------------------------
  -- P2. counter_propose : refus anonyme, refus non-membre, succès owner.
  -- ------------------------------------------------------------------
  begin
    perform public.counter_propose_booking_request(v_appt.id, v_proposed);
    raise exception 'P2a: un anonyme aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_authorized' then
      raise exception 'P2a: detail attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_user)::text, true);
  begin
    perform public.counter_propose_booking_request(v_appt.id, v_proposed);
    raise exception 'P2b: un non-membre aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_authorized' then
      raise exception 'P2b: detail attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select * into v_appt from public.counter_propose_booking_request(
    v_appt.id, v_proposed, null, '  Pas 10h, mais 15h — même fauteuil.  ');
  if v_appt.starts_at <> v_proposed then
    raise exception 'P2c: la ligne aurait dû être déplacée sur le créneau proposé';
  end if;
  if v_appt.counter_proposed_at is null then
    raise exception 'P2d: counter_proposed_at aurait dû être posé';
  end if;
  if v_appt.counter_original_starts_at <> v_original then
    raise exception 'P2e: counter_original_starts_at devrait porter l''horaire demandé (% attendu, % reçu)',
      v_original, v_appt.counter_original_starts_at;
  end if;
  if v_appt.counter_note <> 'Pas 10h, mais 15h — même fauteuil.' then
    raise exception 'P2f: la note aurait dû être coupée et conservée, reçu %', v_appt.counter_note;
  end if;
  if v_appt.status <> 'pending' then
    raise exception 'P2g: la ligne doit rester pending';
  end if;
  -- Échéance redémarrée : > now, ≤ horaire proposé, ≤ now + TTL.
  if v_appt.expires_at is null or v_appt.expires_at <= now()
     or v_appt.expires_at > v_proposed
     or v_appt.expires_at > now() + interval '14 days' then
    raise exception 'P2h: échéance incohérente : %', v_appt.expires_at;
  end if;

  select count(*) into v_count from public.notifications
  where appointment_id = v_appt.id and type = 'booking_counter_proposed'
    and user_id = v_customer_user;
  if v_count <> 1 then
    raise exception 'P2i: notification client attendue (1), reçu %', v_count;
  end if;
  select count(*) into v_count from public.email_outbox
  where template = 'booking_counter_proposed'
    and to_email = 'qa-p1pro-client@fadeup.test';
  if v_count <> 1 then
    raise exception 'P2j: e-mail de contre-proposition attendu (1), reçu %', v_count;
  end if;

  -- ------------------------------------------------------------------
  -- P3. Le salon ne peut plus « accepter » : le consentement a changé de camp.
  -- ------------------------------------------------------------------
  begin
    perform public.confirm_booking_request(v_appt.id);
    raise exception 'P3: confirm aurait dû refuser pendant la contre-proposition';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=counter_pending' then
      raise exception 'P3: detail attendu counter_pending, reçu %', v_detail;
    end if;
  end;

  -- ------------------------------------------------------------------
  -- P4. get_booking_requests expose la contre-proposition.
  -- ------------------------------------------------------------------
  select * into v_row from public.get_booking_requests(v_org) r where r.id = v_appt.id;
  if v_row.id is null then
    raise exception 'P4a: la demande contre-proposée doit rester listée';
  end if;
  if v_row.counter_proposed_at is null or v_row.counter_original_starts_at <> v_original then
    raise exception 'P4b: colonnes de contre-proposition absentes ou fausses';
  end if;

  -- ------------------------------------------------------------------
  -- P5. accept : mauvais client refusé ; le bon confirme.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_user)::text, true);
  begin
    perform public.accept_booking_counter_proposal(v_appt.id);
    raise exception 'P5a: un autre compte aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_authorized' then
      raise exception 'P5a: detail attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user)::text, true);
  select * into v_appt from public.accept_booking_counter_proposal(v_appt.id);
  if v_appt.status <> 'confirmed' then
    raise exception 'P5b: attendu confirmed, reçu %', v_appt.status;
  end if;
  if v_appt.expires_at is not null then
    raise exception 'P5c: une ligne confirmée ne porte plus d''échéance';
  end if;
  select count(*) into v_count from public.notifications
  where appointment_id = v_appt.id and type = 'booking_confirmed'
    and user_id = v_owner and dedupe_key like '%:counter-accept';
  if v_count <> 1 then
    raise exception 'P5d: le salon aurait dû être notifié de l''acceptation';
  end if;
  select count(*) into v_count from public.notifications
  where appointment_id = v_appt.id and type = 'booking_confirmed'
    and user_id = v_customer_user;
  if v_count < 1 then
    raise exception 'P5e: le client aurait dû recevoir la confirmation';
  end if;

  -- ------------------------------------------------------------------
  -- P6. decline sur une seconde demande → cancelled_by_customer.
  -- ------------------------------------------------------------------
  -- E-mail DISTINCT : une réservation anonyme portant l'e-mail d'un client
  -- déjà rattaché à un compte n'est pas liée (garde de confidentialité de
  -- link_customer_from_contact_info — customer_id resterait NULL).
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, (v_day + time '11:00') at time zone v_tz,
    'P1PRO Client', null, 'qa-p1pro-client-p6@fadeup.test');
  update public.customers set user_id = v_customer_user_p6
  where id = (select customer_id from public.appointments where id = v_row.id);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select * into v_appt from public.counter_propose_booking_request(
    v_row.id, (v_day + time '16:00') at time zone v_tz);

  perform set_config('request.jwt.claims', json_build_object('sub', v_customer_user_p6)::text, true);
  select * into v_appt from public.decline_booking_counter_proposal(v_appt.id);
  if v_appt.status <> 'cancelled' or v_appt.resolution <> 'cancelled_by_customer' then
    raise exception 'P6a: attendu cancelled/cancelled_by_customer, reçu %/%',
      v_appt.status, v_appt.resolution;
  end if;
  select count(*) into v_count from public.notifications
  where appointment_id = v_appt.id and type = 'booking_cancelled'
    and user_id = v_owner and dedupe_key like '%:counter-decline';
  if v_count <> 1 then
    raise exception 'P6b: le salon aurait dû être notifié du refus';
  end if;
  -- Répondre deux fois : idempotent, pas d'erreur.
  select * into v_appt from public.decline_booking_counter_proposal(v_appt.id);
  if v_appt.status <> 'cancelled' then
    raise exception 'P6c: le second refus doit rendre la ligne réglée';
  end if;

  -- ------------------------------------------------------------------
  -- P7. Re-proposition : l'horaire d'ORIGINE ne bouge jamais.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.book_public_appointment(
    v_slug, v_loc, v_barber, v_service, (v_day + time '12:00') at time zone v_tz,
    'P1PRO Client', null, 'qa-p1pro-client-p7@fadeup.test');
  update public.customers set user_id = v_customer_user_p7
  where id = (select customer_id from public.appointments where id = v_row.id);
  v_original := (v_day + time '12:00') at time zone v_tz;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.counter_propose_booking_request(v_row.id, (v_day + time '17:00') at time zone v_tz);
  select * into v_appt from public.counter_propose_booking_request(
    v_row.id, (v_day + time '18:00') at time zone v_tz);
  if v_appt.counter_original_starts_at <> v_original then
    raise exception 'P7: counter_original_starts_at réécrit par la re-proposition';
  end if;
  if v_appt.starts_at <> (v_day + time '18:00') at time zone v_tz then
    raise exception 'P7b: la re-proposition doit porter le dernier créneau';
  end if;

  -- ------------------------------------------------------------------
  -- P8. Le créneau proposé est RETENU.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  begin
    perform * from public.book_public_appointment(
      v_slug, v_loc, v_barber, v_service, (v_day + time '18:00') at time zone v_tz,
      'P1PRO Intrus', null, 'qa-p1pro-intrus@fadeup.test');
    raise exception 'P8: le créneau contre-proposé aurait dû être retenu';
  exception when raise_exception then
    raise;
  when others then
    -- Le refus peut sortir par un code nommé (pré-vérification) ou par la
    -- contrainte d'exclusion elle-même (le dernier filet, 23P01) — les deux
    -- prouvent que la ligne pending déplacée RETIENT le créneau proposé.
    null;
  end;
  select count(*) into v_count from public.appointments a
  where a.organization_id = v_org and a.customer_email = 'qa-p1pro-intrus@fadeup.test';
  if v_count <> 0 then
    raise exception 'P8b: aucune ligne ne doit exister pour l''intrus';
  end if;

  -- ------------------------------------------------------------------
  -- P9. Historique : les traitées, avec leur trace ; jamais les pending.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select count(*) into v_count from public.get_booking_request_history(v_org)
  where status = 'pending';
  if v_count <> 0 then
    raise exception 'P9a: l''historique ne liste jamais les pending';
  end if;
  select count(*) into v_count from public.get_booking_request_history(v_org) h
  where h.status = 'confirmed' and h.counter_proposed_at is not null;
  if v_count < 1 then
    raise exception 'P9b: la demande contre-proposée puis acceptée doit apparaître';
  end if;
  select count(*) into v_count from public.get_booking_request_history(v_org) h
  where h.status = 'cancelled' and h.resolution = 'cancelled_by_customer'
    and h.counter_proposed_at is not null;
  if v_count < 1 then
    raise exception 'P9c: la contre-proposition refusée doit apparaître';
  end if;
  -- Un non-membre ne voit rien.
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger_user)::text, true);
  select count(*) into v_count from public.get_booking_request_history(v_org);
  if v_count <> 0 then
    raise exception 'P9d: un non-membre ne doit rien voir de l''historique';
  end if;

  -- ------------------------------------------------------------------
  -- P10. Capacités en lot.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', '', true);
  select * into v_row from public.get_public_booking_capabilities(array[v_slug]);
  if v_row.organization_slug <> v_slug or v_row.accepts_immediate_booking then
    raise exception 'P10a: % sans capacité booking devrait rendre false', v_slug;
  end if;
  select count(*) into v_count
  from public.get_public_booking_capabilities(array['zz-p1pro-inconnue']);
  if v_count <> 0 then
    raise exception 'P10b: un slug inconnu rend zéro ligne';
  end if;
  begin
    perform * from public.get_public_booking_capabilities(
      (select array_agg('s' || g) from generate_series(1, 51) g));
    raise exception 'P10c: 51 slugs auraient dû être refusés';
  exception when sqlstate '22023' then
    null;
  end;

  -- ------------------------------------------------------------------
  -- P11. Garde-fous du propose.
  -- ------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.counter_propose_booking_request(v_appt.id, now() - interval '1 hour');
    raise exception 'P11a: un horaire passé aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=past_time' then
      raise exception 'P11a: detail attendu past_time, reçu %', v_detail;
    end if;
  end;
  begin
    perform public.counter_propose_booking_request(
      v_appt.id, (v_day + time '23:00') at time zone v_tz);
    raise exception 'P11b: un horaire hors ouverture aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=outside_hours' then
      raise exception 'P11b: detail attendu outside_hours, reçu %', v_detail;
    end if;
  end;
  -- Sur une ligne réglée (P6, cancelled) : not_a_pending_request.
  begin
    perform public.counter_propose_booking_request(
      (select a.id from public.appointments a
       where a.organization_id = v_org and a.status = 'cancelled'
         and a.resolution = 'cancelled_by_customer' and a.counter_proposed_at is not null
       order by a.created_at desc limit 1),
      (v_day + time '14:00') at time zone v_tz);
    raise exception 'P11c: une ligne réglée aurait dû être refusée';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_booking_refusal=not_a_pending_request' then
      raise exception 'P11c: detail attendu not_a_pending_request, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims', '', true);
  raise notice 'P1PRO : TOUT PASSE (P1–P11)';
end;
$verify$;

rollback;
