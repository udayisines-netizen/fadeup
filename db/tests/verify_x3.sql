-- FadeUp — vérification X3 : motif NULL, privilèges, ACL par défaut.
--
-- Modèle verify_b1/f1b : UNE transaction, des assertions qui lèvent,
-- ROLLBACK final — ne laisse RIEN derrière lui. Conçu pour le bac d'essai de
-- restauration fidèle (b3_restore_sandbox.sh), APRÈS application des quatre
-- migrations X3. À lancer en supabase_admin (les set local role exigent le
-- superuser).
--
-- Ce qu'il prouve :
--   A. reschedule_appointment — le trou « customer_id NULL » est fermé
--      (42501 pour un authentifié étranger sur un rendez-vous walk-in),
--      les chemins salon et client marchent toujours, p_starts_at NULL est
--      rejeté nommément.
--   B. staff_profiles — la tautologie de la policy INSERT est morte, la
--      réassignation de user_id en UPDATE est gardée, les chemins légitimes
--      passent (et prouvent au passage que les triggers se déclenchent
--      toujours après la révocation d'EXECUTE sur leurs fonctions).
--   C. Les quatre gardes fail-open ne laissent plus passer un rôle-claim
--      client ('anon') avec uid NULL ; les sessions serveur passent.
--   D. Privilèges : plus aucun TRUNCATE/TRIGGER/REFERENCES/MAINTAIN pour
--      anon/authenticated sur public+storage ; plus d'EXECUTE PUBLIC dans
--      private ni sur les fonctions trigger ; les grants légitimes restent.
--   E. ACL par défaut : une table neuve naît sans les quatre verbes, une
--      fonction neuve de public naît sans EXECUTE client, une fonction neuve
--      de private naît sans EXECUTE PUBLIC.

\set ON_ERROR_STOP on

begin;

-- ============================================================ fixtures
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('e3000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'qa-x3-owner-a@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"X3 Owner A"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'qa-x3-owner-b@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"X3 Owner B"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c'::uuid, 'qa-x3-user-c@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"X3 User C"}', 'authenticated', 'authenticated'),
  ('e3000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'qa-x3-customer-x@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"X3 Customer X"}', 'authenticated', 'authenticated');

-- Org A (l'« attaquant » en est owner) et org B (la victime), créées par le
-- chemin produit réel.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);
select public.complete_organization_onboarding('X3 Org A', 'qa-x3-org-a', 'Main', 'UTC');
select set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000b', 'role', 'authenticated')::text, true);
select public.complete_organization_onboarding('X3 Org B', 'qa-x3-org-b', 'Main', 'UTC');
reset role;
select set_config('request.jwt.claims', '', true);

do $fixtures$
declare
  v_org_a uuid; v_org_b uuid; v_loc_b uuid; v_svc_b uuid; v_sp_b uuid; v_brb_b uuid;
  v_walkin uuid;
  v_cust_x uuid;
begin
  select id into v_org_a from public.organizations where slug = 'qa-x3-org-a';
  select id into v_org_b from public.organizations where slug = 'qa-x3-org-b';
  select id into v_loc_b from public.locations where organization_id = v_org_b;

  insert into public.services (organization_id, name, duration_minutes, price_cents)
    values (v_org_b, 'Fade', 30, 2000) returning id into v_svc_b;
  select id into v_sp_b from public.staff_profiles where organization_id = v_org_b;
  update public.staff_profiles set location_id = v_loc_b where id = v_sp_b;
  insert into public.barbers (organization_id, staff_profile_id, is_bookable)
    values (v_org_b, v_sp_b, true) returning id into v_brb_b;
  insert into public.service_locations (organization_id, service_id, location_id)
    values (v_org_b, v_svc_b, v_loc_b);
  insert into public.barber_services (organization_id, barber_id, service_id)
    values (v_org_b, v_brb_b, v_svc_b);
  insert into public.location_hours (organization_id, location_id, day_of_week, open_time, close_time)
    select v_org_b, v_loc_b, d, '00:00', '23:59' from generate_series(0, 6) d;
  insert into public.barber_working_hours (organization_id, barber_id, day_of_week, start_time, end_time)
    select v_org_b, v_brb_b, d, '00:00', '23:59' from generate_series(0, 6) d;

  -- La capacité booking est nécessaire pour insérer un rendez-vous (refusée
  -- sur le plan gratuit). start_organization_trial exigerait une readiness
  -- marketplace complète, hors sujet ici : on pose l'essai directement, en
  -- session serveur — tout est annulé au rollback.
  insert into public.organization_trials (organization_id, plan_key, ends_at, started_from)
    values (v_org_b, 'salon_pro', now() + interval '14 days', 'owner_request');

  -- Le rendez-vous WALK-IN : customer_id NULL, booked_by_user_id NULL —
  -- exactement le profil que le trou de reschedule_appointment exposait.
  insert into public.appointments (organization_id, location_id, barber_id, service_id,
      customer_name, starts_at, ends_at, status)
    values (v_org_b, v_loc_b, v_brb_b, v_svc_b, 'Walk-in Client',
      date_trunc('hour', now()) + interval '26 hours',
      date_trunc('hour', now()) + interval '26 hours 30 minutes', 'confirmed')
    returning id into v_walkin;

  -- L'attaquant a une fiche customers rattachée à son compte (condition du
  -- trou : « NULL in (ensemble NON VIDE) » = NULL).
  insert into public.customers (organization_id, name, user_id)
    values (v_org_b, 'X3 Customer X', 'e3000000-0000-0000-0000-00000000000d');
  select id into v_cust_x from public.customers
    where organization_id = v_org_b and user_id = 'e3000000-0000-0000-0000-00000000000d';

  perform set_config('x3.org_a', v_org_a::text, true);
  perform set_config('x3.org_b', v_org_b::text, true);
  perform set_config('x3.walkin', v_walkin::text, true);
  perform set_config('x3.cust_x', v_cust_x::text, true);
  perform set_config('x3.sp_b', v_sp_b::text, true);
  raise notice 'FIXTURES: org A %, org B %, walk-in %', v_org_a, v_org_b, v_walkin;
