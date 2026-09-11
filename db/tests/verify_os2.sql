-- FadeUp — vérification OS-2 : notes privées, catalogue, seuils de file,
-- équipe, fiches clients.
--
-- Modèle verify_os1/verify_p1pro : UNE transaction, des assertions qui
-- lèvent, ROLLBACK final — ce script ne laisse RIEN derrière lui. Conçu pour
-- le bac d'essai de restauration fidèle (b3_restore_sandbox.sh), PAS pour la
-- production.
--
--   N1  notes : l'équipe écrit et lit ; l'auteur est auth.uid(), jamais un
--       paramètre ; un étranger et un membre d'un AUTRE salon sont refusés
--   N2  notes : platform_sales et platform_intern REFUSÉS ; support,
--       modérateur, admin, fondateur lisent
--   N3  notes : chaque lecture interne écrit une ligne platform_audit_log
--       (customer_notes_read) ; une lecture par l'équipe n'en écrit AUCUNE
--   N4  notes : droit d'accès RGPD — get_my_customer_notes rend au sujet ce
--       qui est écrit sur lui ; anonyme refusé
--   N5  notes : la colonne héritée customers.notes est inécrivable
--   C1  catalogue : un barber modifie nom/durée ; le MÊME appel avec un prix
--       est REFUSÉ (42501, price_forbidden_for_role) et le prix n'a pas bougé
--   C2  catalogue : le réceptionniste n'écrit rien ; owner tarife
--   C3  catalogue : un service créé par un barber naît brouillon (inactif,
--       price_pending) ; tarifer l'active
--   C4  catalogue : un service AVEC historique refuse la suppression
--       (has_history) et s'archive ; un service neuf se supprime
--   C5  catalogue : affectation aux barbers ; barber étranger refusé
--   C6  catalogue : durée observée et poids du déclaré rendus honnêtement
--   Q1  seuils de file : owner règle, barber refusé, hors bornes refusé,
--       paramètre NULL = inchangé
--   T1  équipe : invitation créée, jeton serveur, ligne email_outbox
--       team_invitation, échéance 7 jours ; renvoyer révoque la précédente
--   T2  équipe : liste réservée aux gestionnaires ; le jeton n'est jamais rendu
--   T3  équipe : retirer un barber SANS remplaçant est refusé quand il reste
--       un rendez-vous à venir
--   T4  équipe : avec remplaçant, les rendez-vous sont réassignés, la file
--       suivie, le membership retiré, et professionals INTACT
--   T5  équipe : un manager ne peut plus rétrograder ni retirer un owner
--   R1  clients : liste bornée à l'organisation ; un autre salon ne voit rien
--   R2  clients : compteurs réels (rendez-vous + file), client vérifié ≠
--       client du salon
--   R3  clients : un régulier en retard est identifié, un client à une seule
--       visite n'a NI cycle NI retard
--   R4  clients : historique du client, fiche, nombre de notes
--   Z1  motif nul : chaque RPC neuve refuse un appelant anonyme

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_org2 uuid;
  v_slug text;
  v_loc uuid;
  v_tz text;
  v_owner uuid;
  v_manager uuid;
  v_receptionist uuid;
  v_barber_user uuid;
  v_customer_user uuid;
  v_stranger_user uuid;
  v_sales uuid;
  v_intern uuid;
  v_support uuid;
  v_users uuid[];
  v_barber uuid;
  v_barber_b uuid;
  v_service uuid;
  v_service_new uuid;
  v_customer uuid;
  v_customer2 uuid;
  v_customer_other uuid;
  v_note public.customer_notes;
  v_note_b public.customer_notes;
  v_svc public.services;
  v_settings public.location_service_settings;
  v_invite record;
  v_invite2 record;
  v_removal record;
  v_row record;
  v_detail text;
  v_msg text;
  v_count bigint;
  v_int integer;
  v_bool boolean;
  v_ts timestamptz;
  v_membership uuid;
  v_professional uuid;
  v_i integer;
  v_day date;
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
    order by u.email limit 8
  ) users;
  if coalesce(array_length(v_users, 1), 0) <> 8 then
    raise exception 'FIXTURE: 8 comptes @fadeup.test libres requis, % trouvés',
      coalesce(array_length(v_users, 1), 0);
  end if;
  v_manager := v_users[1]; v_receptionist := v_users[2]; v_barber_user := v_users[3];
  v_customer_user := v_users[4]; v_stranger_user := v_users[5];
  v_sales := v_users[6]; v_intern := v_users[7]; v_support := v_users[8];

  insert into public.memberships (organization_id, user_id, role) values
    (v_org, v_manager, 'manager'),
    (v_org, v_receptionist, 'receptionist'),
    (v_org, v_barber_user, 'barber');

  insert into public.platform_members (user_id, role) values
    (v_sales, 'platform_sales'), (v_intern, 'platform_intern'), (v_support, 'platform_support');

  select l.id, l.timezone into v_loc, v_tz
  from public.locations l
  where l.organization_id = v_org and l.kind = 'physical_address' limit 1;
  update public.locations set is_active = true where id = v_loc;
  perform private.ensure_location_service_settings(v_loc);
  update public.location_service_settings
     set default_service_mode = 'hybrid', queue_open = true
   where location_id = v_loc;

  update public.staff_profiles
     set location_id = v_loc, display_name = 'OS2 Barber A', is_public = true, is_active = true
   where organization_id = v_org and user_id = v_barber_user;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select v_org, sp.id, true from public.staff_profiles sp
   where sp.organization_id = v_org and sp.user_id = v_barber_user
  returning id into v_barber;

  insert into public.staff_profiles (organization_id, user_id, location_id, display_name, is_public, is_active)
  values (v_org, null, v_loc, 'OS2 Barber B', true, true);
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  select v_org, sp.id, true from public.staff_profiles sp
   where sp.organization_id = v_org and sp.display_name = 'OS2 Barber B'
  returning id into v_barber_b;

  select s.id into v_service from public.services s
  where s.organization_id = v_org and s.is_active limit 1;
  if v_service is null then
    raise exception 'FIXTURE: aucun service actif sur %', v_slug;
  end if;
  update public.services
     set duration_minutes = 30, price_cents = 2500, buffer_before_minutes = 0, buffer_after_minutes = 0
   where id = v_service;
  insert into public.service_locations (organization_id, service_id, location_id)
  values (v_org, v_service, v_loc) on conflict do nothing;
  insert into public.barber_services (organization_id, barber_id, service_id)
  values (v_org, v_barber, v_service), (v_org, v_barber_b, v_service) on conflict do nothing;

  delete from public.location_hours where location_id = v_loc;
  delete from public.barber_working_hours where barber_id in (v_barber, v_barber_b);
  for v_i in 0..6 loop
    insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
    values (v_org, v_loc, v_i, false, time '00:00', time '23:59');
    insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time)
    values (v_org, v_barber, v_i, false, time '00:00', time '23:59'),
           (v_org, v_barber_b, v_i, false, time '00:00', time '23:59');
  end loop;

  update public.organization_trials
     set status = 'active', ends_at = now() + interval '7 days', expired_at = null
   where organization_id = v_org;

  -- Trois clients : un régulier revenu récemment, un régulier EN RETARD, un
  -- client d'une autre organisation.
  insert into public.customers (organization_id, name, phone, user_id)
  values (v_org, 'OS2 Client Regulier', '+33600000201', v_customer_user)
  returning id into v_customer;
  insert into public.customers (organization_id, name, phone)
  values (v_org, 'OS2 Client Unique', '+33600000202')
  returning id into v_customer2;
  insert into public.customers (organization_id, name, phone)
  values (v_org2, 'OS2 Client Ailleurs', '+33600000203')
  returning id into v_customer_other;

  -- ==================================================================
  -- N1. Les notes : l'équipe écrit et lit
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  v_note := public.add_customer_note(v_customer, 'Préfère le dégradé court.');
  if v_note.author_user_id <> v_barber_user then
    raise exception 'N1a: l''auteur doit être auth.uid(), reçu %', v_note.author_user_id;
  end if;
  if v_note.organization_id <> v_org then
    raise exception 'N1b: la note doit hériter de l''organisation du client';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_note_b := public.add_customer_note(v_customer, 'Client fidèle depuis 2024.');
  select count(*) into v_count from public.list_customer_notes(v_customer);
  if v_count <> 2 then
    raise exception 'N1c: 2 notes attendues, reçu %', v_count;
  end if;

  -- L'auteur corrige la sienne ; l'owner peut corriger celle du barber.
  perform public.update_customer_note(v_note.id, 'Préfère le dégradé court, tondeuse 1.');
  -- Un barber ne corrige PAS la note d'un autre.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  begin
    perform public.update_customer_note(v_note_b.id, 'tentative');
    raise exception 'N1d: un barber ne doit pas corriger la note d''un autre';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_customer_notes_refusal=not_authorized' then
      raise exception 'N1e: motif attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  -- Un étranger : refusé, avec le même motif qu'un client inconnu.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_user, 'role', 'authenticated')::text, true);
  begin
    perform public.list_customer_notes(v_customer);
    raise exception 'N1f: un étranger ne doit pas lire les notes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.add_customer_note(v_customer, 'tentative');
    raise exception 'N1g: un étranger ne doit pas écrire de note';
  exception when insufficient_privilege then null;
  end;

  -- Un membre d'un AUTRE salon : refusé sur le client de celui-ci.
  insert into public.memberships (organization_id, user_id, role)
  values (v_org2, v_stranger_user, 'barber');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_user, 'role', 'authenticated')::text, true);
  begin
    perform public.list_customer_notes(v_customer);
    raise exception 'N1h: un barber d''un autre salon ne doit pas lire ces notes';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- N2/N3. Les rôles internes, et la trace
  -- ==================================================================
  select count(*) into v_count from public.platform_audit_log
   where action = 'customer_notes_read';
  if v_count <> 0 then
    raise exception 'N3a: une lecture par l''équipe ne doit RIEN tracer (reçu %)', v_count;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sales, 'role', 'authenticated')::text, true);
  begin
    perform public.list_customer_notes(v_customer);
    raise exception 'N2a: platform_sales ne doit PAS lire les notes privées';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_intern, 'role', 'authenticated')::text, true);
  begin
    perform public.list_customer_notes(v_customer);
    raise exception 'N2b: platform_intern ne doit PAS lire les notes privées';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.list_customer_notes(v_customer);
  if v_count <> 2 then
    raise exception 'N2c: platform_support doit lire les 2 notes, reçu %', v_count;
  end if;

  select count(*) into v_count from public.platform_audit_log
   where action = 'customer_notes_read' and actor_user_id = v_support and target_id = v_customer;
  if v_count <> 1 then
    raise exception 'N3b: la lecture interne doit écrire UNE ligne d''audit, reçu %', v_count;
  end if;
  select (metadata ->> 'note_count')::integer into v_int
  from public.platform_audit_log
  where action = 'customer_notes_read' and actor_user_id = v_support limit 1;
  if v_int <> 2 then
    raise exception 'N3c: la trace doit porter le nombre de notes, reçu %', v_int;
  end if;

  -- Même sur une fiche VIDE, la tentative est tracée.
  perform public.list_customer_notes(v_customer2);
  select count(*) into v_count from public.platform_audit_log
   where action = 'customer_notes_read' and actor_user_id = v_support;
  if v_count <> 2 then
    raise exception 'N3d: une consultation d''une fiche vide se trace aussi, reçu %', v_count;
  end if;

  -- Un rôle interne ne peut pas ÉCRIRE.
  begin
    perform public.add_customer_note(v_customer, 'note du support');
    raise exception 'N2d: un rôle interne ne doit pas écrire de note';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- N4. Le droit d'accès RGPD
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_customer_user, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.get_my_customer_notes();
  if v_count <> 2 then
    raise exception 'N4a: le sujet doit recevoir les 2 notes écrites sur lui, reçu %', v_count;
  end if;
  -- Et pas celles des autres.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger_user, 'role', 'authenticated')::text, true);
  select count(*) into v_count from public.get_my_customer_notes();
  if v_count <> 0 then
    raise exception 'N4b: un tiers ne doit recevoir aucune note, reçu %', v_count;
  end if;

  -- ==================================================================
  -- N5. La colonne héritée est condamnée
  -- ==================================================================
  perform set_config('request.jwt.claims', '', true);
  begin
    update public.customers set notes = 'contournement' where id = v_customer;
    raise exception 'N5a: customers.notes doit être inécrivable';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_customer_notes_refusal=legacy_column' then
      raise exception 'N5b: motif attendu legacy_column, reçu %', v_detail;
    end if;
  end;
  -- Une mise à jour qui ne touche PAS la colonne passe toujours.
  update public.customers set phone = '+33600000299' where id = v_customer;

  -- ==================================================================
  -- C1/C2. Le prix réservé — la garde REFUSE, elle n'ignore pas
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  v_svc := public.update_service(v_service, 'Coupe homme OS2', 35, 'Dégradé compris', null);
  if v_svc.duration_minutes <> 35 or v_svc.name <> 'Coupe homme OS2' then
    raise exception 'C1a: un barber doit pouvoir changer nom et durée';
  end if;
  if v_svc.price_cents <> 2500 then
    raise exception 'C1b: le prix ne doit pas bouger, reçu %', v_svc.price_cents;
  end if;

  begin
    perform public.update_service(v_service, 'Coupe homme OS2', 35, null, null, 9900);
    raise exception 'C1c: un barber qui envoie un prix doit être REFUSÉ';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_service_refusal=price_forbidden_for_role' then
      raise exception 'C1d: motif attendu price_forbidden_for_role, reçu %', v_detail;
    end if;
  end;
  select s.price_cents into v_int from public.services s where s.id = v_service;
  if v_int <> 2500 then
    raise exception 'C1e: le refus ne doit RIEN avoir écrit, prix = %', v_int;
  end if;

  -- Même le prix COURANT est refusé : la garde porte sur la présence du champ.
  begin
    perform public.update_service(v_service, 'Coupe homme OS2', 35, null, null, 2500);
    raise exception 'C1f: renvoyer le prix courant doit être refusé aussi';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.set_service_price(v_service, 3000);
    raise exception 'C1g: un barber ne doit pas tarifer';
  exception when insufficient_privilege then null;
  end;

  -- Le réceptionniste n'écrit rien du tout.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_receptionist, 'role', 'authenticated')::text, true);
  begin
    perform public.update_service(v_service, 'Tentative', 30, null, null);
    raise exception 'C2a: le réceptionniste ne doit pas modifier le catalogue';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_service_refusal=not_authorized' then
      raise exception 'C2b: motif attendu not_authorized, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_svc := public.set_service_price(v_service, 3000);
  if v_svc.price_cents <> 3000 then
    raise exception 'C2c: l''owner doit pouvoir tarifer';
  end if;

  -- ==================================================================
  -- C3. Un service créé par un barber naît brouillon
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  v_svc := public.create_service(v_org, 'Barbe OS2', 20);
  v_service_new := v_svc.id;
  if v_svc.is_active or not v_svc.price_pending then
    raise exception 'C3a: un service créé par un barber doit naître inactif et price_pending';
  end if;
  begin
    perform public.create_service(v_org, 'Barbe payante', 20, 1500);
    raise exception 'C3b: un barber ne doit pas pouvoir créer un service AVEC un prix';
  exception when insufficient_privilege then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_service_refusal=price_forbidden_for_role' then
      raise exception 'C3c: motif attendu price_forbidden_for_role, reçu %', v_detail;
    end if;
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_svc := public.set_service_price(v_service_new, 1800);
  if not v_svc.is_active or v_svc.price_pending then
    raise exception 'C3d: tarifer un brouillon doit l''activer';
  end if;
  -- Un owner doit donner un prix à la création.
  begin
    perform public.create_service(v_org, 'Sans prix', 20);
    raise exception 'C3e: un owner doit fournir un prix à la création';
  exception when invalid_parameter_value then null;
  end;

  -- ==================================================================
  -- C4. Historique : on archive, on ne supprime pas
  -- ==================================================================
  v_day := ((now() at time zone v_tz)::date + 2);
  insert into public.appointments (
    organization_id, location_id, barber_id, service_id,
    customer_name, customer_id, starts_at, ends_at, status)
  values (v_org, v_loc, v_barber, v_service, 'OS2 Client Regulier', v_customer,
          (v_day + time '10:00') at time zone v_tz,
          (v_day + time '10:30') at time zone v_tz, 'confirmed');

  begin
    perform public.delete_service(v_service);
    raise exception 'C4a: un service avec historique ne doit pas se supprimer';
  exception when foreign_key_violation then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail not like 'fadeup_service_refusal=has_history%' then
      raise exception 'C4b: motif attendu has_history, reçu %', v_detail;
    end if;
  end;

  v_svc := public.archive_service(v_service);
  if v_svc.archived_at is null or v_svc.is_active then
    raise exception 'C4c: archiver doit poser archived_at et désactiver';
  end if;
  -- Un service archivé ne se modifie pas tant qu'il n'est pas restauré.
  begin
    perform public.update_service(v_service, 'Tentative', 30, null, null);
    raise exception 'C4d: un service archivé ne doit pas s''éditer';
  exception when invalid_parameter_value then null;
  end;
  v_svc := public.restore_service(v_service);
  if v_svc.archived_at is not null or not v_svc.is_active then
    raise exception 'C4e: restaurer doit rendre le service actif';
  end if;

  -- Un service NEUF, sans aucun historique, se supprime bien.
  v_svc := public.create_service(v_org, 'Service jetable OS2', 10, 500);
  perform public.delete_service(v_svc.id);
  select count(*) into v_count from public.services s where s.id = v_svc.id;
  if v_count <> 0 then
    raise exception 'C4f: un service neuf doit pouvoir être supprimé';
  end if;

  -- ==================================================================
  -- C5. Affectation aux barbers
  -- ==================================================================
  v_int := public.set_service_barbers(v_service_new, array[v_barber, v_barber_b]);
  if v_int <> 2 then
    raise exception 'C5a: 2 affectations attendues, reçu %', v_int;
  end if;
  v_int := public.set_service_barbers(v_service_new, array[v_barber]);
  if v_int <> 1 then
    raise exception 'C5b: l''affectation doit être REMPLACÉE, reçu %', v_int;
  end if;
  begin
    perform public.set_service_barbers(v_service_new,
      array[(select b.id from public.barbers b where b.organization_id = v_org2 limit 1)]);
    raise exception 'C5c: un barber d''une autre organisation doit être refusé';
  exception when invalid_parameter_value then null;
       when null_value_not_allowed then null;
  end;

  -- ==================================================================
  -- C6. Ce que le catalogue rend
  -- ==================================================================
  select * into v_row from public.list_organization_services(v_org) s where s.id = v_service;
  if v_row.status <> 'active' then
    raise exception 'C6a: statut attendu active, reçu %', v_row.status;
  end if;
  if not v_row.has_history then
    raise exception 'C6b: le service porte un rendez-vous : has_history doit être vrai';
  end if;
  if v_row.declared_weight_percent <> 100 then
    raise exception 'C6c: sans mesure, le déclaré pèse 100 %%, reçu %', v_row.declared_weight_percent;
  end if;
  if v_row.observed_minutes is not null then
    raise exception 'C6d: sans mesure, observed_minutes doit être NULL — rien n''est inventé';
  end if;
  select * into v_row from public.list_organization_services(v_org) s where s.id = v_service_new;
  if v_row.status <> 'active' or v_row.barber_count <> 1 then
    raise exception 'C6e: le service tarifé doit être actif avec 1 barber affecté';
  end if;

  -- ------------------------------------------------------------------
  -- Fixture CRM, posée AVANT le départ du barber : 4 prestations terminées
  -- toutes les 4 semaines, la dernière il y a 90 jours (donc EN RETARD),
  -- et un client d'une seule visite, venu par la FILE.
  -- ------------------------------------------------------------------
  for v_i in 0..3 loop
    insert into public.appointments (
      organization_id, location_id, barber_id, service_id, customer_name, customer_id,
      booked_by_user_id, starts_at, ends_at, status, completed_at)
    values (v_org, v_loc, v_barber, v_service, 'OS2 Client Regulier', v_customer, v_customer_user,
            now() - make_interval(days => 90 + v_i * 28),
            now() - make_interval(days => 90 + v_i * 28) + interval '30 minutes',
            'completed', now() - make_interval(days => 90 + v_i * 28) + interval '30 minutes');
  end loop;
  insert into public.queue_entries (
    organization_id, location_id, barber_id, service_id, customer_name, customer_id,
    status, created_at, called_at, service_started_at, completed_at)
  values (v_org, v_loc, v_barber, v_service, 'OS2 Client Unique', v_customer2,
          'completed', now() - interval '10 days' - interval '20 minutes',
          now() - interval '10 days', now() - interval '10 days',
          now() - interval '10 days' + interval '25 minutes');

  -- ==================================================================
  -- Q1. Les seuils de file
  -- ==================================================================
  v_settings := public.set_location_queue_thresholds(v_loc, 12, 9, null);
  if v_settings.queue_capacity_per_barber <> 12 or v_settings.queue_call_grace_minutes <> 9 then
    raise exception 'Q1a: les seuils doivent être écrits';
  end if;
  if v_settings.queue_geofence_meters <> 150 then
    raise exception 'Q1b: un paramètre NULL doit laisser la valeur en place, reçu %',
      v_settings.queue_geofence_meters;
  end if;
  begin
    perform public.set_location_queue_thresholds(v_loc, 500);
    raise exception 'Q1c: une capacité hors bornes doit être refusée';
  exception when invalid_parameter_value then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail <> 'fadeup_queue_refusal=capacity_out_of_range' then
      raise exception 'Q1d: motif attendu capacity_out_of_range, reçu %', v_detail;
    end if;
  end;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  begin
    perform public.set_location_queue_thresholds(v_loc, 5);
    raise exception 'Q1e: un barber ne règle pas les seuils';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- T1/T2. Inviter
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select * into v_invite from public.invite_team_member(v_org, 'QA-OS2-Invite@Fadeup.test', 'barber');
  if v_invite.email <> 'qa-os2-invite@fadeup.test' then
    raise exception 'T1a: l''e-mail doit être normalisé, reçu %', v_invite.email;
  end if;
  if v_invite.replaced_previous then
    raise exception 'T1b: la première invitation ne remplace rien';
  end if;
  if v_invite.expires_at < now() + interval '6 days'
     or v_invite.expires_at > now() + interval '8 days' then
    raise exception 'T1c: échéance attendue à 7 jours, reçu %', v_invite.expires_at;
  end if;
  select length(i.token) into v_int from public.invitations i where i.id = v_invite.id;
  if v_int <> 64 then
    raise exception 'T1d: jeton serveur de 32 octets hexadécimaux attendu, longueur %', v_int;
  end if;
  select count(*) into v_count from public.email_outbox e
   where e.template = 'team_invitation' and e.to_email = 'qa-os2-invite@fadeup.test';
  if v_count <> 1 then
    raise exception 'T1e: une ligne email_outbox team_invitation attendue, reçu %', v_count;
  end if;

  -- Renvoyer révoque la précédente.
  select * into v_invite2 from public.invite_team_member(v_org, 'qa-os2-invite@fadeup.test', 'barber');
  if not v_invite2.replaced_previous then
    raise exception 'T1f: le renvoi doit révoquer l''invitation précédente';
  end if;
  select i.revoked_at into v_ts from public.invitations i where i.id = v_invite.id;
  if v_ts is null then
    raise exception 'T1g: l''ancienne invitation doit être révoquée';
  end if;
  select count(*) into v_count from public.list_team_invitations(v_org)
   where email = 'qa-os2-invite@fadeup.test';
  if v_count <> 1 then
    raise exception 'T1h: une seule invitation en attente attendue, reçu %', v_count;
  end if;

  -- Le jeton n'est JAMAIS rendu par la liste : la colonne n'existe pas.
  begin
    perform (select i.token from public.list_team_invitations(v_org) i limit 1);
    raise exception 'T2a: list_team_invitations ne doit pas exposer de jeton';
  exception when undefined_column then null;
  end;

  -- Un barber n'a pas d'écran équipe.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_barber_user, 'role', 'authenticated')::text, true);
  begin
    perform public.list_team_members(v_org);
    raise exception 'T2b: un barber ne doit pas lire l''équipe';
  exception when insufficient_privilege then null;
  end;

  -- ==================================================================
  -- T3/T4. Retirer, sans rien détruire
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select m.id into v_membership from public.memberships m
   where m.organization_id = v_org and m.user_id = v_barber_user;
  select b.professional_id into v_professional from public.barbers b where b.id = v_barber;
  if v_professional is null then
    raise exception 'FIXTURE: le barber devrait porter une identité professionnelle';
  end if;

  -- Une personne en attente dans SA file.
  insert into public.queue_entries (organization_id, location_id, barber_id, customer_name, status)
  values (v_org, v_loc, v_barber, 'OS2 File Un', 'waiting');

  begin
    perform public.remove_team_member(v_membership);
    raise exception 'T3a: retirer un barber qui a un rendez-vous à venir doit être refusé';
  exception when invalid_parameter_value then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail not like 'fadeup_team_refusal=has_future_appointments%' then
      raise exception 'T3b: motif attendu has_future_appointments, reçu %', v_detail;
    end if;
  end;

  select * into v_removal from public.remove_team_member(v_membership, v_barber_b);
  if v_removal.reassigned_appointments <> 1 then
    raise exception 'T4a: 1 rendez-vous réassigné attendu, reçu %', v_removal.reassigned_appointments;
  end if;
  if v_removal.moved_queue_entries <> 1 then
    raise exception 'T4b: 1 entrée de file déplacée attendue, reçu %', v_removal.moved_queue_entries;
  end if;
  select count(*) into v_count from public.appointments a
   where a.barber_id = v_barber_b and a.customer_id = v_customer and a.status = 'confirmed';
  if v_count <> 1 then
    raise exception 'T4c: le rendez-vous doit appartenir au remplaçant';
  end if;
  select count(*) into v_count from public.queue_entries q
   where q.barber_id = v_barber_b and q.customer_name = 'OS2 File Un';
  if v_count <> 1 then
    raise exception 'T4d: la personne en attente doit avoir suivi';
  end if;
  select count(*) into v_count from public.queue_entry_moves qm where qm.to_barber_id = v_barber_b;
  if v_count < 1 then
    raise exception 'T4e: le déplacement de file doit être journalisé';
  end if;
  -- LA loi produit : l'identité publique survit.
  select count(*) into v_count from public.professionals p where p.id = v_professional;
  if v_count <> 1 then
    raise exception 'T4f: retirer un barber NE DOIT PAS supprimer son profil professionnel';
  end if;
  select b.is_bookable into v_bool from public.barbers b where b.id = v_barber;
  if v_bool then
    raise exception 'T4g: le siège du barber retiré doit être fermé';
  end if;
  select count(*) into v_count from public.memberships m where m.id = v_membership;
  if v_count <> 0 then
    raise exception 'T4h: l''accès doit être retiré';
  end if;
  select count(*) into v_count from public.barbers b where b.id = v_barber;
  if v_count <> 1 then
    raise exception 'T4i: le lien d''emploi reste en base (historique), il est seulement fermé';
  end if;

  -- ==================================================================
  -- T5. Un manager ne touche plus un owner
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.memberships set role = 'manager'
   where organization_id = v_org and user_id = v_owner;
  execute 'reset role';
  select m.role::text into v_msg from public.memberships m
   where m.organization_id = v_org and m.user_id = v_owner;
  if v_msg <> 'owner' then
    raise exception 'T5a: un manager ne doit pas pouvoir rétrograder son owner (rôle = %)', v_msg;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  delete from public.memberships where organization_id = v_org and user_id = v_owner;
  execute 'reset role';
  select count(*) into v_count from public.memberships m
   where m.organization_id = v_org and m.user_id = v_owner;
  if v_count <> 1 then
    raise exception 'T5b: un manager ne doit pas pouvoir retirer son owner';
  end if;

  -- ==================================================================
  -- R1–R4. Les fiches clients
  -- ==================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  select * into v_row from public.list_organization_customers(v_org) c
   where c.customer_id = v_customer;
  if v_row.completed_count <> 4 then
    raise exception 'R2a: 4 prestations terminées attendues, reçu %', v_row.completed_count;
  end if;
  if v_row.average_interval_days not between 26 and 30 then
    raise exception 'R3a: intervalle moyen attendu ~28 jours, reçu %', v_row.average_interval_days;
  end if;
  if not v_row.is_lapsed then
    raise exception 'R3b: ce régulier a 90 jours de retard sur un cycle de 28 : il doit être signalé';
  end if;
  if v_row.usual_barber_id <> v_barber then
    raise exception 'R2b: le barber habituel doit être celui des prestations';
  end if;
  if not v_row.is_verified_client then
    raise exception 'R2c: ce client a un compte et des prestations : il doit être vérifié';
  end if;

  select * into v_row from public.list_organization_customers(v_org) c
   where c.customer_id = v_customer2;
  if v_row.completed_count <> 1 then
    raise exception 'R2d: le passage de file doit compter, reçu %', v_row.completed_count;
  end if;
  if v_row.average_interval_days is not null or v_row.is_lapsed then
    raise exception 'R3c: un client d''une seule visite n''a NI cycle NI retard — rien ne s''invente';
  end if;
  if v_row.is_verified_client then
    raise exception 'R2e: un client sans compte FadeUp n''est pas un « client vérifié »';
  end if;

  select count(*) into v_count from public.list_organization_customers(v_org, null, 'lapsed');
  if v_count <> 1 then
    raise exception 'R3d: le segment « en retard » doit rendre exactement 1 client, reçu %', v_count;
  end if;

  -- Minimisation : le client de l'autre salon n'apparaît jamais.
  select count(*) into v_count from public.list_organization_customers(v_org) c
   where c.customer_id = v_customer_other;
  if v_count <> 0 then
    raise exception 'R1a: un salon ne doit pas voir les clients d''un autre';
  end if;
  begin
    perform public.list_organization_customers(v_org2);
    raise exception 'R1b: l''owner de ce salon ne doit pas lire la liste d''un autre';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_organization_customer(v_customer_other);
    raise exception 'R1c: la fiche d''un client d''un autre salon doit être refusée';
  exception when insufficient_privilege then null;
  end;

  -- La fiche et l'historique.
  select * into v_row from public.get_organization_customer(v_customer);
  if v_row.note_count <> 2 then
    raise exception 'R4a: la fiche doit compter 2 notes, reçu %', v_row.note_count;
  end if;
  if not v_row.is_lapsed then
    raise exception 'R4b: la fiche et la liste doivent dire la même chose';
  end if;
  select count(*) into v_count from public.get_organization_customer_history(v_customer);
  if v_count <> 5 then
    raise exception 'R4c: 5 lignes d''historique attendues (4 terminés + 1 à venir), reçu %', v_count;
  end if;

  -- ==================================================================
  -- Z1. Le motif nul : anonyme refusé partout
  -- ==================================================================
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
  begin
    perform public.list_customer_notes(v_customer);
    raise exception 'Z1a: anonyme doit être refusé sur list_customer_notes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_my_customer_notes();
    raise exception 'Z1b: anonyme doit être refusé sur get_my_customer_notes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_organization_customers(v_org);
    raise exception 'Z1c: anonyme doit être refusé sur list_organization_customers';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_organization_services(v_org);
    raise exception 'Z1d: anonyme doit être refusé sur list_organization_services';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.list_team_members(v_org);
    raise exception 'Z1e: anonyme doit être refusé sur list_team_members';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_location_queue_thresholds(v_loc, 10);
    raise exception 'Z1f: anonyme doit être refusé sur set_location_queue_thresholds';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.invite_team_member(v_org, 'z@fadeup.test', 'barber');
    raise exception 'Z1g: anonyme doit être refusé sur invite_team_member';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';

  perform set_config('request.jwt.claims', '', true);
  raise notice 'OS2 : TOUT PASSE (N1-N5, C1-C6, Q1, T1-T5, R1-R4, Z1)';
end;
$verify$;

rollback;
