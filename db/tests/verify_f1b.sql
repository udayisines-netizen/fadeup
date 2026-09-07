-- FadeUp — vérification F1b : files par barber, estimation, quitter,
-- compte à rebours, balayage de grâce.
--
-- Modèle verify_b1 : UNE transaction, des assertions qui lèvent, ROLLBACK
-- final — ce script ne laisse RIEN derrière lui, sur quelque base qu'on le
-- lance. Il reste conçu pour le bac d'essai de restauration fidèle
-- (b3_restore_sandbox.sh), pas pour la production.
--
-- Il réutilise une organisation qa-f1-* léguée par F1 (essai actif donc
-- capacité liveQueue), la réactive DANS la transaction, et lui ajoute deux
-- barbers de test — tout est annulé au rollback.

\set ON_ERROR_STOP on

begin;

do $verify$
declare
  v_org uuid;
  v_slug text;
  v_loc uuid;
  v_lat double precision;
  v_lng double precision;
  v_token text;
  v_owner uuid;
  v_barber1 uuid;
  v_barber2 uuid;
  v_barber3 uuid;
  v_sp2 uuid;
  v_sp3 uuid;
  v_service uuid;
  v_service2 uuid;
  v_e_fa1 uuid; v_e_fa2 uuid; v_e_b1a uuid; v_e_b1b uuid;
  v_new_entry uuid;
  v_row record;
  v_count integer;
  v_est integer;
  v_pos integer;
  v_deadline timestamptz;
  v_swept integer;
  v_i integer;
  v_uuid uuid;
  v_detail text;