end $fixtures$;

-- ============================================================ A. reschedule
do $a$
declare
  v_walkin uuid := current_setting('x3.walkin')::uuid;
  v_row public.appointments;
  v_state text; v_msg text;
begin
  -- A1. Authentifié étranger (avec fiche customers) sur un walk-in → 42501.
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000d', 'role', 'authenticated')::text, true);
  begin
    v_row := public.reschedule_appointment(v_walkin, date_trunc('hour', now()) + interval '30 hours');
    raise exception 'FAIL A1: un authentifié étranger a déplacé un rendez-vous walk-in d''un autre salon (le trou customer_id NULL est ouvert)';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL A1: refus attendu en 42501, reçu % (%)', v_state, v_msg;
    end if;
  end;
  raise notice 'PASS A1: walk-in d''autrui refusé en 42501 pour un authentifié étranger';

  -- A2. p_starts_at NULL → rejet nommé, PAS un passage silencieux.
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000b', 'role', 'authenticated')::text, true);
  begin
    v_row := public.reschedule_appointment(v_walkin, null);
    raise exception 'FAIL A2: p_starts_at NULL accepté';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_msg not like '%the new time is required%' then
      raise exception 'FAIL A2: refus nommé attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  raise notice 'PASS A2: p_starts_at NULL rejeté nommément';

  -- A3. Le salon (owner B) déplace toujours son walk-in.
  v_row := public.reschedule_appointment(v_walkin, date_trunc('hour', now()) + interval '28 hours');
  if v_row.starts_at <> date_trunc('hour', now()) + interval '28 hours' then
    raise exception 'FAIL A3: déplacement salon sans effet';
  end if;
  raise notice 'PASS A3: le chemin salon fonctionne toujours';

  perform set_config('request.jwt.claims', '', true);
