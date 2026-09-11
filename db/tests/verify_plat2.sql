-- ============================================================================
-- PLAT-2 — la suite de permissions
-- ============================================================================
--
-- Pour chaque rôle et chaque geste : ce qui est autorisé passe, ce qui ne
-- l'est pas échoue — vérifié EN APPELANT LA RPC, jamais via l'interface.
-- C'est la leçon que X3 a payée deux fois : l'interface ne proposait rien de
-- tel, et les deux défauts étaient exploitables en appelant directement.
--
-- Modèle QA_DATA règle 1 : UNE seule transaction, terminée par ROLLBACK. Rien
-- n'est écrit. Peut donc tourner contre la production sans résidu.
--
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -q < db/tests/verify_plat2.sql
--
-- Chaque assertion affiche « ok — … » ou fait échouer la suite entière.

\set ON_ERROR_STOP on
\timing off
\o /dev/null

begin;

-- ============================================================================
-- FIXTURES
-- ============================================================================
-- Les chaînes d'avis et de posts passent par une dizaine de déclencheurs de
-- cohérence métier (rendez-vous terminé, relation client-professionnel
-- corroborée, média obligatoire…). Les reconstruire ligne à ligne n'apprend
-- rien sur les PERMISSIONS, qui sont le sujet de cette suite. Les fixtures
-- sont donc posées en `session_replication_role = replica` — le motif QA de
-- M1b — puis le mode est REMIS À 'origin' AVANT la première assertion, si
-- bien que tout ce que la suite mesure passe par les déclencheurs réels.
set local session_replication_role = replica;

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('9a200000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-founder@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Fondateur"}',  'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-admin@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Admin"}',      'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-support@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Support"}',    'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-moderator@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Moderateur"}', 'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-sales@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Commercial"}', 'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-intern@fadeup.test',    crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Stagiaire"}',  'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-outsider@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Dehors"}',     'authenticated', 'authenticated'),
  -- Deux patrons, un barber salarié, un client.
  ('9a200000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-patron-a@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Patron A"}',   'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-patron-b@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Patron B"}',   'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-barber@fadeup.test',    crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Barber"}',     'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-client@fadeup.test',    crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Client"}',     'authenticated', 'authenticated'),
  ('9a200000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'qa-plat2-v-claimant2@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V2 Revendiqueur 2"}', 'authenticated', 'authenticated');

insert into public.platform_members (user_id, role) values
  ('9a200000-0000-0000-0000-000000000001', 'platform_owner'),
  ('9a200000-0000-0000-0000-000000000002', 'platform_admin'),
  ('9a200000-0000-0000-0000-000000000003', 'platform_support'),
  ('9a200000-0000-0000-0000-000000000004', 'platform_moderator'),
  ('9a200000-0000-0000-0000-000000000005', 'platform_sales'),
  ('9a200000-0000-0000-0000-000000000006', 'platform_intern');

-- Deux zones ; le stagiaire n'en a qu'une.
insert into public.platform_zones (id, country, city, city_key, label) values
  ('9a2e0000-0000-0000-0000-000000000001', 'FR', 'Saint-Denis', 'saint-denis', 'Saint-Denis'),
  ('9a2e0000-0000-0000-0000-000000000002', 'FR', 'Marseille',   'marseille',   'Marseille');
insert into public.platform_member_zones (user_id, zone_id)
values ('9a200000-0000-0000-0000-000000000006', '9a2e0000-0000-0000-0000-000000000001');

-- ORG A : deux établissements (le cas multi-établissements), à Saint-Denis
-- donc DANS la zone du stagiaire. ORG B : un établissement à Lyon, hors zone.
insert into public.organizations (id, name, slug, business_type, currency, country_code) values
  ('9a20a000-0000-0000-0000-00000000000a', 'ZZ dead QA PLAT2 Salon A', 'zz-qa-plat2-a', 'barbershop', 'EUR', 'FR'),
  ('9a20a000-0000-0000-0000-00000000000b', 'ZZ dead QA PLAT2 Salon B', 'zz-qa-plat2-b', 'barbershop', 'EUR', 'FR');

insert into public.locations (id, organization_id, name, city, country, timezone, is_active) values
  ('9a20c000-0000-0000-0000-00000000000a', '9a20a000-0000-0000-0000-00000000000a', 'A — Centre', 'Saint-Denis', 'FR', 'Europe/Paris', true),
  ('9a20c000-0000-0000-0000-00000000000c', '9a20a000-0000-0000-0000-00000000000a', 'A — Gare',   'Saint-Denis', 'FR', 'Europe/Paris', true),
  ('9a20c000-0000-0000-0000-00000000000b', '9a20a000-0000-0000-0000-00000000000b', 'B — Lyon',   'Lyon',        'FR', 'Europe/Paris', true);

insert into public.memberships (organization_id, user_id, role) values
  ('9a20a000-0000-0000-0000-00000000000a', '9a200000-0000-0000-0000-000000000011', 'owner'),
  ('9a20a000-0000-0000-0000-00000000000b', '9a200000-0000-0000-0000-000000000012', 'owner'),
  -- Un barber SALARIÉ de A : il ne doit rien pouvoir attribuer.
  ('9a20a000-0000-0000-0000-00000000000a', '9a200000-0000-0000-0000-000000000013', 'barber');

insert into public.professionals (id, display_name, handle, claim_state, is_public, source, user_id, claimed_at) values
  ('9a20f000-0000-0000-0000-000000000001', 'ZZ QA PLAT2 Pro', 'zz.qa.plat2.pro', 'unclaimed', true, 'acquisition', null, null),
  ('9a20f000-0000-0000-0000-000000000002', 'ZZ QA PLAT2 Pro Employe', 'zz.qa.plat2.emp', 'claimed', true, 'fadeup', '9a200000-0000-0000-0000-000000000013', now());

insert into public.staff_profiles (id, organization_id, location_id, display_name, user_id) values
  ('9a20d000-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a', '9a20c000-0000-0000-0000-00000000000a', 'ZZ QA PLAT2 Staff', '9a200000-0000-0000-0000-000000000013');

insert into public.barbers (id, organization_id, staff_profile_id, professional_id) values
  ('9a20b000-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a', '9a20d000-0000-0000-0000-000000000001', '9a20f000-0000-0000-0000-000000000002');

insert into public.services (id, organization_id, name, duration_minutes, price_cents) values
  ('9a20e000-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a', 'ZZ QA PLAT2 Coupe', 30, 2500);

insert into public.appointments (id, organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status, booked_by_user_id, completed_at)
values ('9a209000-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a', '9a20c000-0000-0000-0000-00000000000a',
        '9a20b000-0000-0000-0000-000000000001', '9a20e000-0000-0000-0000-000000000001', 'V2 Client',
        now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'completed',
        '9a200000-0000-0000-0000-000000000014', now() - interval '3 days');

-- Un rendez-vous À VENIR, pour l'action « annuler » du support.
insert into public.appointments (id, organization_id, location_id, barber_id, service_id, customer_name, starts_at, ends_at, status, booked_by_user_id)
values ('9a209000-0000-0000-0000-000000000002', '9a20a000-0000-0000-0000-00000000000a', '9a20c000-0000-0000-0000-00000000000a',
        '9a20b000-0000-0000-0000-000000000001', '9a20e000-0000-0000-0000-000000000001', 'V2 Client',
        now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', 'confirmed',
        '9a200000-0000-0000-0000-000000000014');

insert into public.customer_professional_relationships
  (customer_user_id, professional_id, organization_id, completed_interaction_count, first_completed_at, last_completed_at)
values ('9a200000-0000-0000-0000-000000000014', '9a20f000-0000-0000-0000-000000000002',
        '9a20a000-0000-0000-0000-00000000000a', 1, now() - interval '3 days', now() - interval '3 days');

insert into public.reviews (id, appointment_id, customer_user_id, professional_id, organization_id, rating, comment, reviewer_display_name, status)
values ('9a20aa00-0000-0000-0000-000000000001', '9a209000-0000-0000-0000-000000000001',
        '9a200000-0000-0000-0000-000000000014', '9a20f000-0000-0000-0000-000000000002',
        '9a20a000-0000-0000-0000-00000000000a', 2, 'ZZ QA PLAT2 avis de test', 'V2 C.', 'published');

insert into public.review_reports (id, review_id, reporter_user_id, reason, detail, status)
values ('9a20ab00-0000-0000-0000-000000000001', '9a20aa00-0000-0000-0000-000000000001',
        '9a200000-0000-0000-0000-000000000013', 'abusive_content', 'ZZ QA PLAT2 signalement', 'open');

insert into public.posts (id, author_kind, organization_id, caption, visibility)
values ('9a20ac00-0000-0000-0000-000000000001', 'organization', '9a20a000-0000-0000-0000-00000000000a', 'ZZ QA PLAT2 post', 'public');
insert into public.post_media (post_id, storage_path, media_type)
values ('9a20ac00-0000-0000-0000-000000000001', 'zz-qa-plat2/1.jpg', 'image');

-- Une file d'attente, pour l'action « sortir quelqu'un ».
insert into public.queue_entries (id, organization_id, location_id, customer_name, status, booked_by_user_id)
values ('9a20ad00-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a',
        '9a20c000-0000-0000-0000-00000000000a', 'V2 Client', 'waiting', '9a200000-0000-0000-0000-000000000014');

-- Deux prospects : un dans la zone du stagiaire (et publié), un hors zone.
insert into public.prospects (id, type, canonical_name, country, status, origin) values
  ('9a20b100-0000-0000-0000-000000000001', 'barbershop', 'ZZ QA PLAT2 Prospect Zone',      'FR', 'discovered', 'worker'),
  ('9a20b100-0000-0000-0000-000000000002', 'barbershop', 'ZZ QA PLAT2 Prospect Hors Zone', 'FR', 'discovered', 'worker');
-- Un troisième, SAISI SUR LE TERRAIN : c'est lui qui prouve que le pipeline
-- distingue bien les deux origines de PLAT-1.
insert into public.prospects (id, type, canonical_name, country, status, origin, field_captured_by, field_captured_at, field_observation)
values ('9a20b100-0000-0000-0000-000000000003', 'barbershop', 'ZZ QA PLAT2 Prospect Terrain', 'FR', 'discovered', 'field',
        '9a200000-0000-0000-0000-000000000006', now() - interval '1 day', 'quatre fauteuils, caisse papier, affluence le samedi');
insert into public.prospect_locations (prospect_id, is_primary, city, country)
values ('9a20b100-0000-0000-0000-000000000003', true, 'Saint-Denis', 'FR');
insert into public.prospect_locations (prospect_id, is_primary, city, country, address_line, postal_code) values
  ('9a20b100-0000-0000-0000-000000000001', true, 'Saint-Denis', 'FR', '1 rue du Test', '93200'),
  ('9a20b100-0000-0000-0000-000000000002', true, 'Lyon',        'FR', '2 rue du Test', '69001');
insert into public.prospect_professionals (prospect_id, professional_id)
values ('9a20b100-0000-0000-0000-000000000001', '9a20f000-0000-0000-0000-000000000001');

-- Un quatrième prospect, PUBLIÉ ET NON REVENDIQUÉ, réservé au crochet de
-- revendication des affiches : le premier finit revendiqué par l'arbitrage de
-- la section E, et un test ne doit pas dépendre de l'ordre d'un autre.
insert into public.prospects (id, type, canonical_name, country, status, origin)
values ('9a20b100-0000-0000-0000-000000000004', 'barbershop', 'ZZ QA PLAT2 Prospect Affiche', 'FR', 'discovered', 'worker');
insert into public.prospect_locations (prospect_id, is_primary, city, country)
values ('9a20b100-0000-0000-0000-000000000004', true, 'Saint-Denis', 'FR');
insert into public.professionals (id, display_name, handle, claim_state, is_public, source)
values ('9a20f000-0000-0000-0000-000000000003', 'ZZ QA PLAT2 Pro Affiche', 'zz.qa.plat2.affiche', 'unclaimed', true, 'acquisition');
insert into public.prospect_professionals (prospect_id, professional_id)
values ('9a20b100-0000-0000-0000-000000000004', '9a20f000-0000-0000-0000-000000000003');

-- De la vraie mesure R3 pour ce prospect publié : deux vues de profil.
insert into public.analytics_events (event_name, actor_type, event_origin, professional_id, occurred_at)
values ('public_profile_viewed', 'anonymous', 'public_web', '9a20f000-0000-0000-0000-000000000001', now() - interval '2 days'),
       ('public_profile_viewed', 'anonymous', 'public_web', '9a20f000-0000-0000-0000-000000000001', now() - interval '1 day');

-- DEUX revendications CONCURRENTES sur le même profil : l'arbitrage.
insert into public.professional_claims (id, professional_id, claimant_user_id, state, evidence) values
  ('9a20ae00-0000-0000-0000-000000000001', '9a20f000-0000-0000-0000-000000000001', '9a200000-0000-0000-0000-000000000011', 'pending', 'ZZ QA PLAT2 preuve 1'),
  ('9a20ae00-0000-0000-0000-000000000002', '9a20f000-0000-0000-0000-000000000001', '9a200000-0000-0000-0000-000000000015', 'pending', 'ZZ QA PLAT2 preuve 2');

-- Une candidature en attente (onboarding).
insert into public.professional_applications (id, user_id, first_name, last_name, email, phone, business_name, professional_type, city, country, status)
values ('9a20af00-0000-0000-0000-000000000001', '9a200000-0000-0000-0000-000000000015', 'V2', 'Candidat',
        'qa-plat2-v-claimant2@fadeup.test', '+33600000000', 'ZZ QA PLAT2 Candidature', 'barbershop', 'Saint-Denis', 'FR', 'pending_review');

-- Une demande de retrait RGPD en cours, avec son échéance de 72 heures.
insert into public.marketplace_withdrawal_requests (id, professional_id, requested_via, requested_at, deadline_at, status)
values ('9a20b200-0000-0000-0000-000000000001', '9a20f000-0000-0000-0000-000000000001', 'email',
        now() - interval '60 hours', now() + interval '12 hours', 'pending');

-- Un e-mail transactionnel déjà parti, pour l'action « renvoyer ».
insert into public.email_outbox (id, to_email, template, locale, payload, stream, status, sent_at)
values ('9a20b300-0000-0000-0000-000000000001', 'qa-plat2-v-client@fadeup.test', 'booking_confirmed', 'fr', '{}', 'transactional', 'sent', now() - interval '1 hour');

-- Un client avec une note privée : le commercial ne doit jamais la lire.
insert into public.customers (id, organization_id, name, phone, notes, user_id)
values ('9a20b400-0000-0000-0000-000000000001', '9a20a000-0000-0000-0000-00000000000a', 'V2 Client', '+33600000001',
        'ZZ QA PLAT2 note privée', '9a200000-0000-0000-0000-000000000014');

set local session_replication_role = origin;

-- ============================================================ helpers
create or replace function pg_temp.be(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

create or replace function pg_temp.expect(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
    v_err := null;
  exception when others then
    v_err := sqlerrm;
  end;
  if p_expect = 'ok' and v_err is not null then
    raise exception 'ÉCHEC — % aurait dû passer, refusé : %', p_label, v_err;
  elsif p_expect = 'refus' and v_err is null then
    raise exception 'ÉCHEC — % aurait dû être refusé, passé', p_label;
  end if;
  raise notice 'ok — %  (%)', p_label, coalesce(left(v_err, 80), 'passé');
end $$;

create or replace function pg_temp.expect_count(p_label text, p_sql text, p_expected bigint) returns void language plpgsql as $$
declare v_n bigint;
begin
  execute p_sql into v_n;
  if v_n is distinct from p_expected then
    raise exception 'ÉCHEC — % : % au lieu de %', p_label, v_n, p_expected;
  end if;
  raise notice 'ok — %  (%)', p_label, v_n;
end $$;

create or replace function pg_temp.expect_text(p_label text, p_sql text, p_expected text) returns void language plpgsql as $$
declare v_t text;
begin
  execute p_sql into v_t;
  if v_t is distinct from p_expected then
    raise exception 'ÉCHEC — % : « % » au lieu de « % »', p_label, v_t, p_expected;
  end if;
  raise notice 'ok — %  (%)', p_label, coalesce(v_t, 'NULL');
end $$;

grant execute on function pg_temp.be(uuid) to authenticated;
grant execute on function pg_temp.as_anon() to authenticated;
grant execute on function pg_temp.expect(text, text, text) to authenticated;
grant execute on function pg_temp.expect_count(text, text, bigint) to authenticated;
grant execute on function pg_temp.expect_text(text, text, text) to authenticated;

set local role authenticated;

-- ============================================================================
-- A. LA GRILLE APRÈS PLAT-2
-- ============================================================================

select pg_temp.as_anon();
select pg_temp.expect_count('A1 anonyme : aucun droit interne',
  'select count(*) from public.get_my_platform_permissions()', 0);

select pg_temp.be('9a200000-0000-0000-0000-000000000007');
select pg_temp.expect_count('A2 compte hors plateforme : aucun droit',
  'select count(*) from public.get_my_platform_permissions()', 0);

-- LE COMPTE N'EST PAS FIGÉ, ET C'EST VOULU. Le catalogue grossit d'un lot à
-- l'autre — OS-2 y a ajouté `customer_notes.read` PENDANT ce lot. Une
-- assertion sur un nombre absolu aurait rougi pour une raison qui n'a rien à
-- voir avec PLAT-2. Ce qui est verrouillé ici est l'INVARIANT : le fondateur
-- porte tout SAUF le droit borné du stagiaire, et chaque rôle porte
-- exactement les droits NOMMÉS de ce lot.
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect_count('A3 le fondateur porte tout le catalogue SAUF crm.zone_read',
  'select count(*) from public.get_my_platform_permissions()',
  (select count(*) - 1 from public.platform_permissions));
select pg_temp.expect_count('A3bis dont les SEPT droits neufs de PLAT-2',
  $$select count(*) from public.get_my_platform_permissions() k
     where k in ('support.tickets','support.dossier','queue.remove','email.resend',
                 'moderation.revert','poster.assign','poster.manage')$$, 7);

select pg_temp.be('9a200000-0000-0000-0000-000000000006');
select pg_temp.expect_text('A4 le stagiaire porte EXACTEMENT trois droits, nommés',
  $$select string_agg(k, ',' order by k) from public.get_my_platform_permissions() k$$,
  'crm.field_capture,crm.zone_read,poster.assign');

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect_count('A5 le support porte les quatre droits de traitement d''appel',
  $$select count(*) from public.get_my_platform_permissions() k
     where k in ('support.tickets','support.dossier','queue.remove','email.resend')$$, 4);
select pg_temp.expect_count('A6 et AUCUN droit d''affiche ni d''annulation de modération',
  $$select count(*) from public.get_my_platform_permissions() k
     where k in ('poster.assign','poster.manage','moderation.revert')$$, 0);
select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect_count('A7 le commercial n''a aucun droit de support ni de modération',
  $$select count(*) from public.get_my_platform_permissions() k
     where k in ('support.tickets','support.dossier','queue.remove','email.resend',
                 'moderation.content','moderation.revert')$$, 0);

-- ============================================================================
-- B. SUPPORT — LA FILE DE TICKETS
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect('B1 le support ouvre un ticket',
  $$select public.open_support_ticket('phone', 'ZZ QA PLAT2 appel', 'le client ne trouve pas sa réservation')$$, 'ok');

select pg_temp.expect_count('B2 et il le voit dans sa file',
  $$select count(*) from public.list_support_tickets() where subject = 'ZZ QA PLAT2 appel'$$, 1);

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('B3 le commercial n''ouvre pas de ticket',
  $$select public.open_support_ticket('phone', 'ZZ QA PLAT2 interdit')$$, 'refus');
select pg_temp.expect_count('B4 et sa file est vide',
  'select count(*) from public.list_support_tickets()', 0);

select pg_temp.be('9a200000-0000-0000-0000-000000000004');
select pg_temp.expect_count('B5 le modérateur non plus',
  'select count(*) from public.list_support_tickets()', 0);

select pg_temp.be('9a200000-0000-0000-0000-000000000006');
select pg_temp.expect('B6 le stagiaire non plus',
  $$select public.open_support_ticket('phone', 'ZZ QA PLAT2 interdit')$$, 'refus');

select pg_temp.as_anon();
select pg_temp.expect('B7 un anonyme non plus',
  $$select public.open_support_ticket('phone', 'ZZ QA PLAT2 interdit')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect('B8 une origine NON BRANCHÉE est refusée, pas simulée',
  $$select public.open_support_ticket('inbound_email', 'ZZ QA PLAT2 mail')$$, 'refus');
select pg_temp.expect('B9 un ticket RGPD sans sa demande est refusé',
  $$select public.open_support_ticket('gdpr_withdrawal', 'ZZ QA PLAT2 retrait')$$, 'refus');

-- L'ÉCHÉANCE VIENT DE LA DEMANDE, pas d'un calcul local.
select pg_temp.expect('B10 un ticket RGPD s''ouvre sur sa demande',
  $$select public.open_support_ticket('gdpr_withdrawal', 'ZZ QA PLAT2 retrait', null, null, null, null, null, null, '9a20b200-0000-0000-0000-000000000001')$$, 'ok');
-- L'échéance est RECOPIÉE de la demande (fixture : now() + 12 h), pas
-- recalculée à 72 h depuis l'ouverture du ticket. La vérification se fait
-- sans jointure : le support ne lit pas `marketplace_withdrawal_requests`
-- par la table, seulement par `list_marketplace_withdrawal_requests`.
select pg_temp.expect_count('B11 et il porte l''échéance de la demande, pas 72 h depuis maintenant',
  $$select count(*) from public.support_tickets t
     where t.origin = 'gdpr_withdrawal'
       and t.due_at between now() + interval '11 hours' and now() + interval '13 hours'$$, 1);
select pg_temp.expect_count('B12 et l''échéance qui défile est calculée, pas inventée',
  $$select count(*) from public.list_support_tickets()
     where withdrawal_request_id is not null and hours_remaining between 11 and 13$$, 1);

select pg_temp.expect('B13 une résolution sans son mot est refusée',
  $$select public.set_support_ticket_status(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 appel'), 'resolved')$$, 'refus');
select pg_temp.expect('B14 avec son mot, elle passe',
  $$select public.set_support_ticket_status(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 appel'), 'resolved', 'réservation retrouvée')$$, 'ok');

select pg_temp.expect('B15 on n''assigne pas un ticket à qui ne traite pas',
  $$select public.assign_support_ticket(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 retrait'),
      '9a200000-0000-0000-0000-000000000005')$$, 'refus');
select pg_temp.expect('B16 on l''assigne à un support',
  $$select public.assign_support_ticket(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 retrait'),
      '9a200000-0000-0000-0000-000000000003')$$, 'ok');

select pg_temp.expect('B17 un genre de message réservé au système est refusé',
  $$select public.add_support_ticket_message(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 retrait'), 'faux', 'status_change')$$, 'refus');
select pg_temp.expect('B18a ouvrir le ticket rend la fiche complète',
  $$select public.get_support_ticket((select id from public.support_tickets where subject = 'ZZ QA PLAT2 retrait'))$$, 'ok');
select pg_temp.expect('B18 une note libre passe',
  $$select public.add_support_ticket_message(
      (select id from public.support_tickets where subject = 'ZZ QA PLAT2 retrait'), 'rappelé, boîte vocale')$$, 'ok');

reset role;
select pg_temp.expect('B19 l''historique est en AJOUT SEUL, même au plus haut privilège',
  $$update public.support_ticket_messages set body = 'réécrit'$$, 'refus');
select pg_temp.expect('B20 et non supprimable',
  $$delete from public.support_ticket_messages$$, 'refus');
select pg_temp.expect('B21 ni tronçable',
  $$truncate public.support_ticket_messages$$, 'refus');
set local role authenticated;

-- ============================================================================
-- C. SUPPORT — LES DOSSIERS, ET LEUR TRACE
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect('C1 le support lit un dossier client',
  $$select public.get_platform_customer_dossier('9a200000-0000-0000-0000-000000000014')$$, 'ok');
select pg_temp.expect('C2 un dossier professionnel',
  $$select public.get_platform_professional_dossier('9a20f000-0000-0000-0000-000000000001')$$, 'ok');
select pg_temp.expect('C3 un dossier d''organisation',
  $$select public.get_platform_organization_dossier('9a20a000-0000-0000-0000-00000000000a')$$, 'ok');

-- CHAQUE CONSULTATION EST TRACÉE : trois lectures, trois lignes.
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect_count('C4 les trois consultations sont au journal',
  $$select count(*) from public.platform_audit_log
     where action = 'support_dossier_viewed'
       and actor_user_id = '9a200000-0000-0000-0000-000000000003'$$, 3);

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('C5 le commercial ne lit aucun dossier',
  $$select public.get_platform_customer_dossier('9a200000-0000-0000-0000-000000000014')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000006');
select pg_temp.expect('C6 le stagiaire non plus',
  $$select public.get_platform_organization_dossier('9a20a000-0000-0000-0000-00000000000a')$$, 'refus');
select pg_temp.as_anon();
select pg_temp.expect('C7 un anonyme non plus',
  $$select public.get_platform_professional_dossier('9a20f000-0000-0000-0000-000000000001')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect('C8 un dossier sans identifiant est refusé, pas vide',
  $$select public.get_platform_customer_dossier(null)$$, 'refus');

-- ============================================================================
-- D. SUPPORT — PAS DE CRM, PAS DE FACTURATION, PAS DE MODÉRATION
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect_count('D1 le support ne voit aucun prospect',
  $$select count(*) from public.prospects$$, 0);
select pg_temp.expect_count('D2 ni le pipeline commercial',
  $$select count(*) from public.get_sales_pipeline_summary()$$, 0);
select pg_temp.expect('D3 ni les statistiques d''un prospect',
  $$select public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000001')$$, 'refus');
select pg_temp.expect('D4 il ne modère pas un avis',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'removed', 'abusive_content')$$, 'refus');
select pg_temp.expect_count('D5 ni ne voit la file de modération',
  $$select count(*) from public.list_moderation_reviews()$$, 0);
select pg_temp.expect('D6 il ne touche pas au paiement',
  $$select public.assign_commercial_plan('9a20a000-0000-0000-0000-00000000000a', 'solo', 'active', 'test')$$, 'refus');
select pg_temp.expect_count('D7 ni ne voit la file des candidatures (onboarding n''est pas à lui)',
  $$select count(*) from public.list_professional_applications_queue()$$, 0);

-- LES DEUX ACTIONS DE PREMIER NIVEAU, elles, passent.
select pg_temp.expect('D8 il annule un rendez-vous, avec motif',
  $$select public.cancel_appointment_as_platform('9a209000-0000-0000-0000-000000000002', 'demande du client au téléphone')$$, 'ok');
select pg_temp.expect('D9 il sort quelqu''un d''une file, avec motif',
  $$select public.remove_queue_entry_as_platform('9a20ad00-0000-0000-0000-000000000001', 'le client a appelé pour annuler')$$, 'ok');
select pg_temp.expect('D10 une sortie de file sans motif est refusée',
  $$select public.remove_queue_entry_as_platform('9a20ad00-0000-0000-0000-000000000001', '  ')$$, 'refus');
select pg_temp.expect('D11 il renvoie un e-mail transactionnel',
  $$select public.resend_platform_email('9a20b300-0000-0000-0000-000000000001', 'le client ne l''a pas reçu')$$, 'ok');

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('D12 le commercial ne sort personne d''une file',
  $$select public.remove_queue_entry_as_platform('9a20ad00-0000-0000-0000-000000000001', 'essai')$$, 'refus');
select pg_temp.expect('D13 ni ne renvoie d''e-mail',
  $$select public.resend_platform_email('9a20b300-0000-0000-0000-000000000001', 'essai')$$, 'refus');

-- ============================================================================
-- E. MODÉRATION
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000004');
select pg_temp.expect('E1 masquer un avis SANS MOTIF est refusé',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'removed')$$, 'refus');
select pg_temp.expect('E2 « la note est mauvaise » n''est pas un motif représentable',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'removed', 'mauvaise note')$$, 'refus');
select pg_temp.expect('E3 avec un motif du vocabulaire, le masquage passe',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'removed', 'abusive_content')$$, 'ok');
select pg_temp.expect('E4 LE MODÉRATEUR MASQUE, IL NE DÉFAIT PAS',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'published')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000002');
select pg_temp.expect('E5 UN ADMINISTRATEUR, LUI, ANNULE',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'published')$$, 'ok');
select pg_temp.expect_count('E6 et l''avis est bien revenu en ligne, sans motif résiduel',
  $$select count(*) from public.reviews
     where id = '9a20aa00-0000-0000-0000-000000000001'
       and status = 'published' and moderation_reason is null and moderated_at is null$$, 1);

select pg_temp.be('9a200000-0000-0000-0000-000000000004');
select pg_temp.expect('E7 masquer un post sans motif est refusé',
  $$select public.moderate_post('9a20ac00-0000-0000-0000-000000000001', 'hidden')$$, 'refus');
select pg_temp.expect('E8 avec motif, il passe',
  $$select public.moderate_post('9a20ac00-0000-0000-0000-000000000001', 'hidden', 'personal_data')$$, 'ok');
-- Lu par la RPC de modération, PAS par la table : `posts_select_visible`
-- n'expose un post masqué à personne, modérateur compris. C'est voulu — la
-- file de modération est une surface gardée, pas un élargissement de policy.
select pg_temp.expect_count('E9 et le post porte QUI, QUAND et POURQUOI',
  $$select count(*) from public.list_moderation_posts('hidden')
     where id = '9a20ac00-0000-0000-0000-000000000001'
       and hidden_at is not null
       and hidden_by_email = 'qa-plat2-v-moderator@fadeup.test'
       and hidden_reason = 'personal_data'$$, 1);
select pg_temp.expect('E10 le modérateur ne le remet pas en ligne',
  $$select public.moderate_post('9a20ac00-0000-0000-0000-000000000001', 'public')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000002');
select pg_temp.expect('E11 l''admin le remet en ligne',
  $$select public.moderate_post('9a20ac00-0000-0000-0000-000000000001', 'public')$$, 'ok');
select pg_temp.expect_count('E12 et le tampon de modération est effacé avec lui',
  $$select count(*) from public.list_moderation_posts('public')
     where id = '9a20ac00-0000-0000-0000-000000000001' and hidden_at is null and hidden_reason is null$$, 1);

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('E13 le commercial ne modère pas',
  $$select public.moderate_review('9a20aa00-0000-0000-0000-000000000001', 'removed', 'fraud')$$, 'refus');
select pg_temp.expect_count('E14 ni ne voit les files de modération',
  $$select count(*) from public.list_moderation_posts()$$, 0);
select pg_temp.expect_count('E15 ni les signalements',
  $$select count(*) from public.list_moderation_review_reports()$$, 0);

select pg_temp.be('9a200000-0000-0000-0000-000000000004');
select pg_temp.expect_count('E16 LE MODÉRATEUR N''A PAS DE CRM : aucun prospect',
  $$select count(*) from public.prospects$$, 0);
select pg_temp.expect_count('E17 ni de pipeline',
  $$select count(*) from public.get_sales_pipeline_summary()$$, 0);
select pg_temp.expect_count('E18 ni de campagne',
  $$select count(*) from public.outreach_campaigns$$, 0);

-- LES DEUX FILES QUE PERSONNE NE VOYAIT AVANT CE LOT.
select pg_temp.expect_count('E19 le modérateur VOIT la file des candidatures',
  $$select count(*) from public.list_professional_applications_queue() where business_name = 'ZZ QA PLAT2 Candidature'$$, 1);
select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect_count('E20 le commercial aussi — onboarding.review est partagé',
  $$select count(*) from public.list_professional_applications_queue() where business_name = 'ZZ QA PLAT2 Candidature'$$, 1);

-- L'ARBITRAGE DES REVENDICATIONS CONCURRENTES.
select pg_temp.be('9a200000-0000-0000-0000-000000000004');
select pg_temp.expect_count('E21 les deux revendications rivales sont visibles',
  $$select count(*) from public.list_professional_claims_queue()
     where professional_id = '9a20f000-0000-0000-0000-000000000001'$$, 2);
select pg_temp.expect_count('E22 et chacune annonce sa rivale',
  $$select count(*) from public.list_professional_claims_queue()
     where professional_id = '9a20f000-0000-0000-0000-000000000001' and competing_pending = 1$$, 2);
select pg_temp.expect('E23 trancher pour l''une ferme l''autre',
  $$select public.review_professional_claim('9a20ae00-0000-0000-0000-000000000001', 'approve', 'preuve la plus forte')$$, 'ok');
select pg_temp.expect_count('E24 la rivale est refusée, pas laissée en attente',
  $$select count(*) from public.list_professional_claims_queue(true)
     where id = '9a20ae00-0000-0000-0000-000000000002' and state = 'rejected'$$, 1);

select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect_count('E25 le support ne voit pas les revendications',
  $$select count(*) from public.list_professional_claims_queue()$$, 0);

-- ============================================================================
-- F. COMMERCIAL
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect_count('F1 le commercial voit le pipeline, ORIGINE PAR ORIGINE',
  $$select count(*) from public.get_sales_pipeline_summary() where origin is not null$$,
  (select count(*) from (select distinct status, origin from public.prospects) s));
select pg_temp.expect_count('F2 et les DEUX origines y sont distinguées',
  $$select count(distinct origin) from public.get_sales_pipeline_summary()$$,
  (select count(distinct origin) from public.prospects));

select pg_temp.expect_text('F3 il lit les statistiques RÉELLES du prospect publié',
  $$select (public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000001') ->> 'profile_views_all_time')$$, '2');
select pg_temp.expect_text('F4 et le drapeau qui explique les zéros',
  $$select (public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000001') ->> 'is_published')$$, 'true');
select pg_temp.expect_text('F5 un prospect NON publié rend des zéros, jamais une estimation',
  $$select (public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000002') ->> 'profile_views_all_time')$$, '0');
select pg_temp.expect_text('F6 et le dit honnêtement',
  $$select (public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000002') ->> 'is_published')$$, 'false');

select pg_temp.expect('F7 il voit l''état des relances de B2',
  $$select public.get_prospect_outreach_state('9a20b100-0000-0000-0000-000000000001')$$, 'ok');

-- PAS D'ACCÈS AUX NOTES CLIENTS PRIVÉES — OS-2 le pose, PLAT-2 le respecte.
select pg_temp.expect_count('F8 LE COMMERCIAL NE LIT AUCUNE NOTE CLIENT PRIVÉE',
  $$select count(*) from public.customers$$, 0);
select pg_temp.expect_count('F9 le support non plus (aucune surface de ce lot ne les rend)',
  $$select count(*) from public.customers where notes is not null$$, 0);

select pg_temp.be('9a200000-0000-0000-0000-000000000006');
select pg_temp.expect('F10 le stagiaire lit les statistiques d''un prospect DE SA ZONE',
  $$select public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000001')$$, 'ok');
select pg_temp.expect('F11 mais PAS celles d''un prospect hors de sa zone',
  $$select public.get_prospect_acquisition_stats('9a20b100-0000-0000-0000-000000000002')$$, 'refus');
select pg_temp.expect_count('F12 et il n''a aucune vue d''ensemble du pipeline',
  $$select count(*) from public.get_sales_pipeline_summary()$$, 0);
select pg_temp.expect('F13 LE STAGIAIRE NE PUBLIE PAS SUR LA MARKETPLACE',
  $$select public.publish_external_professional('9a20b100-0000-0000-0000-000000000001')$$, 'refus');

-- ============================================================================
-- G. LES AFFICHES QR
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('G1 le commercial ne génère pas de lot',
  $$select public.generate_poster_batch(3, 'ZZ QA PLAT2 interdit')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000003');
select pg_temp.expect('G2 le support non plus',
  $$select public.generate_poster_batch(3, 'ZZ QA PLAT2 interdit')$$, 'refus');
select pg_temp.as_anon();
select pg_temp.expect('G3 un anonyme non plus',
  $$select public.generate_poster_batch(3, 'ZZ QA PLAT2 interdit')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect('G4 le fondateur génère un lot de six',
  $$select public.generate_poster_batch(6, 'ZZ QA PLAT2 lot')$$, 'ok');
select pg_temp.expect_count('G5 six codes, tous distincts',
  $$select count(distinct code) from public.posters$$, 6);
select pg_temp.expect_count('G6 tous NON DEVINABLES : dix symboles base32 sans I, L, O ni U',
  $$select count(*) from public.posters where code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'$$, 6);
select pg_temp.expect_count('G7 tous LIBRES, aucun rattaché à quoi que ce soit',
  $$select count(*) from public.posters where state = 'free' and organization_id is null$$, 6);
select pg_temp.expect_count('G8 le journal des lots dit quand, combien, et où ils en sont',
  $$select count(*) from public.list_poster_batches() where label = 'ZZ QA PLAT2 lot' and code_count = 6 and free_count = 6$$, 1);

-- LES CODES SONT HORS TABLE POUR LA SUITE. Un patron ne LIT PAS une affiche
-- libre : la policy `posters_select` ne lui montre que celles attribuées à
-- SON organisation. Dans la vraie vie il tient le code dans la main — c'est
-- l'affiche imprimée. Ici, on le recopie une fois, en tant que fondateur.
create temp table qa_plat2_codes as
  select code, row_number() over (order by code) as rn from public.posters;

-- ---- le patron ------------------------------------------------------------
select pg_temp.be('9a200000-0000-0000-0000-000000000011');
select pg_temp.expect_count('G9 UN PATRON MULTI-ÉTABLISSEMENTS voit SES DEUX établissements, et eux seuls',
  $$select count(*) from public.list_my_poster_locations()$$, 2);
select pg_temp.expect_count('G9b et il ne LIT aucune affiche libre : elles ne sont pas à lui',
  $$select count(*) from public.posters$$, 0);
select pg_temp.expect('G10 il attribue une affiche à l''un des siens',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 1), '9a20c000-0000-0000-0000-00000000000a')$$, 'ok');
select pg_temp.expect_count('G10b et il la voit désormais, attribuée chez lui',
  $$select count(*) from public.posters where state = 'assigned'
     and organization_id = '9a20a000-0000-0000-0000-00000000000a'$$, 1);
select pg_temp.expect('G11 IL NE PEUT PAS ATTRIBUER À UN SALON QUI N''EST PAS LE SIEN',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 2), '9a20c000-0000-0000-0000-00000000000b')$$, 'refus');
select pg_temp.expect('G12 UNE AFFICHE ATTRIBUÉE N''EST PAS DÉTOURNABLE, même par celui qui l''a posée',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 1), '9a20c000-0000-0000-0000-00000000000c')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000012');
select pg_temp.expect('G13 ni par un autre patron',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 1), '9a20c000-0000-0000-0000-00000000000b')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000013');
select pg_temp.expect_count('G14 UN BARBER SALARIÉ n''a aucun établissement à recevoir',
  $$select count(*) from public.list_my_poster_locations()$$, 0);
select pg_temp.expect('G15 et il n''attribue rien',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 2), '9a20c000-0000-0000-0000-00000000000a')$$, 'refus');

select pg_temp.be('9a200000-0000-0000-0000-000000000014');
select pg_temp.expect('G16 UN CLIENT non plus',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 2), '9a20c000-0000-0000-0000-00000000000a')$$, 'refus');

-- ---- le stagiaire et sa zone ---------------------------------------------
select pg_temp.be('9a200000-0000-0000-0000-000000000006');
select pg_temp.expect_count('G17 LE STAGIAIRE NE VOIT QUE LES ÉTABLISSEMENTS DE SA ZONE',
  $$select count(*) from public.list_my_poster_locations()$$, 2);
select pg_temp.expect_count('G18 et aucun hors zone',
  $$select count(*) from public.list_my_poster_locations() where city <> 'Saint-Denis'$$, 0);
select pg_temp.expect('G19 il attribue dans sa zone',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 2), '9a20c000-0000-0000-0000-00000000000c')$$, 'ok');
select pg_temp.expect('G20 IL NE PEUT PAS ATTRIBUER HORS DE SA ZONE',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 3), '9a20c000-0000-0000-0000-00000000000b')$$, 'refus');

-- ---- la révocation --------------------------------------------------------
select pg_temp.be('9a200000-0000-0000-0000-000000000011');
select pg_temp.expect('G21 UN PATRON NE RÉVOQUE PAS',
  $$select public.revoke_poster((select code from qa_plat2_codes where rn = 1), 'je veux la reprendre')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000005');
select pg_temp.expect('G22 un commercial non plus',
  $$select public.revoke_poster((select code from qa_plat2_codes where rn = 1), 'essai')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect('G23 une révocation sans motif est refusée',
  $$select public.revoke_poster((select code from qa_plat2_codes where rn = 1), '  ')$$, 'refus');
select pg_temp.expect('G24 SEUL UN INTERNE RÉVOQUE, avec son motif',
  $$select public.revoke_poster((select code from qa_plat2_codes where rn = 1), 'affiche décollée, salon fermé')$$, 'ok');

select pg_temp.be('9a200000-0000-0000-0000-000000000011');
select pg_temp.expect('G25 un patron ne récupère pas une affiche révoquée',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 1), '9a20c000-0000-0000-0000-00000000000a')$$, 'refus');
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect('G26 UN INTERNE, LUI, RÉATTRIBUE',
  $$select public.assign_poster((select code from qa_plat2_codes where rn = 1), '9a20c000-0000-0000-0000-00000000000a')$$, 'ok');

-- ---- le scan --------------------------------------------------------------
select pg_temp.as_anon();
select pg_temp.expect_text('G27 SCAN, code libre, par un CLIENT : pas encore active',
  $$select (public.resolve_poster_code((select code from qa_plat2_codes where rn = 3)) ->> 'state')$$, 'free');
select pg_temp.expect_text('G28 et AUCUNE proposition d''attribution',
  $$select (public.resolve_poster_code((select code from qa_plat2_codes where rn = 3)) ->> 'can_assign')$$, 'false');
select pg_temp.expect_text('G29 SCAN, code attribué : la file du salon',
  $$select (public.resolve_poster_code((select code from qa_plat2_codes where rn = 1)) ->> 'organization_slug')$$, 'zz-qa-plat2-a');
select pg_temp.expect_text('G30 SCAN, code inconnu : rien de plus qu''« inconnu »',
  $$select (public.resolve_poster_code('ZZZZZZZZZZ') ->> 'state')$$, 'unknown');
select pg_temp.expect_text('G31 SCAN, code mal formé : la table n''est même pas touchée',
  $$select (public.resolve_poster_code('pas-un-code') ->> 'state')$$, 'unknown');

select pg_temp.be('9a200000-0000-0000-0000-000000000011');
select pg_temp.expect_text('G32 SCAN, code libre, par LE PATRON : proposition d''attribution',
  $$select (public.resolve_poster_code((select code from qa_plat2_codes where rn = 3)) ->> 'can_assign')$$, 'true');
select pg_temp.expect_count('G33 et le choix explicite entre SES DEUX établissements',
  $$select jsonb_array_length(public.resolve_poster_code((select code from qa_plat2_codes where rn = 3)) -> 'assignable_locations')$$, 2);

select pg_temp.be('9a200000-0000-0000-0000-000000000014');
select pg_temp.expect_text('G34 un CLIENT connecté ne reçoit aucune proposition',
  $$select (public.resolve_poster_code((select code from qa_plat2_codes where rn = 3)) ->> 'can_assign')$$, 'false');

-- ---- la lettre ------------------------------------------------------------
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect('G35 la lettre se prépare pour un prospect, sur une affiche LIBRE',
  $$select public.prepare_poster_letter((select code from qa_plat2_codes where rn = 3), '9a20b100-0000-0000-0000-000000000001')$$, 'ok');
select pg_temp.expect('G36 jamais sur une affiche déjà attribuée',
  $$select public.prepare_poster_letter((select code from qa_plat2_codes where rn = 1), '9a20b100-0000-0000-0000-000000000001')$$, 'refus');
select pg_temp.expect_text('G37 elle porte le nom du salon',
  $$select (public.prepare_poster_letter((select code from qa_plat2_codes where rn = 3), '9a20b100-0000-0000-0000-000000000001') ->> 'business_name')$$,
  'ZZ QA PLAT2 Prospect Zone');
select pg_temp.expect_text('G38 et UN ÉLÉMENT DE PREUVE tiré de l''analytics réelle',
  $$select ((public.prepare_poster_letter((select code from qa_plat2_codes where rn = 3), '9a20b100-0000-0000-0000-000000000001') -> 'proof') ->> 'profile_views_all_time')$$, '2');

-- Un prospect SANS mesure ne reçoit PAS de preuve inventée.
select pg_temp.expect_text('G39 un prospect sans mesure part SANS élément de preuve',
  $$select jsonb_typeof(public.prepare_poster_letter((select code from qa_plat2_codes where rn = 4), '9a20b100-0000-0000-0000-000000000002') -> 'proof')$$, 'null');

-- ---- le crochet de revendication -----------------------------------------
-- La fiche du prospect de la zone est PUBLIQUE et NON REVENDIQUÉE : l'affiche
-- destinée à ce salon devient un chemin vers la revendication.
select pg_temp.as_anon();
select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect('G40a une lettre part vers un salon publié mais NON REVENDIQUÉ',
  $$select public.prepare_poster_letter((select code from qa_plat2_codes where rn = 5), '9a20b100-0000-0000-0000-000000000004')$$, 'ok');
select pg_temp.as_anon();
select pg_temp.expect_text('G40 SCAN de ce code : chemin vers la revendication',
  $$select ((public.resolve_poster_code((select code from qa_plat2_codes where rn = 5)) -> 'claim') ->> 'professional_handle')$$,
  'zz.qa.plat2.affiche');
select pg_temp.expect_text('G41 un code sans destinataire postal n''invente aucun crochet',
  $$select jsonb_typeof(public.resolve_poster_code((select code from qa_plat2_codes where rn = 6)) -> 'claim')$$, 'null');

-- ============================================================================
-- H. CHAQUE ACTION EST RÉELLEMENT TRACÉE
-- ============================================================================

select pg_temp.be('9a200000-0000-0000-0000-000000000001');
select pg_temp.expect_count('H1 les treize familles d''action de PLAT-2 ont écrit au journal',
  $$select count(distinct action) from public.platform_audit_log where action in (
      'support_ticket_opened', 'support_ticket_viewed', 'support_ticket_assigned',
      'support_ticket_status_changed', 'support_dossier_viewed',
      'queue_entry_removed_by_platform', 'platform_email_resent',
      'review_moderated', 'post_moderated',
      'poster_batch_generated', 'poster_assigned', 'poster_revoked', 'poster_letter_prepared')$$, 13);

reset role;
select pg_temp.expect('H2 et ce journal reste en AJOUT SEUL, même au plus haut privilège',
  $$update public.platform_audit_log set action = 'réécrit' where action = 'poster_assigned'$$, 'refus');

do $$ begin raise notice '========== PLAT-2 : suite de permissions VERTE =========='; end $$;

rollback;