begin
  -- ------------------------------------------------------------------
  -- Fixture : une organisation qa-f1 réactivée, deux barbers ajoutés.
  -- ------------------------------------------------------------------
  select o.id, o.slug into v_org, v_slug
  from public.organizations o
  where o.slug like 'qa-f1-%'
    and private.org_has_capability(o.id, 'liveQueue')
  order by o.slug limit 1;
  if v_org is null then
    raise exception 'FIXTURE: aucune organisation qa-f1 avec liveQueue';
  end if;

  select l.id, l.latitude, l.longitude, l.queue_check_in_token
    into v_loc, v_lat, v_lng, v_token
  from public.locations l
  where l.organization_id = v_org and l.kind = 'physical_address'
  limit 1;

  update public.locations set is_active = true where id = v_loc;
  perform private.ensure_location_service_settings(v_loc);
  update public.location_service_settings
     set queue_open = true, queue_grace_sweep_enabled = false
   where location_id = v_loc;

  select m.user_id into v_owner
  from public.memberships m
  where m.organization_id = v_org and m.role = 'owner' limit 1;

  select b.id into v_barber1
  from public.barbers b
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  where b.organization_id = v_org and sp.location_id = v_loc
  limit 1;

  update public.staff_profiles set is_active = true, is_public = true
  where id = (select staff_profile_id from public.barbers where id = v_barber1);
  update public.barbers set is_bookable = true where id = v_barber1;

  insert into public.staff_profiles (organization_id, location_id, display_name, is_public, is_active)
  values (v_org, v_loc, 'F1b Barber Deux', true, true) returning id into v_sp2;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  values (v_org, v_sp2, true) returning id into v_barber2;

  insert into public.staff_profiles (organization_id, location_id, display_name, is_public, is_active)
  values (v_org, v_loc, 'F1b Barber Trois', true, true) returning id into v_sp3;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
  values (v_org, v_sp3, true) returning id into v_barber3;

  select s.id into v_service from public.services s
  where s.organization_id = v_org and s.is_active and s.duration_minutes = 30 limit 1;
  if v_service is null then
    select s.id into v_service from public.services s
    where s.organization_id = v_org and s.is_active limit 1;
    update public.services set duration_minutes = 30 where id = v_service;
  end if;

  insert into public.services (organization_id, name, duration_minutes, price_cents)
  values (v_org, 'F1b Service Cap', 30, 2000) returning id into v_service2;

  raise notice 'fixture: org % loc % barbers % % %', v_slug, v_loc, v_barber1, v_barber2, v_barber3;

  -- ------------------------------------------------------------------
  -- 1. Files par barber : positions partitionnées PAR FILE.
  -- ------------------------------------------------------------------
  select t.id into v_e_fa1 from public.join_public_queue(v_slug, v_loc, 'Anon Un', null, null, v_service, v_token, v_lat, v_lng) t;
  select t.id into v_e_fa2 from public.join_public_queue(v_slug, v_loc, 'Anon Deux', null, null, v_service, v_token, v_lat, v_lng) t;
  select t.id into v_e_b1a from public.join_public_queue(v_slug, v_loc, 'Choisi Un', null, v_barber1, v_service, v_token, v_lat, v_lng) t;
  select t.id into v_e_b1b from public.join_public_queue(v_slug, v_loc, 'Choisi Deux', null, v_barber1, v_service, v_token, v_lat, v_lng) t;

  -- Dans une transaction, now() est constant : les quatre entrées naissent
  -- avec le même created_at et l'ordre serait arbitraire. On les échelonne
  -- comme le ferait la réalité.
  update public.queue_entries set created_at = now() - interval '8 minutes' where id = v_e_fa1;
  update public.queue_entries set created_at = now() - interval '6 minutes' where id = v_e_fa2;
  update public.queue_entries set created_at = now() - interval '4 minutes' where id = v_e_b1a;
  update public.queue_entries set created_at = now() - interval '2 minutes' where id = v_e_b1b;

  select q.queue_position into v_pos from public.get_public_queue_status(v_slug, v_loc) q where q.id = v_e_fa2;
  if v_pos is distinct from 2 then
    raise exception 'A1: position FA2 attendue 2, obtenu %', v_pos;
  end if;
  select q.queue_position into v_pos from public.get_public_queue_status(v_slug, v_loc) q where q.id = v_e_b1a;
  if v_pos is distinct from 1 then
    raise exception 'A1: position B1a attendue 1 (dans SA file), obtenu % — la partition par barber ne tient pas', v_pos;
  end if;
  select q.queue_position into v_pos from public.get_public_queue_status(v_slug, v_loc) q where q.id = v_e_b1b;
  if v_pos is distinct from 2 then
    raise exception 'A1: position B1b attendue 2, obtenu %', v_pos;
  end if;
  raise notice 'A1 ok — positions par file (FA 1,2 ; barber1 1,2)';

  -- ------------------------------------------------------------------
  -- 2. list_public_queues : premier disponible EN TÊTE, tri croissant.
  -- ------------------------------------------------------------------
  create temp table f1b_queues on commit drop as
    select row_number() over () as rn, q.* from public.list_public_queues(v_slug, v_loc) q;

  select barber_id into v_uuid from f1b_queues where rn = 1;
  if v_uuid is not null then
    raise exception 'A2: la première ligne doit être « premier disponible » (barber_id null)';
  end if;
  -- barber2 et barber3 (0 attente) avant barber1 (2 attentes).
  if (select rn from f1b_queues where barber_id = v_barber1)
     < (select rn from f1b_queues where barber_id = v_barber3) then
    raise exception 'A2: barber1 (2 en attente) doit passer APRÈS barber3 (0)';
  end if;
  if (select waiting_count from f1b_queues where barber_id is null) <> 2 then
    raise exception 'A2: compteur FA attendu 2';
  end if;
  if (select waiting_count from f1b_queues where barber_id = v_barber1) <> 2 then
    raise exception 'A2: compteur barber1 attendu 2';
  end if;
  raise notice 'A2 ok — liste des files, FA en tête, tri par attente';

  -- ------------------------------------------------------------------
  -- 3. Un barber sans file : invisible, join refusé, motif distinct.
  -- ------------------------------------------------------------------
  update public.barbers set queue_enabled = false where id = v_barber2;

  if exists (select 1 from public.list_public_queues(v_slug, v_loc) q where q.barber_id = v_barber2) then
    raise exception 'A3: un barber queue_enabled=false ne doit pas être listé';
  end if;

  begin
    perform public.join_public_queue(v_slug, v_loc, 'Refusé', null, v_barber2, v_service, v_token, v_lat, v_lng);
    raise exception 'A3: join vers un barber sans file aurait dû être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%fadeup_queue_refusal=barber_queue_disabled%' then
      raise;
    end if;
  end;
  raise notice 'A3 ok — barber sans file : masqué et refus barber_queue_disabled';

  -- ------------------------------------------------------------------
  -- 4. Déplacement par le salon : droit du barber, trace, ancienneté.
  -- ------------------------------------------------------------------
  -- Le barber1 (résolu par user_id) déplace Anon Un vers barber3.
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.move_queue_entry(v_e_fa1, v_barber3);
  perform set_config('request.jwt.claims', '', true);

  select qe.barber_id into v_uuid from public.queue_entries qe where qe.id = v_e_fa1;
  if v_uuid is distinct from v_barber3 then
    raise exception 'A4: l''entrée déplacée doit porter barber3';
  end if;
  select count(*) into v_count from public.queue_entry_moves m
  where m.entry_id = v_e_fa1 and m.kind = 'staff_move'
    and m.from_barber_id is null and m.to_barber_id = v_barber3 and m.moved_by = v_owner;
  if v_count <> 1 then
    raise exception 'A4: trace staff_move (qui, d''où, vers où) absente';
  end if;
  -- Ancienneté conservée : Anon Un (créé avant Choisi Un) est 1er chez barber3.
  select q.queue_position into v_pos from public.get_public_queue_status(v_slug, v_loc) q where q.id = v_e_fa1;
  if v_pos is distinct from 1 then
    raise exception 'A4: le déplacé garde son ancienneté (position 1 chez barber3), obtenu %', v_pos;
  end if;

  -- Un inconnu authentifié ne déplace rien.
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  begin
    perform public.move_queue_entry(v_e_fa2, v_barber3);
    raise exception 'A4: un étranger a pu déplacer une entrée';
  exception when others then
    if sqlerrm not like '%not authorized to move%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'A4 ok — déplacement salon tracé, ancienneté conservée, étranger refusé';

  -- ------------------------------------------------------------------
  -- 5. Changer de barber (client) : fin de nouvelle file, trace.
  -- ------------------------------------------------------------------
  -- Choisi Un (barber1, position 1) bascule vers barber3 (où Anon Un attend).
  select t.id into v_new_entry from public.change_queue_entry_barber(v_e_b1a, v_barber3) t;

  select qe.status into v_row from public.queue_entries qe where qe.id = v_e_b1a;
  if v_row.status::text <> 'cancelled' then
    raise exception 'A5: l''entrée d''origine doit être annulée';
  end if;
  select q.queue_position into v_pos from public.get_public_queue_status(v_slug, v_loc) q where q.id = v_new_entry;
  if v_pos is distinct from 2 then
    raise exception 'A5: la nouvelle entrée doit être EN FIN de la file barber3 (position 2), obtenu %', v_pos;
  end if;
  select count(*) into v_count from public.queue_entry_moves m
  where m.entry_id = v_e_b1a and m.new_entry_id = v_new_entry and m.kind = 'customer_change'
    and m.from_barber_id = v_barber1 and m.to_barber_id = v_barber3;
  if v_count <> 1 then
    raise exception 'A5: trace customer_change absente';
  end if;

  -- Changer vers un barber sans file : refus nommé, entrée intacte.
  begin
    perform public.change_queue_entry_barber(v_new_entry, v_barber2);
    raise exception 'A5: changement vers un barber sans file accepté';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%barber_queue_disabled%' then raise; end if;
  end;
  if (select qe.status from public.queue_entries qe where qe.id = v_new_entry)::text <> 'waiting' then
    raise exception 'A5: un refus de changement ne doit pas toucher l''entrée';
  end if;
  raise notice 'A5 ok — changement client : annulation + fin de file + trace, refus sans dégât';

  -- ------------------------------------------------------------------
  -- 6. Estimation : seuils 5/20, aberrants, plafond, repli, RIEN.
  -- ------------------------------------------------------------------
  -- n=0 : durée déclarée telle quelle.
  v_est := private.estimated_service_duration_minutes(v_loc, v_barber1, v_service);
  if v_est is distinct from 30 then
    raise exception 'A6: n=0 doit rendre le déclaré (30), obtenu %', v_est;
  end if;

  -- 4 mesures de 20 min : toujours le déclaré (moins de 5).
  for v_i in 1..4 loop
    insert into public.service_duration_samples (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values (v_org, v_loc, v_barber1, v_service, 'queue', gen_random_uuid(), now() - interval '2 hours', now() - interval '2 hours' + interval '20 minutes');
  end loop;
  v_est := private.estimated_service_duration_minutes(v_loc, v_barber1, v_service);
  if v_est is distinct from 30 then
    raise exception 'A6: n=4 doit encore rendre le déclaré (30), obtenu %', v_est;
  end if;

  -- 5e mesure : la pondération commence, tout près du déclaré.
  insert into public.service_duration_samples (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
  values (v_org, v_loc, v_barber1, v_service, 'queue', gen_random_uuid(), now() - interval '2 hours', now() - interval '2 hours' + interval '20 minutes');
  v_est := private.estimated_service_duration_minutes(v_loc, v_barber1, v_service);
  if v_est not between 28 and 30 then
    raise exception 'A6: n=5 doit pondérer légèrement vers l''observé (attendu 29), obtenu %', v_est;
  end if;

  -- Des aberrantes (2 min, 300 min) : écartées, l'estimation ne bouge pas.
  insert into public.service_duration_samples (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
  values (v_org, v_loc, v_barber1, v_service, 'queue', gen_random_uuid(), now() - interval '1 hour', now() - interval '1 hour' + interval '2 minutes'),
         (v_org, v_loc, v_barber1, v_service, 'queue', gen_random_uuid(), now() - interval '9 hours', now() - interval '9 hours' + interval '300 minutes');
  if private.estimated_service_duration_minutes(v_loc, v_barber1, v_service)
     is distinct from v_est then
    raise exception 'A6: les valeurs aberrantes doivent être écartées';
  end if;

  -- 20 mesures de plus : l'observé l'emporte (20 min, dans le plafond).
  for v_i in 1..20 loop
    insert into public.service_duration_samples (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values (v_org, v_loc, v_barber1, v_service, 'queue', gen_random_uuid(), now() - interval '30 minutes', now() - interval '30 minutes' + interval '20 minutes');
  end loop;
  v_est := private.estimated_service_duration_minutes(v_loc, v_barber1, v_service);
  if v_est is distinct from 20 then
    raise exception 'A6: n>20 doit rendre l''observé (20), obtenu %', v_est;
  end if;

  -- Plafond d'écart : 30 déclarées, 90 observées -> borné à 45 et SIGNALÉ.
  for v_i in 1..25 loop
    insert into public.service_duration_samples (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
    values (v_org, v_loc, v_barber2, v_service2, 'queue', gen_random_uuid(), now() - interval '4 hours', now() - interval '4 hours' + interval '90 minutes');
  end loop;
  v_est := private.estimated_service_duration_minutes(v_loc, v_barber2, v_service2);
  if v_est is distinct from 45 then
    raise exception 'A6: l''écart doit être plafonné à 1,5 x déclaré (45), obtenu %', v_est;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  select count(*) into v_count from public.get_service_duration_insights(v_loc) i
  where i.barber_id = v_barber2 and i.service_id = v_service2 and i.estimate_capped;
  perform set_config('request.jwt.claims', '', true);
  if v_count <> 1 then
    raise exception 'A6: l''écart plafonné doit être SIGNALÉ au pro (estimate_capped)';
  end if;

  -- Service sans durée déclarée impossible (duration_minutes NOT NULL > 0) ;
  -- le « rien » se prouve par un service inconnu de l'estimateur : NULL.
  if private.estimated_service_duration_minutes(v_loc, v_barber1, null) is not null then
    raise exception 'A6: sans service, aucune minute — NULL attendu';
  end if;
  raise notice 'A6 ok — seuils 5/20, aberrantes écartées, plafond signalé, NULL honnête';

  -- ------------------------------------------------------------------
  -- 7. Temps d'attente d'une file : somme des durées devant ; FA
  --    multi-barbers : RIEN.
  -- ------------------------------------------------------------------
  -- File barber1 : 1 en attente (Choisi Deux), service 30 min estimé 20.
  v_est := private.queue_wait_minutes(v_loc, v_barber1);
  if v_est is distinct from 20 then
    raise exception 'A7: attente barber1 attendue 20 (1 x observé 20), obtenu %', v_est;
  end if;
  -- FA d'un salon multi-barbers : pas d'invention.
  if private.queue_wait_minutes(v_loc, null) is not null then
    raise exception 'A7: FA multi-barbers doit rendre NULL';
  end if;
  raise notice 'A7 ok — somme des durées devant ; FA multi-barbers = rien';

  -- ------------------------------------------------------------------
  -- 8. Collecte par trigger : une entrée de file terminée écrit sa mesure.
  -- ------------------------------------------------------------------
  update public.queue_entries set status = 'called' where id = v_e_b1b;
  update public.queue_entries set status = 'in_service' where id = v_e_b1b;
  -- Recul cohérent des trois horodatages (contrainte monotonique) pour
  -- simuler une prestation commencée il y a 26 minutes.
  update public.queue_entries
     set created_at = created_at - interval '40 minutes',
         called_at = called_at - interval '30 minutes',
         service_started_at = service_started_at - interval '26 minutes'
   where id = v_e_b1b;
  update public.queue_entries set status = 'completed' where id = v_e_b1b;
  select count(*) into v_count from public.service_duration_samples s
  where s.source = 'queue' and s.source_entry_id = v_e_b1b;
  if v_count <> 1 then
    raise exception 'A8: la prestation de file terminée doit produire UNE mesure';
  end if;
  if (select round(s.duration_minutes) from public.service_duration_samples s
      where s.source_entry_id = v_e_b1b) not between 25 and 27 then
    raise exception 'A8: la mesure doit refléter la durée réelle (~26 min)';
  end if;
  raise notice 'A8 ok — collecte file par trigger, durée réelle';

  -- La collecte couvre AUSSI les rendez-vous : une prestation terminée sur
  -- rendez-vous est une mesure valable (starts_at planifié -> completed_at).
  insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status)
  values (v_org, v_loc, v_barber1, v_service, 'RDV Mesuré', now() - interval '35 minutes', now() - interval '5 minutes', 'confirmed')
  returning id into v_uuid;
  update public.appointments set status = 'completed' where id = v_uuid;
  select count(*) into v_count from public.service_duration_samples s
  where s.source = 'appointment' and s.source_entry_id = v_uuid;
  if v_count <> 1 then
    raise exception 'A8b: le rendez-vous terminé doit produire UNE mesure';
  end if;
  if (select round(s.duration_minutes) from public.service_duration_samples s
      where s.source_entry_id = v_uuid) not between 34 and 36 then
    raise exception 'A8b: la mesure rendez-vous doit valoir ~35 min';
  end if;
  raise notice 'A8b ok — collecte rendez-vous par trigger';

  -- ------------------------------------------------------------------
  -- 9. Quitter la file : capacité anonyme, propriété de compte, appelé.
  -- ------------------------------------------------------------------
  -- Un uuid au hasard : rien.
  begin
    perform public.leave_public_queue(gen_random_uuid());
    raise exception 'A9: un identifiant inconnu doit être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%entry_not_found%' then raise; end if;
  end;

  -- Une entrée de COMPTE ne se quitte pas avec le seul uuid.
  update public.queue_entries set booked_by_user_id = v_owner where id = v_e_fa2;

  -- ... ni par un APPELANT ANONYME (auth.uid() NULL) : c'est le cas qui a
  -- exigé le coalesce de queue_entry_client_access — « uuid = NULL » vaut
  -- NULL, et un « if not NULL » ne lève pas. Attrapé par l'e2e F1b.
  perform set_config('request.jwt.claims', '', true);
  begin
    perform public.leave_public_queue(v_e_fa2);
    raise exception 'A9: un anonyme ne doit pas pouvoir quitter une entrée de COMPTE';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%not_entry_owner%' then raise; end if;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  begin
    perform public.leave_public_queue(v_e_fa2);
    raise exception 'A9: quitter la file d''un autre compte doit être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%not_entry_owner%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);

  -- Son propriétaire, lui, sort — même déjà APPELÉ (décision F1b §4).
  update public.queue_entries set status = 'called' where id = v_e_fa2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  perform public.leave_public_queue(v_e_fa2);
  perform set_config('request.jwt.claims', '', true);
  if (select qe.status from public.queue_entries qe where qe.id = v_e_fa2)::text <> 'cancelled' then
    raise exception 'A9: le propriétaire appelé doit pouvoir quitter (-> cancelled)';
  end if;

  -- Terminal : refus nommé — pour son PROPRIÉTAIRE (l'accès est vérifié
  -- avant l'état : un anonyme sur une entrée de compte reçoit
  -- not_entry_owner, jamais un indice sur l'état).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  begin
    perform public.leave_public_queue(v_e_fa2);
    raise exception 'A9: quitter une entrée close doit être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%entry_already_closed%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'A9 ok — capacité, propriété de compte, appelé sortable, terminal refusé';

  -- ------------------------------------------------------------------
  -- 10. Suivi : position dans SA file, échéance absolue, tiers refusé.
  -- ------------------------------------------------------------------
  select t.queue_position, t.people_ahead, t.called_deadline_at
    into v_row
  from public.get_queue_entry_tracking(v_e_fa1) t;
  if v_row.queue_position is distinct from 1 or v_row.people_ahead is distinct from 0 then
    raise exception 'A10: position/personnes devant incorrectes (%, %)', v_row.queue_position, v_row.people_ahead;
  end if;
  if v_row.called_deadline_at is not null then
    raise exception 'A10: pas d''échéance pour une entrée en attente';
  end if;

  update public.queue_entries set status = 'called' where id = v_e_fa1;
  select t.called_deadline_at into v_deadline from public.get_queue_entry_tracking(v_e_fa1) t;
  if v_deadline is null then
    raise exception 'A10: une entrée appelée doit porter son échéance';
  end if;
  if v_deadline is distinct from (
    select qe.called_at + make_interval(mins => s.queue_call_grace_minutes)
    from public.queue_entries qe
    join public.location_service_settings s on s.location_id = qe.location_id
    where qe.id = v_e_fa1
  ) then
    raise exception 'A10: l''échéance doit être called_at + grâce, calculée serveur';
  end if;

  -- Un COMPTE tiers ne consulte pas l'échéance d'un autre.
  update public.queue_entries set booked_by_user_id = v_owner where id = v_e_fa1;
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  begin
    perform public.get_queue_entry_tracking(v_e_fa1);
    raise exception 'A10: consulter l''entrée d''un autre compte doit être refusé';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if coalesce(v_detail, '') not like '%not_entry_owner%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'A10 ok — suivi : position par file, échéance serveur, tiers refusé';

  -- ------------------------------------------------------------------
  -- 11. Balayage de grâce : off par défaut, idempotent, tracé, notifié.
  -- ------------------------------------------------------------------
  -- v_e_fa1 est appelé, échéance passée de force (recul cohérent :
  -- contrainte monotonique created <= called).
  update public.queue_entries
     set created_at = created_at - interval '1 hour',
         called_at = now() - interval '30 minutes'
   where id = v_e_fa1;

  -- Balayage DÉSACTIVÉ (défaut) : rien ne bouge.
  select r.entries_swept into v_swept from public.run_queue_grace_maintenance() r;
  if v_swept <> 0 then
    raise exception 'A11: balayage désactivé, % entrée(s) balayée(s)', v_swept;
  end if;

  update public.location_service_settings set queue_grace_sweep_enabled = true where location_id = v_loc;

  select r.entries_swept into v_swept from public.run_queue_grace_maintenance() r;
  if v_swept <> 1 then
    raise exception 'A11: 1 balayage attendu, obtenu %', v_swept;
  end if;
  if (select qe.status from public.queue_entries qe where qe.id = v_e_fa1)::text <> 'no_show'
     or (select qe.auto_marked_no_show_at from public.queue_entries qe where qe.id = v_e_fa1) is null then
    raise exception 'A11: l''entrée balayée doit être no_show ET tracée automatique';
  end if;

  -- Redémarrage : AUCUN effet double.
  select r.entries_swept into v_swept from public.run_queue_grace_maintenance() r;
  if v_swept <> 0 then
    raise exception 'A11: le re-balayage doit être un no-op, obtenu %', v_swept;
  end if;

  -- Le compte lié a reçu SA notification, formulée sans reproche, une seule.
  select count(*) into v_count from public.notifications n
  where n.user_id = v_owner and n.type::text = 'queue_grace_removed'
    and n.dedupe_key = 'queue_grace_removed:' || v_e_fa1::text;
  if v_count <> 1 then
    raise exception 'A11: notification du balayage absente ou dupliquée (%)', v_count;
  end if;

  -- Le suivi distingue la sortie automatique (l'entrée porte un compte
  -- depuis A10 : on consulte en tant que lui).
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  if not (select t.removed_automatically from public.get_queue_entry_tracking(v_e_fa1) t) then
    raise exception 'A11: le suivi doit dire que la sortie était automatique';
  end if;
  perform set_config('request.jwt.claims', '', true);

  -- Un « absent » cliqué par le salon reste distinguable (pas de trace auto).
  update public.queue_entries set status = 'called' where id = v_new_entry;
  update public.queue_entries set status = 'no_show' where id = v_new_entry;
  if (select qe.auto_marked_no_show_at from public.queue_entries qe where qe.id = v_new_entry) is not null then
    raise exception 'A11: une sortie manuelle ne doit pas porter la trace automatique';
  end if;
  -- Le droit d'exécution appartient au scheduler, pas aux clients.
  if not has_function_privilege('fadeup_scheduler', 'public.run_queue_grace_maintenance()', 'execute') then
    raise exception 'A11: fadeup_scheduler doit pouvoir exécuter la passe';
  end if;
  if has_function_privilege('authenticated', 'public.run_queue_grace_maintenance()', 'execute')
     or has_function_privilege('anon', 'public.run_queue_grace_maintenance()', 'execute') then
    raise exception 'A11: la passe ne doit être exécutable par aucun client';
  end if;
  raise notice 'A11 ok — balayage off par défaut, idempotent, tracé, notifié sans reproche';

  raise notice 'VERIFY F1B : TOUT PASSE';
end;
$verify$;

rollback;
