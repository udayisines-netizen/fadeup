-- ============================================================================
-- PLAT-3 — la suite de permissions
-- ============================================================================
--
-- Défauts plateforme, promotions, tunnel d'acquisition, pilotage du worker.
-- Pour chaque rôle et chaque geste : ce qui est autorisé passe, ce qui ne
-- l'est pas échoue — vérifié EN APPELANT LA RPC, jamais via l'interface.
--
-- Modèle QA_DATA règle 1 : UNE seule transaction terminée par ROLLBACK. Rien
-- n'est écrit, donc la suite peut tourner contre la production sans résidu.
-- Conséquence utile : `net.http_post` met sa requête en file DANS la
-- transaction, si bien qu'aucun appel Stripe ne part d'ici.
--
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -q < db/tests/verify_plat3.sql

\set ON_ERROR_STOP on
\timing off
\o /dev/null

begin;

set local session_replication_role = replica;

insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('9a300000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-founder@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Fondateur"}',  'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-admin@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Admin"}',      'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-support@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Support"}',    'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-moderator@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Moderateur"}', 'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-sales@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Commercial"}', 'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-intern@fadeup.test',    crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Stagiaire"}',  'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-outsider@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Dehors"}',     'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-patron-a@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Patron A"}',   'authenticated', 'authenticated'),
  ('9a300000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'qa-plat3-v-patron-b@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V3 Patron B"}',   'authenticated', 'authenticated');

insert into public.platform_members (user_id, role) values
  ('9a300000-0000-0000-0000-000000000001', 'platform_owner'),
  ('9a300000-0000-0000-0000-000000000002', 'platform_admin'),
  ('9a300000-0000-0000-0000-000000000003', 'platform_support'),
  ('9a300000-0000-0000-0000-000000000004', 'platform_moderator'),
  ('9a300000-0000-0000-0000-000000000005', 'platform_sales'),
  ('9a300000-0000-0000-0000-000000000006', 'platform_intern');

insert into public.organizations (id, name, slug, business_type, currency, country_code) values
  ('9a30a000-0000-0000-0000-00000000000a', 'ZZ dead QA PLAT3 Salon A', 'zz-qa-plat3-a', 'barbershop', 'EUR', 'FR'),
  ('9a30a000-0000-0000-0000-00000000000b', 'ZZ dead QA PLAT3 Salon B', 'zz-qa-plat3-b', 'barbershop', 'EUR', 'FR');

insert into public.locations (id, organization_id, name, city, country, timezone, is_active) values
  ('9a30c000-0000-0000-0000-00000000000a', '9a30a000-0000-0000-0000-00000000000a', 'A — Centre', 'Saint-Denis', 'FR', 'Europe/Paris', true),
  ('9a30c000-0000-0000-0000-00000000000b', '9a30a000-0000-0000-0000-00000000000b', 'B — Lyon',   'Lyon',        'FR', 'Europe/Paris', true);

insert into public.memberships (organization_id, user_id, role) values
  ('9a30a000-0000-0000-0000-00000000000a', '9a300000-0000-0000-0000-000000000011', 'owner'),
  ('9a30a000-0000-0000-0000-00000000000b', '9a300000-0000-0000-0000-000000000012', 'owner');

insert into public.location_service_settings (location_id, organization_id) values
  ('9a30c000-0000-0000-0000-00000000000a', '9a30a000-0000-0000-0000-00000000000a'),
  ('9a30c000-0000-0000-0000-00000000000b', '9a30a000-0000-0000-0000-00000000000b');

-- Une promotion DÉJÀ confirmée chez Stripe, pour exercer le chemin
-- d'application sans dépendre d'un aller-retour HTTP. Et une NON confirmée,
-- pour prouver qu'elle est refusée.
insert into public.promotions (id, code, kind, percent_off, duration, duration_in_months, stripe_coupon_id, stripe_confirmed_at, created_by)
values ('9a30d000-0000-0000-0000-000000000001', 'QAPLAT3A', 'percent', 15.00, 'repeating', 2,
        'fadeup_promo_qaplat3a', now(), '9a300000-0000-0000-0000-000000000001');
insert into public.promotions (id, code, kind, percent_off, duration, duration_in_months, stripe_coupon_id, created_by)
values ('9a30d000-0000-0000-0000-000000000002', 'QAPLAT3B', 'percent', 90.00, 'repeating', 12,
        'fadeup_promo_qaplat3b', '9a300000-0000-0000-0000-000000000001');
-- Une troisième, confirmée MAIS ÉCHUE.
insert into public.promotions (id, code, kind, percent_off, duration, starts_at, ends_at, stripe_coupon_id, stripe_confirmed_at, created_by)
values ('9a30d000-0000-0000-0000-000000000003', 'QAPLAT3C', 'percent', 10.00, 'once',
        now() - interval '30 days', now() - interval '1 day',
        'fadeup_promo_qaplat3c', now(), '9a300000-0000-0000-0000-000000000001');
-- Une quatrième, confirmée, dans les bornes du commercial, réservée au
-- non-cumul (le salon A en aura déjà une).
insert into public.promotions (id, code, kind, percent_off, duration, stripe_coupon_id, stripe_confirmed_at, created_by)
values ('9a30d000-0000-0000-0000-000000000004', 'QAPLAT3D', 'percent', 5.00, 'once',
        'fadeup_promo_qaplat3d', now(), '9a300000-0000-0000-0000-000000000001');

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
  raise notice 'ok — %  (%)', p_label, coalesce(left(v_err, 90), 'passé');
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
-- A. LA GRILLE APRÈS PLAT-3
-- ============================================================================

select pg_temp.as_anon();
select pg_temp.expect_count('A1 anonyme : aucun droit interne',
  'select count(*) from public.get_my_platform_permissions()', 0);

select pg_temp.be('9a300000-0000-0000-0000-000000000007');
select pg_temp.expect_count('A2 compte hors plateforme : aucun droit',
  'select count(*) from public.get_my_platform_permissions()', 0);

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect_count('A3 le fondateur porte les quatre droits neufs',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','promotions.apply','worker.operate')$$, 4);

select pg_temp.be('9a300000-0000-0000-0000-000000000002');
select pg_temp.expect_count('A4 l''admin aussi — les défauts et le worker ne sont pas réservés au seul fondateur',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','promotions.apply','worker.operate')$$, 4);

select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect_count('A5 le commercial porte promotions.apply, ET RIEN D''AUTRE des quatre',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','worker.operate')$$, 0);
select pg_temp.expect_count('A6 … et il le porte bien',
  $$select count(*) from public.get_my_platform_permissions() k where k = 'promotions.apply'$$, 1);

select pg_temp.be('9a300000-0000-0000-0000-000000000003');
select pg_temp.expect_count('A7 le support : aucun des quatre',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','promotions.apply','worker.operate')$$, 0);
select pg_temp.be('9a300000-0000-0000-0000-000000000004');
select pg_temp.expect_count('A8 le modérateur : aucun des quatre',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','promotions.apply','worker.operate')$$, 0);
select pg_temp.be('9a300000-0000-0000-0000-000000000006');
select pg_temp.expect_count('A9 le stagiaire : aucun des quatre',
  $$select count(*) from public.get_my_platform_permissions() k
    where k in ('platform.settings','promotions.manage','promotions.apply','worker.operate')$$, 0);

-- ============================================================================
-- B. LES DÉFAUTS PLATEFORME
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('B1 le fondateur lit les défauts',
  'select count(*) from public.list_platform_settings()', 'ok');
select pg_temp.expect_count('B2 dix défauts plus les cinq poids du fil',
  'select count(*) from public.list_platform_settings()', 15);
select pg_temp.expect_count('B3 aucun réglage de PRIX — la grille reste dans le catalogue',
  $$select count(*) from public.platform_settings where family = 'pricing' or key like '%price%' or key like '%plan%'$$, 0);

select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect('B4 le commercial NE RÈGLE PAS les défauts',
  'select count(*) from public.list_platform_settings()', 'refus');
select pg_temp.expect('B5 … ni ne les écrit',
  $$select public.set_platform_setting('queue.capacity_per_barber', 30, 'essai')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000003');
select pg_temp.expect('B6 le support non plus',
  $$select public.set_platform_setting('queue.capacity_per_barber', 30, 'essai')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000004');
select pg_temp.expect('B7 le modérateur non plus',
  $$select public.set_platform_setting('queue.capacity_per_barber', 30, 'essai')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000006');
select pg_temp.expect('B8 le stagiaire non plus',
  $$select public.set_platform_setting('queue.capacity_per_barber', 30, 'essai')$$, 'refus');
select pg_temp.as_anon();
select pg_temp.expect('B9 l''anonyme non plus',
  $$select public.set_platform_setting('queue.capacity_per_barber', 30, 'essai')$$, 'refus');

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
-- LES BORNES, CÔTÉ SERVEUR.
select pg_temp.expect('B10 au-dessus de la borne haute : REFUSÉ',
  $$select public.set_platform_setting('queue.capacity_per_barber', 5000, 'essai')$$, 'refus');
select pg_temp.expect('B11 sous la borne basse : REFUSÉ',
  $$select public.set_platform_setting('queue.capacity_per_barber', 0, 'essai')$$, 'refus');
select pg_temp.expect('B12 une grâce de zéro minute : REFUSÉE (borne basse à 1)',
  $$select public.set_platform_setting('queue.call_grace_minutes', 0, 'essai')$$, 'refus');
select pg_temp.expect('B13 une grâce de quatre heures : REFUSÉE (borne haute à 30)',
  $$select public.set_platform_setting('queue.call_grace_minutes', 240, 'essai')$$, 'refus');
select pg_temp.expect('B14 une valeur non entière là où l''entier est exigé : REFUSÉE',
  $$select public.set_platform_setting('queue.capacity_per_barber', 12.5, 'essai')$$, 'refus');
select pg_temp.expect('B15 une clé inconnue : REFUSÉE',
  $$select public.set_platform_setting('queue.cette_cle_nexiste_pas', 3, 'essai')$$, 'refus');
select pg_temp.expect('B16 la même valeur qu''avant : REFUSÉE, pour ne pas polluer le journal',
  $$select public.set_platform_setting('queue.capacity_per_barber', 20, 'essai')$$, 'refus');

-- L'ÉCRITURE, ET SA PROPAGATION.
select pg_temp.expect('B17 le fondateur abaisse la capacité de file',
  $$select public.set_platform_setting('queue.capacity_per_barber', 15, 'QA PLAT-3')$$, 'ok');
select pg_temp.expect_count('B18 … et les deux lieux non surchargés l''ont reçue',
  $$select count(*) from public.location_service_settings
    where location_id in ('9a30c000-0000-0000-0000-00000000000a','9a30c000-0000-0000-0000-00000000000b')
      and queue_capacity_per_barber = 15$$, 2);

-- LA SURCHARGE PAR SALON, et le fait qu'elle tient.
select pg_temp.be('9a300000-0000-0000-0000-000000000011');
select pg_temp.expect('B19 le patron du salon A règle SA capacité',
  $$select public.set_location_queue_thresholds('9a30c000-0000-0000-0000-00000000000a', 40, null, null)$$, 'ok');
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('B20 le fondateur rebaisse le défaut',
  $$select public.set_platform_setting('queue.capacity_per_barber', 12, 'QA PLAT-3 second')$$, 'ok');
select pg_temp.expect_text('B21 le salon A GARDE ses 40 : une surcharge ne se fait pas écraser',
  $$select queue_capacity_per_barber::text from public.location_service_settings
    where location_id = '9a30c000-0000-0000-0000-00000000000a'$$, '40');
select pg_temp.expect_text('B22 le salon B, lui, suit le défaut',
  $$select queue_capacity_per_barber::text from public.location_service_settings
    where location_id = '9a30c000-0000-0000-0000-00000000000b'$$, '12');

-- LES POIDS DU FIL, par la même porte, dans leur propre table.
select pg_temp.expect('B23 un poids de classement se règle par la même RPC',
  $$select public.set_platform_setting('search.weight_freshness', 2.5, 'QA PLAT-3')$$, 'ok');
-- `feed_ranking_weights` est RLS forcée SANS POLICY et révoquée aux rôles
-- clients : seule `get_feed` (SECURITY DEFINER) la lit. On sort donc du rôle
-- `authenticated` pour VÉRIFIER l'écriture — et le fait qu'il faille en
-- sortir est lui-même la preuve que la table reste fermée.
reset role;
select pg_temp.expect_text('B24 … et c''est bien feed_ranking_weights qui a bougé, pas une copie',
  $$select weight::text from public.feed_ranking_weights where signal = 'freshness'$$, '2.5');
set local role authenticated;
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('B25 un poids hors de 0..100 : REFUSÉ',
  $$select public.set_platform_setting('search.weight_freshness', 300, 'essai')$$, 'refus');
select pg_temp.expect('B26 un signal de classement inconnu : REFUSÉ',
  $$select public.set_platform_setting('search.weight_nexiste_pas', 1, 'essai')$$, 'refus');

-- LA TRACE.
select pg_temp.expect_count('B27 chaque changement est au journal, avec ancienne ET nouvelle valeur',
  $$select count(*) from public.platform_audit_log
    where action = 'platform_setting_changed'
      and metadata ? 'previous_value' and metadata ? 'new_value'$$, 3);
-- Le nombre exact dépend du nombre de lieux de la base où la suite tourne
-- (deux en bac d'essai neuf, cent cinquante-quatre contre la production) :
-- ce qui est vérifié, c'est que la propagation est COMPTÉE et qu'elle a
-- couvert au moins les deux lieux de la fixture.
select pg_temp.expect_text('B28 … et le journal porte le nombre de lieux propagés',
  $$select (((metadata->>'locations_propagated')::integer >= 2))::text from public.platform_audit_log
    where action = 'platform_setting_changed' and metadata->>'key' = 'queue.capacity_per_barber'
    order by created_at limit 1$$, 'true');

-- LA LECTURE PUBLIQUE.
select pg_temp.as_anon();
select pg_temp.expect('B29 un anonyme lit les deux réglages qui le concernent',
  'select * from public.get_public_platform_settings()', 'ok');
select pg_temp.expect_count('B30 … et rien de plus : la table elle-même lui reste fermée',
  'select count(*) from public.platform_settings', 0);

-- ============================================================================
-- C. LA FENÊTRE DE RÉSERVATION, CÔTÉ SERVEUR
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('C1 le fondateur ramène la fenêtre à 30 jours',
  $$select public.set_platform_setting('booking.window_days', 30, 'QA PLAT-3')$$, 'ok');
select pg_temp.expect_text('C2 … et get_public_platform_settings le dit au client',
  'select booking_window_days::text from public.get_public_platform_settings()', '30');

-- La garde elle-même : book_public_appointment refuse au-delà de la fenêtre.
-- On ne construit pas un salon réservable complet ici (c'est le sujet de
-- verify_public_booking.sql) : ce qui est vérifié, c'est que le refus de
-- FENÊTRE arrive AVANT tout le reste, donc sur un salon inexistant aussi.
select pg_temp.as_anon();
do $$
declare v_detail text;
begin
  begin
    perform public.book_public_appointment(
      'zz-qa-plat3-a', '9a30c000-0000-0000-0000-00000000000a', null,
      '00000000-0000-0000-0000-000000000000', now() + interval '200 days',
      'QA', '+33600000000', null, null);
    raise exception 'ÉCHEC — C4 une réservation à 200 jours aurait dû être refusée';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail is distinct from 'fadeup_booking_refusal=beyond_booking_window' then
      raise exception 'ÉCHEC — C4 refus attendu beyond_booking_window, obtenu « % » (%)', v_detail, sqlerrm;
    end if;
    raise notice 'ok — C4 au-delà de la fenêtre : refus nommé beyond_booking_window';
  end;
end $$;

do $$
declare v_detail text;
begin
  begin
    perform public.book_public_appointment(
      'zz-qa-plat3-a', '9a30c000-0000-0000-0000-00000000000a', null,
      '00000000-0000-0000-0000-000000000000', now() + interval '10 days',
      'QA', '+33600000000', null, null);
    raise exception 'ÉCHEC — C5 le salon de test n''est pas réservable, un refus était attendu';
  exception when others then
    get stacked diagnostics v_detail = pg_exception_detail;
    if v_detail = 'fadeup_booking_refusal=beyond_booking_window' then
      raise exception 'ÉCHEC — C5 une date DANS la fenêtre a été refusée pour dépassement de fenêtre';
    end if;
    raise notice 'ok — C5 dans la fenêtre, la garde ne se déclenche pas (refus suivant : %)', v_detail;
  end;
end $$;

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('C6 le fondateur règle le plafond de réservations futures',
  $$select public.set_platform_setting('booking.max_future_per_customer', 3, 'QA PLAT-3')$$, 'ok');
select pg_temp.expect_text('C7 … et c''est bien la base qui le porte, plus une constante de corps',
  $$select value::text from public.platform_settings where key = 'booking.max_future_per_customer'$$, '3');

-- ============================================================================
-- D. LES PROMOTIONS
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect('D1 le commercial NE CRÉE PAS une promotion',
  $$select public.create_promotion('QAPNEW1', 'percent', 10, null, 'once')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000003');
select pg_temp.expect('D2 le support non plus',
  $$select public.create_promotion('QAPNEW2', 'percent', 10, null, 'once')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000006');
select pg_temp.expect('D3 le stagiaire non plus',
  $$select public.create_promotion('QAPNEW3', 'percent', 10, null, 'once')$$, 'refus');
select pg_temp.as_anon();
select pg_temp.expect('D4 l''anonyme non plus',
  $$select public.create_promotion('QAPNEW4', 'percent', 10, null, 'once')$$, 'refus');

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('D5 le fondateur crée une promotion',
  $$select public.create_promotion('QAPNEW5', 'percent', 25, null, 'repeating', 3)$$, 'ok');
select pg_temp.expect('D6 un code mal formé : REFUSÉ',
  $$select public.create_promotion('qa!', 'percent', 10, null, 'once')$$, 'refus');
select pg_temp.expect('D7 un pourcentage au-dessus de 100 : REFUSÉ',
  $$select public.create_promotion('QAPNEW7', 'percent', 150, null, 'once')$$, 'refus');
select pg_temp.expect('D8 un plan éligible inexistant : REFUSÉ',
  $$select public.create_promotion('QAPNEW8', 'percent', 10, null, 'once', null, null, null, null, array['plan_qui_nexiste_pas'])$$, 'refus');
select pg_temp.expect('D9 une promotion sur le plan GRATUIT : REFUSÉE',
  $$select public.create_promotion('QAPNEW9', 'percent', 10, null, 'once', null, null, null, null, array['free'])$$, 'refus');
select pg_temp.expect('D10 un code déjà pris : REFUSÉ',
  $$select public.create_promotion('QAPLAT3A', 'percent', 10, null, 'once')$$, 'refus');

-- LE PLAFOND PAR RÔLE, À LA CRÉATION.
select pg_temp.be('9a300000-0000-0000-0000-000000000002');
select pg_temp.expect('D11 l''admin crée une remise de 40 %',
  $$select public.create_promotion('QAPADM40', 'percent', 40, null, 'once')$$, 'ok');
select pg_temp.expect('D12 … mais pas de 90 % : au-dessus de SON plafond',
  $$select public.create_promotion('QAPADM90', 'percent', 90, null, 'once')$$, 'refus');
select pg_temp.expect('D13 … ni « pour toujours » : au-dessus de sa durée maximale',
  $$select public.create_promotion('QAPADMFV', 'percent', 10, null, 'forever')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('D14 le fondateur, lui, peut « pour toujours »',
  $$select public.create_promotion('QAPOWNFV', 'percent', 10, null, 'forever')$$, 'ok');

-- LE PLAFOND PAR RÔLE, À L'APPLICATION — la garde qui compte vraiment.
select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect('D15 le commercial applique une remise de 15 % sur 2 mois : DANS ses bornes',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000a', '9a30d000-0000-0000-0000-000000000001', 'geste commercial QA')$$, 'ok');
select pg_temp.expect('D16 … mais pas les 90 % créés par le fondateur : HORS de ses bornes',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000b', '9a30d000-0000-0000-0000-000000000002', 'essai')$$, 'refus');
select pg_temp.expect('D17 une application sans motif : REFUSÉE',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000b', '9a30d000-0000-0000-0000-000000000004', null)$$, 'refus');

-- PAS DE CUMUL.
select pg_temp.expect('D18 une seconde remise sur le même salon : REFUSÉE (pas de cumul)',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000a', '9a30d000-0000-0000-0000-000000000004', 'seconde')$$, 'refus');

-- UNE PROMOTION NON CONFIRMÉE CHEZ STRIPE NE S'APPLIQUE PAS.
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('D19 une promotion que Stripe n''a pas confirmée : REFUSÉE',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000b', '9a30d000-0000-0000-0000-000000000002', 'essai fondateur')$$, 'refus');
select pg_temp.expect('D20 une promotion échue : REFUSÉE',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000b', '9a30d000-0000-0000-0000-000000000003', 'essai')$$, 'refus');

-- LE CHEMIN DU CODE, CÔTÉ SALON.
select pg_temp.be('9a300000-0000-0000-0000-000000000012');
select pg_temp.expect('D21 le patron du salon B saisit un code valide',
  $$select public.redeem_promotion_code('9a30a000-0000-0000-0000-00000000000b', 'qaplat3d')$$, 'ok');
select pg_temp.expect('D22 un code inconnu : REFUSÉ',
  $$select public.redeem_promotion_code('9a30a000-0000-0000-0000-00000000000b', 'CENEXISTEPAS')$$, 'refus');
select pg_temp.expect('D23 … et un patron ne pose pas de code sur le salon d''un autre',
  $$select public.redeem_promotion_code('9a30a000-0000-0000-0000-00000000000a', 'QAPLAT3A')$$, 'refus');

-- CE QU'UN SALON VOIT, ET NE VOIT PAS.
select pg_temp.expect_count('D24 le patron B voit SA remise',
  $$select count(*) from public.get_my_organization_promotion('9a30a000-0000-0000-0000-00000000000b')$$, 1);
select pg_temp.expect('D25 … et pas celle du salon A',
  $$select count(*) from public.get_my_organization_promotion('9a30a000-0000-0000-0000-00000000000a')$$, 'refus');
select pg_temp.expect_count('D26 … et il n''ÉNUMÈRE PAS les promotions : la table lui est fermée',
  'select count(*) from public.promotions', 0);
select pg_temp.expect('D27 … ni par la RPC de liste',
  'select count(*) from public.list_promotions()', 'refus');
select pg_temp.expect_count('D28 … et il ne voit QUE ses propres applications',
  'select count(*) from public.promotion_redemptions', 1);

select pg_temp.as_anon();
select pg_temp.expect_count('D29 un anonyme ne voit aucune promotion',
  'select count(*) from public.promotions', 0);
select pg_temp.expect_count('D30 … ni aucune application',
  'select count(*) from public.promotion_redemptions', 0);

-- LA RÉVOCATION.
select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect('D31 le commercial ne RÉVOQUE pas une remise',
  $$select public.revoke_promotion_redemption(
      (select id from public.promotion_redemptions where organization_id = '9a30a000-0000-0000-0000-00000000000a' limit 1),
      'essai')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect('D32 une révocation sans motif : REFUSÉE',
  $$select public.revoke_promotion_redemption(
      (select id from public.promotion_redemptions where organization_id = '9a30a000-0000-0000-0000-00000000000a' limit 1),
      null)$$, 'refus');
select pg_temp.expect('D33 le fondateur révoque, avec motif',
  $$select public.revoke_promotion_redemption(
      (select id from public.promotion_redemptions where organization_id = '9a30a000-0000-0000-0000-00000000000a' limit 1),
      'QA PLAT-3 révocation')$$, 'ok');
select pg_temp.expect('D34 … et le salon peut alors en recevoir une autre : le non-cumul ne bloque que l''ACTIF',
  $$select public.apply_promotion('9a30a000-0000-0000-0000-00000000000a', '9a30d000-0000-0000-0000-000000000004', 'après révocation')$$, 'ok');

-- LE CONTRAT AVEC LE BILLING.
select pg_temp.be('9a300000-0000-0000-0000-000000000012');
select pg_temp.expect_count('D35 resolve_checkout_discount rend le coupon du salon B',
  $$select count(*) from public.resolve_checkout_discount('9a30a000-0000-0000-0000-00000000000b')$$, 1);
select pg_temp.be('9a300000-0000-0000-0000-000000000011');
select pg_temp.expect('D36 … et refuse à qui n''est pas propriétaire de CE salon',
  $$select count(*) from public.resolve_checkout_discount('9a30a000-0000-0000-0000-00000000000b')$$, 'refus');

-- LA TRACE.
select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect_count('D37 chaque application est tracée : qui, quel salon, quelle remise, pourquoi',
  $$select count(*) from public.platform_audit_log
    where action = 'promotion_applied'
      and metadata ? 'organization_id' and metadata ? 'code' and metadata ? 'applied_via'$$, 3);
select pg_temp.expect_count('D38 la création et la révocation aussi',
  $$select count(*) from public.platform_audit_log
    where action in ('promotion_created', 'promotion_revoked')$$, 4);

-- ============================================================================
-- E. LE PILOTAGE DU WORKER
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect('E1 le commercial ne voit pas l''état du worker',
  'select count(*) from public.get_prospect_worker_state()', 'refus');
select pg_temp.expect('E2 … ne le met pas en pause',
  $$select public.set_prospect_worker_paused(true, 'essai')$$, 'refus');
select pg_temp.expect('E3 … et ne lance pas de passe',
  $$select public.create_prospect_discovery_job('discovery', '{}'::jsonb)$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000003');
select pg_temp.expect('E4 le support non plus',
  $$select public.set_prospect_worker_paused(true, 'essai')$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000004');
select pg_temp.expect('E5 le modérateur non plus',
  $$select public.create_prospect_discovery_job('discovery', '{}'::jsonb)$$, 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000006');
select pg_temp.expect('E6 le stagiaire non plus',
  'select count(*) from public.list_prospect_worker_passes()', 'refus');
select pg_temp.as_anon();
select pg_temp.expect('E7 l''anonyme non plus',
  'select count(*) from public.get_prospect_worker_state()', 'refus');

select pg_temp.be('9a300000-0000-0000-0000-000000000002');
select pg_temp.expect('E8 l''admin voit l''état',
  'select count(*) from public.get_prospect_worker_state()', 'ok');
select pg_temp.expect('E9 … lit le journal des passes',
  'select count(*) from public.list_prospect_worker_passes()', 'ok');
select pg_temp.expect('E10 … lance une passe',
  $$select public.create_prospect_discovery_job('discovery', '{"qa":"plat3"}'::jsonb)$$, 'ok');
select pg_temp.expect_count('E11 … et le lancement est TRACÉ, avec son auteur',
  $$select count(*) from public.platform_audit_log
    where action = 'prospect_worker_pass_launched'
      and actor_user_id = '9a300000-0000-0000-0000-000000000002'$$, 1);
select pg_temp.expect('E12 un type de travail inconnu : REFUSÉ',
  $$select public.create_prospect_discovery_job('supprime_tout', '{}'::jsonb)$$, 'refus');

-- LA PAUSE, ET SON EFFET RÉEL SUR LE WORKER.
select pg_temp.expect('E13 une pause sans motif : REFUSÉE',
  $$select public.set_prospect_worker_paused(true, null)$$, 'refus');
select pg_temp.expect('E14 l''admin met le worker en pause, avec motif',
  $$select public.set_prospect_worker_paused(true, 'QA PLAT-3')$$, 'ok');

reset role;
select pg_temp.expect_count('E15 EN PAUSE, le worker ne reçoit plus rien — mesuré sur la fonction qu''il appelle',
  $$select count(*) from (select private.claim_next_prospect_job('qa-plat3-worker', 60)) t where (t.claim_next_prospect_job).id is not null$$, 0);
select pg_temp.expect_count('E16 … mais il SONDE toujours : le battement distingue la pause de la panne',
  $$select count(*) from public.prospect_worker_state
    where last_poll_at >= now() - interval '10 seconds'
      and last_poll_worker_id = 'qa-plat3-worker'$$, 1);

set local role authenticated;
select pg_temp.be('9a300000-0000-0000-0000-000000000002');
select pg_temp.expect('E17 l''admin relance le worker',
  $$select public.set_prospect_worker_paused(false, null)$$, 'ok');

reset role;
select pg_temp.expect_count('E18 … et la passe en attente lui est servie',
  $$select count(*) from (select private.claim_next_prospect_job('qa-plat3-worker', 60)) t where (t.claim_next_prospect_job).id is not null$$, 1);

set local role authenticated;
select pg_temp.be('9a300000-0000-0000-0000-000000000002');
select pg_temp.expect_count('E19 la pause et la reprise sont au journal',
  $$select count(*) from public.platform_audit_log
    where action in ('prospect_worker_paused', 'prospect_worker_resumed')$$, 2);
select pg_temp.expect_text('E20 l''état se lit : plus en pause, et vivant puisqu''il vient de sonder',
  $$select (is_paused::text || '/' || is_live::text) from public.get_prospect_worker_state()$$, 'false/true');

-- ============================================================================
-- F. LE TUNNEL D'ACQUISITION
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000003');
select pg_temp.expect('F1 le support ne lit pas le tunnel',
  'select count(*) from public.get_platform_acquisition_funnel()', 'refus');
select pg_temp.be('9a300000-0000-0000-0000-000000000006');
select pg_temp.expect('F2 le stagiaire non plus : il est borné à sa zone, pas à la plateforme',
  'select count(*) from public.get_platform_acquisition_funnel()', 'refus');
select pg_temp.as_anon();
select pg_temp.expect('F3 l''anonyme non plus',
  'select count(*) from public.get_platform_acquisition_funnel()', 'refus');

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect_count('F4 le fondateur lit les six étapes',
  'select count(*) from public.get_platform_acquisition_funnel()', 6);
select pg_temp.be('9a300000-0000-0000-0000-000000000005');
select pg_temp.expect_count('F5 le commercial aussi — il a crm.read',
  'select count(*) from public.get_platform_acquisition_funnel()', 6);

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect_count('F6 ventilé par origine, les deux dernières étapes sont NON ATTRIBUABLES',
  $$select count(*) from public.get_platform_acquisition_funnel(null, null, 'origin')
    where stage in ('trials','subscriptions') and attributable$$, 0);
select pg_temp.expect_count('F7 … et elles rendent NULL, jamais un zéro faux',
  $$select count(*) from public.get_platform_acquisition_funnel(null, null, 'origin')
    where stage in ('trials','subscriptions') and total is not null$$, 0);
select pg_temp.expect_count('F8 AUCUN taux n''est rendu sous le seuil de vingt cas',
  $$select count(*) from public.get_platform_acquisition_funnel()
    where conversion_rate is not null
      and (select total from public.get_platform_acquisition_funnel() p
            where p.stage_order = stage_order - 1 and p.bucket_key = bucket_key) < 20$$, 0);
select pg_temp.expect_text('F9 … et le seuil est rendu par le serveur, pas recopié par l''écran',
  'select distinct min_sample::text from public.get_platform_acquisition_funnel()', '20');
select pg_temp.expect('F10 une fenêtre à l''envers : REFUSÉE',
  $$select count(*) from public.get_platform_acquisition_funnel(now(), now() - interval '1 day')$$, 'refus');
select pg_temp.expect('F11 une ventilation inconnue : REFUSÉE',
  $$select count(*) from public.get_platform_acquisition_funnel(null, null, 'par_couleur')$$, 'refus');
-- La coupure d'attribution n'est pas une conversion : entre une revendication
-- (rattachée à un prospect) et un essai (rattaché à une organisation), la
-- population change, et un pourcentage y serait un chiffre exact répondant à
-- une question fausse.
select pg_temp.expect_count('F12 aucun taux entre les revendications et les essais : la population change',
  $$select count(*) from public.get_platform_acquisition_funnel(now() - interval '3650 days', now())
    where stage = 'trials' and conversion_rate is not null$$, 0);

-- ============================================================================
-- G. LE JOURNAL RESTE EN AJOUT SEUL
-- ============================================================================

select pg_temp.be('9a300000-0000-0000-0000-000000000001');
select pg_temp.expect_count('G1 les six familles d''action de ce lot ont écrit au journal',
  $$select count(distinct action) from public.platform_audit_log
    where action in ('platform_setting_changed', 'promotion_created', 'promotion_applied',
                     'promotion_revoked', 'prospect_worker_paused', 'prospect_worker_resumed',
                     'prospect_worker_pass_launched')$$, 7);

reset role;
select pg_temp.expect('G2 et ce journal reste en AJOUT SEUL, même au plus haut privilège',
  $$update public.platform_audit_log set action = 'réécrit' where action = 'platform_setting_changed'$$, 'refus');
select pg_temp.expect('G3 … suppression refusée aussi',
  $$delete from public.platform_audit_log where action = 'promotion_applied'$$, 'refus');

do $$ begin raise notice '========== PLAT-3 : suite de permissions VERTE =========='; end $$;

rollback;