end $a$;

-- ============================================================ B. staff_profiles
do $b$
declare
  v_org_a uuid := current_setting('x3.org_a')::uuid;
  v_sp uuid;
  v_state text; v_msg text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- B1. Rattacher un compte NON membre → refus RLS (la tautologie est morte).
  begin
    insert into public.staff_profiles (organization_id, user_id, display_name)
      values (v_org_a, 'e3000000-0000-0000-0000-00000000000c', 'Intrus');
    raise exception 'FAIL B1: la policy INSERT accepte encore un user_id non membre (tautologie vivante)';
  exception when insufficient_privilege or check_violation then
    null;
  when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL B1: refus RLS attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  raise notice 'PASS B1: user_id non membre refusé à l''INSERT';

  -- B2. Staff SANS compte (user_id NULL) → permis.
  insert into public.staff_profiles (organization_id, user_id, display_name)
    values (v_org_a, null, 'Sans Compte') returning id into v_sp;
  raise notice 'PASS B2: staff sans compte accepté';

  -- B3. Réassigner user_id vers un non-membre en UPDATE → refus du trigger.
  begin
    update public.staff_profiles set user_id = 'e3000000-0000-0000-0000-00000000000c' where id = v_sp;
    raise exception 'FAIL B3: la réassignation de user_id vers un non-membre passe en UPDATE';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL B3: refus 42501 attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  raise notice 'PASS B3: réassignation de user_id gardée en UPDATE';

  -- B4. UPDATE anodin → passe (et les triggers set_updated_at & co, dont
  -- l''EXECUTE anon/authenticated/PUBLIC vient d''être révoqué, se
  -- déclenchent toujours : le déclenchement ne vérifie pas EXECUTE).
  update public.staff_profiles set display_name = 'Sans Compte 2' where id = v_sp;
  raise notice 'PASS B4: UPDATE légitime OK — les triggers se déclenchent après révocation';

  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);

  -- B5. Rattacher un VRAI membre → permis (policy corrigée, pas bloquante).
  insert into public.memberships (organization_id, user_id, role)
    values (v_org_a, 'e3000000-0000-0000-0000-00000000000c', 'barber');
  -- handle_new_membership crée automatiquement un staff profile pour le
  -- nouveau membre ; on le retire pour tester la réassignation manuelle sans
  -- heurter l'unicité (org, user).
  delete from public.staff_profiles
    where organization_id = v_org_a and user_id = 'e3000000-0000-0000-0000-00000000000c';
  perform set_config('request.jwt.claims', json_build_object('sub', 'e3000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.staff_profiles set user_id = 'e3000000-0000-0000-0000-00000000000c' where id = v_sp;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS B5: rattachement d''un membre réel accepté';
end $b$;

-- ============================================================ C. gardes fail-open
do $c$
declare
  v_org_a uuid := current_setting('x3.org_a')::uuid;
  v_org_new uuid;
  v_app uuid;
  v_cust uuid := current_setting('x3.cust_x')::uuid;
  v_state text; v_msg text;
begin
  -- C1. Rôle-claim 'anon', uid NULL → création directe d'organisation REFUSÉE
  -- par le trigger même si le privilège INSERT existait (défense en
  -- profondeur : on teste la garde, pas le GRANT, donc en supabase_admin).
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    insert into public.organizations (name, slug) values ('X3 Evil Org', 'qa-x3-evil');
    raise exception 'FAIL C1: le trigger de création d''organisation laisse passer un rôle-claim anon';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL C1: 42501 attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  raise notice 'PASS C1: assert_organization_creation_authorized ferme le rôle-claim anon';

  -- C2. Session serveur (aucun claim) → l'échappatoire opérateur marche.
  perform set_config('request.jwt.claims', '', true);
  insert into public.organizations (name, slug) values ('X3 Operator Org', 'qa-x3-operator')
    returning id into v_org_new;
  raise notice 'PASS C2: l''échappatoire serveur de la création d''organisation fonctionne';

  -- C3. guard_customers_identity : rôle-claim anon → réassignation refusée.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    update public.customers set user_id = 'e3000000-0000-0000-0000-00000000000c' where id = v_cust;
    raise exception 'FAIL C3: guard_customers_identity laisse passer un rôle-claim anon';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL C3: 42501 attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  update public.customers set user_id = null where id = v_cust;
  raise notice 'PASS C3: guard_customers_identity ferme le rôle-claim anon, la session serveur passe';

  -- C4. guard_professional_application_update : même motif.
  insert into public.professional_applications (user_id, first_name, last_name, email, phone, business_name, professional_type)
    values ('e3000000-0000-0000-0000-00000000000c', 'X', 'Trois', 'qa-x3-app@fadeup.test', '+33600000000', 'X3 Barber Solo', 'independent_barber')
    returning id into v_app;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    update public.professional_applications set status = 'approved' where id = v_app;
    raise exception 'FAIL C4: guard_professional_application_update laisse passer un rôle-claim anon';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL C4: 42501 attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS C4: guard_professional_application_update ferme le rôle-claim anon';

  -- C5. guard_marketplace_publication : rôle-claim anon → publication refusée.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  begin
    update public.organizations set marketplace_visible = true where id = v_org_a;
    raise exception 'FAIL C5: guard_marketplace_publication laisse passer un rôle-claim anon';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state <> '42501' then
      raise exception 'FAIL C5: 42501 attendu, reçu % (%)', v_state, v_msg;
    end if;
  end;
  perform set_config('request.jwt.claims', '', true);
  raise notice 'PASS C5: guard_marketplace_publication ferme le rôle-claim anon';
end $c$;

-- ============================================================ D. privilèges
do $d$
declare
  v_count integer;
begin
  -- D1. Plus aucun des quatre verbes pour anon/authenticated (public+storage).
  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p', 'f', 'v', 'm')
    and a.grantee::regrole::text in ('anon', 'authenticated')
    and a.privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN');
  if v_count <> 0 then
    raise exception 'FAIL D1: % privilège(s) TRUNCATE/TRIGGER/REFERENCES/MAINTAIN restants', v_count;
  end if;
  raise notice 'PASS D1: 0 TRUNCATE/TRIGGER/REFERENCES/MAINTAIN pour anon/authenticated sur public+storage';

  -- D2. Plus d'EXECUTE PUBLIC dans private (ni explicite, ni implicite).
  select count(*) into v_count
  from pg_proc p
  where p.pronamespace = 'private'::regnamespace
    and (p.proacl is null
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_count <> 0 then
    raise exception 'FAIL D2: % fonction(s) private encore exécutables par PUBLIC', v_count;
  end if;
  raise notice 'PASS D2: 0 EXECUTE PUBLIC dans private';

  -- D3. Plus d'EXECUTE PUBLIC/anon/authenticated sur les fonctions trigger.
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where n.nspname in ('public', 'private') and p.prorettype = 'trigger'::regtype
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or a.grantee::regrole::text in ('anon', 'authenticated'));
  if v_count <> 0 then
    raise exception 'FAIL D3: % grant(s) EXECUTE client restants sur des fonctions trigger', v_count;
  end if;
  raise notice 'PASS D3: 0 EXECUTE PUBLIC/anon/authenticated sur les fonctions trigger';

  -- D4. Les grants légitimes ont survécu : le front appelle ces RPC.
  if not has_function_privilege('anon', 'public.normalize_phone_number(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.suggested_currency_for_country(text)', 'execute')
     or not has_function_privilege('authenticated', 'private.has_org_role(uuid, public.membership_role[])', 'execute')
     or not has_function_privilege('authenticated', 'private.queue_stage(public.queue_status)', 'execute')
     or not has_function_privilege('anon', 'public.join_public_queue(text, uuid, text, text, uuid, uuid, text, double precision, double precision)', 'execute') then
    raise exception 'FAIL D4: un grant EXECUTE légitime a été perdu';
  end if;
  raise notice 'PASS D4: les grants EXECUTE légitimes (RPC front, helpers RLS, F1 §10.1) sont intacts';

  -- D5. SELECT/INSERT/UPDATE/DELETE n'ont pas bougé sur une table témoin.
  if not has_table_privilege('authenticated', 'public.queue_entries', 'select')
     or not has_table_privilege('authenticated', 'public.staff_profiles', 'insert') then
    raise exception 'FAIL D5: un verbe RLS-gouverné a été perdu';
  end if;
  raise notice 'PASS D5: les verbes gouvernés par RLS sont intacts';
end $d$;

-- ============================================================ E. ACL par défaut
do $e$
declare
  v_has boolean;
begin
  -- Créées par supabase_admin (rôle de session) : ses défauts sont durcis.
  execute 'create table public.x3_defacl_probe (id int)';
  if has_table_privilege('anon', 'public.x3_defacl_probe', 'truncate')
     or has_table_privilege('authenticated', 'public.x3_defacl_probe', 'truncate')
     or has_table_privilege('anon', 'public.x3_defacl_probe', 'trigger')
     or has_table_privilege('anon', 'public.x3_defacl_probe', 'references')
     or has_table_privilege('anon', 'public.x3_defacl_probe', 'maintain') then
    raise exception 'FAIL E1: une table neuve naît encore avec un des quatre verbes';
  end if;
  if not has_table_privilege('anon', 'public.x3_defacl_probe', 'select')
     or not has_table_privilege('authenticated', 'public.x3_defacl_probe', 'insert') then
    raise exception 'FAIL E1b: la révocation par défaut a débordé sur les verbes RLS-gouvernés';
  end if;
  raise notice 'PASS E1: une table neuve naît sans TRUNCATE/TRIGGER/REFERENCES/MAINTAIN client';

  execute 'create function public.x3_defacl_fn() returns int language sql as $f$ select 1 $f$';
  if has_function_privilege('anon', 'public.x3_defacl_fn()', 'execute')
     or has_function_privilege('authenticated', 'public.x3_defacl_fn()', 'execute') then
    raise exception 'FAIL E2: une fonction neuve de public naît encore exécutable par les rôles client';
  end if;
  if not has_function_privilege('service_role', 'public.x3_defacl_fn()', 'execute') then
    raise exception 'FAIL E2b: service_role a perdu son EXECUTE par défaut';
  end if;
  raise notice 'PASS E2: une fonction neuve de public naît sans EXECUTE anon/authenticated';

  execute 'create function private.x3_defacl_pfn() returns int language sql as $f$ select 1 $f$';
  select exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'private.x3_defacl_pfn()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_has;
  if v_has then
    raise exception 'FAIL E3: une fonction neuve de private naît encore exécutable par PUBLIC';
  end if;
  raise notice 'PASS E3: une fonction neuve de private naît sans EXECUTE PUBLIC';

  -- Même chose pour les objets créés par postgres (l''autre créateur durci).
  execute 'set local role postgres';
  execute 'create table public.x3_defacl_probe_pg (id int)';
  execute 'create function private.x3_defacl_pfn_pg() returns int language sql as $f$ select 1 $f$';
  execute 'reset role';
  if has_table_privilege('anon', 'public.x3_defacl_probe_pg', 'truncate') then
    raise exception 'FAIL E4: une table neuve créée par postgres naît encore avec TRUNCATE anon';
  end if;
  select exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = 'private.x3_defacl_pfn_pg()'::regprocedure
      and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ) into v_has;
  if v_has then
    raise exception 'FAIL E4b: une fonction private neuve créée par postgres naît PUBLIC-exécutable';
  end if;
  raise notice 'PASS E4: les défauts du créateur postgres sont durcis aussi';
end $e$;

do $$ begin raise notice 'VERIFY_X3: TOUTES LES ASSERTIONS PASSENT'; end $$;

rollback;
