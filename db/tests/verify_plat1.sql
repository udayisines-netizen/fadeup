-- ============================================================================
-- PLAT-1 — la suite de permissions
-- ============================================================================
--
-- Pour chaque rôle et chaque geste : ce qui est autorisé passe, ce qui ne
-- l'est pas échoue — vérifié EN APPELANT LA RPC, jamais via l'interface.
--
-- Modèle QA_DATA règle 1 : une seule transaction, terminée par ROLLBACK. Rien
-- n'est écrit. Peut donc tourner contre la production sans résidu, et c'est
-- ainsi qu'elle y a été passée.
--
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 -f - < db/tests/verify_plat1.sql
--
-- Chaque assertion affiche « ok — … » ou fait échouer la suite entière.

\set ON_ERROR_STOP on
\timing off
-- Les assertions parlent par NOTICE (stderr) ; les tables de résultat vides
-- que renvoient les aides n'apportent rien.
\o /dev/null

begin;

-- ============================================================ fixtures
insert into auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
values
  ('9a100000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-founder@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Fondateur"}',  'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-admin@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Admin"}',      'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-support@fadeup.test',   crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Support"}',    'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-moderator@fadeup.test', crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Moderateur"}', 'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-sales@fadeup.test',     crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Commercial"}', 'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-intern@fadeup.test',    crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Stagiaire"}',  'authenticated', 'authenticated'),
  ('9a100000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'qa-plat1-v-outsider@fadeup.test',  crypt('x', gen_salt('bf')), now(), '{}', '{"full_name":"V Dehors"}',     'authenticated', 'authenticated');

insert into public.platform_members (user_id, role) values
  ('9a100000-0000-0000-0000-000000000001', 'platform_owner'),
  ('9a100000-0000-0000-0000-000000000002', 'platform_admin'),
  ('9a100000-0000-0000-0000-000000000003', 'platform_support'),
  ('9a100000-0000-0000-0000-000000000004', 'platform_moderator'),
  ('9a100000-0000-0000-0000-000000000005', 'platform_sales'),
  ('9a100000-0000-0000-0000-000000000006', 'platform_intern');

-- Deux zones, et un stagiaire qui n'en a qu'une.
insert into public.platform_zones (id, country, city, city_key, label)
values
  ('9a1e0000-0000-0000-0000-000000000001', 'FR', 'Saint-Denis', 'saint-denis', 'Saint-Denis'),
  ('9a1e0000-0000-0000-0000-000000000002', 'FR', 'Marseille',   'marseille',   'Marseille');

insert into public.platform_member_zones (user_id, zone_id)
values ('9a100000-0000-0000-0000-000000000006', '9a1e0000-0000-0000-0000-000000000001');

-- Deux prospects : un dans la zone du stagiaire, un ailleurs.
insert into public.prospects (id, type, canonical_name, country)
values
  ('9a1b0000-0000-0000-0000-000000000001', 'barbershop', 'QA PLAT1 Salon Zone', 'FR'),
  ('9a1b0000-0000-0000-0000-000000000002', 'barbershop', 'QA PLAT1 Salon Hors Zone', 'FR');

insert into public.prospect_locations (prospect_id, is_primary, city, country)
values
  ('9a1b0000-0000-0000-0000-000000000001', true, 'Saint-Denis', 'FR'),
  ('9a1b0000-0000-0000-0000-000000000002', true, 'Lyon', 'FR');

-- Helpers ------------------------------------------------------------------
create or replace function pg_temp.be(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
end $$;

-- Exécute `p_sql` et compare le résultat attendu (« ok » = passe,
-- « refus » = doit lever). Affiche une ligne, ou fait échouer la suite.
create or replace function pg_temp.expect(p_label text, p_sql text, p_expect text) returns void language plpgsql as $$
declare
  v_err text;
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

  raise notice 'ok — %  (%)', p_label, coalesce(left(v_err, 70), 'passé');
end $$;

create or replace function pg_temp.expect_count(p_label text, p_sql text, p_expected bigint) returns void language plpgsql as $$
declare v_n bigint;
begin
  execute p_sql into v_n;
  if v_n is distinct from p_expected then
    raise exception 'ÉCHEC — % : % ligne(s) au lieu de %', p_label, v_n, p_expected;
  end if;
  raise notice 'ok — %  (% ligne(s))', p_label, v_n;
end $$;

-- X3 a durci l'ACL par défaut des fonctions : une fonction neuve ne naît plus
-- exécutable par PUBLIC. Les aides de pg_temp doivent donc être concédées
-- explicitement, sinon la suite meurt sur « permission denied ».
grant execute on function pg_temp.be(uuid) to authenticated;
grant execute on function pg_temp.as_anon() to authenticated;
grant execute on function pg_temp.expect(text, text, text) to authenticated;
grant execute on function pg_temp.expect_count(text, text, bigint) to authenticated;

set local role authenticated;

-- ============================================================================
-- A. LA GRILLE RÉPOND, ET LE DÉFAUT EST LE REFUS
-- ============================================================================

select pg_temp.as_anon();
select pg_temp.expect_count('A1 anonyme : aucun droit interne',
  'select count(*) from public.get_my_platform_permissions()', 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000007');
select pg_temp.expect_count('A2 compte hors plateforme : aucun droit',
  'select count(*) from public.get_my_platform_permissions()', 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect_count('A3 fondateur : quinze droits',
  'select count(*) from public.get_my_platform_permissions()', 15);

select pg_temp.be('9a100000-0000-0000-0000-000000000006');
select pg_temp.expect_count('A4 stagiaire : deux droits',
  'select count(*) from public.get_my_platform_permissions()', 2);

-- ============================================================================
-- B. SEUL LE FONDATEUR GÈRE LES RÔLES INTERNES
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000002');
select pg_temp.expect('B1 un admin ne crée pas un rôle interne',
  $$select public.set_platform_member_role('9a100000-0000-0000-0000-000000000007', 'platform_admin')$$, 'refus');
select pg_temp.expect('B2 un admin n''invite plus personne',
  $$select * from public.create_platform_invitation('platform_support', 'x@fadeup.test')$$, 'refus');
select pg_temp.expect('B3 un admin ne révoque pas un interne',
  $$select public.revoke_platform_member('9a100000-0000-0000-0000-000000000003')$$, 'refus');
select pg_temp.expect('B4 un admin n''assigne pas de zone',
  $$select public.set_platform_member_zones('9a100000-0000-0000-0000-000000000006', array['9a1e0000-0000-0000-0000-000000000002'::uuid])$$, 'refus');

-- Le garde-fou du dernier fondateur ne se démontre que s'il n'en reste qu'un.
-- La base en porte plusieurs (comptes réels + résidus QA) : on isole le nôtre
-- ici, dans une transaction qui sera annulée.
reset role;
delete from public.platform_members
where role = 'platform_owner' and user_id <> '9a100000-0000-0000-0000-000000000001';
set local role authenticated;

select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect('B5 le fondateur crée un rôle interne',
  $$select public.set_platform_member_role('9a100000-0000-0000-0000-000000000007', 'platform_sales')$$, 'ok');
select pg_temp.expect('B6 le fondateur invite',
  $$select * from public.create_platform_invitation('platform_moderator', 'qa-plat1-v-invite@fadeup.test')$$, 'ok');
select pg_temp.expect('B7 le fondateur assigne des zones',
  $$select public.set_platform_member_zones('9a100000-0000-0000-0000-000000000006', array['9a1e0000-0000-0000-0000-000000000001'::uuid])$$, 'ok');
select pg_temp.expect('B8 le dernier fondateur ne se rétrograde pas',
  $$select public.set_platform_member_role('9a100000-0000-0000-0000-000000000001', 'platform_admin')$$, 'refus');
select pg_temp.expect('B9 on ne révoque pas son propre accès',
  $$select public.revoke_platform_member('9a100000-0000-0000-0000-000000000001')$$, 'refus');

select pg_temp.as_anon();
select pg_temp.expect('B10 un anonyme ne gère pas les rôles',
  $$select public.set_platform_member_role('9a100000-0000-0000-0000-000000000007', 'platform_owner')$$, 'refus');

-- ============================================================================
-- C. UN ADMIN NE SUPPRIME PAS UN BARBER
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000002');
select pg_temp.expect('C1 un admin ne supprime pas un barber',
  $$select public.delete_barber_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'motif')$$, 'refus');

select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect('C2 le fondateur peut, et ne trouve pas ce barber (42704, pas 42501)',
  $$select public.delete_barber_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'motif')$$, 'refus');

-- Distinguer les deux refus : le fondateur doit buter sur « introuvable »,
-- l'admin sur « non autorisé ».
do $$
declare v_state text;
begin
  perform pg_temp.be('9a100000-0000-0000-0000-000000000001');
  begin
    perform public.delete_barber_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'motif');
  exception when others then v_state := sqlstate;
  end;
  if v_state <> '42704' then
    raise exception 'ÉCHEC — C3 le fondateur est refusé pour autorisation (%) et non pour absence', v_state;
  end if;
  raise notice 'ok — C3 le fondateur passe la garde (refus 42704 « introuvable »)';

  perform pg_temp.be('9a100000-0000-0000-0000-000000000002');
  begin
    perform public.delete_barber_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'motif');
  exception when others then v_state := sqlstate;
  end;
  if v_state <> '42501' then
    raise exception 'ÉCHEC — C4 l''admin aurait dû être refusé pour autorisation, reçu %', v_state;
  end if;
  raise notice 'ok — C4 l''admin bute sur la garde (42501)';
end $$;

-- ============================================================================
-- D. LE STAGIAIRE NE VOIT QUE SA ZONE, ET NE PUBLIE PAS
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000006');
select pg_temp.expect_count('D1 le stagiaire voit le prospect de sa zone',
  $$select count(*) from public.prospects where id = '9a1b0000-0000-0000-0000-000000000001'$$, 1);
select pg_temp.expect_count('D2 le stagiaire ne voit pas celui d''ailleurs',
  $$select count(*) from public.prospects where id = '9a1b0000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.expect_count('D3 ni ses coordonnées',
  $$select count(*) from public.prospect_locations where prospect_id = '9a1b0000-0000-0000-0000-000000000002'$$, 0);
select pg_temp.expect_count('D4 le stagiaire n''a aucune campagne',
  $$select count(*) from public.outreach_campaigns$$, 0);
select pg_temp.expect('D5 le stagiaire ne publie pas sur la marketplace',
  $$select public.publish_external_professional('9a1b0000-0000-0000-0000-000000000001')$$, 'refus');
select pg_temp.expect('D6 le stagiaire saisit dans sa zone',
  $$select public.capture_field_prospect('barbershop', 'QA PLAT1 Terrain', 'FR', 'Saint-Denis', 'deux fauteuils, affluence à 18h')$$, 'ok');
select pg_temp.expect('D7 le stagiaire ne saisit pas hors de sa zone',
  $$select public.capture_field_prospect('barbershop', 'QA PLAT1 Terrain B', 'FR', 'Lyon', 'vu de la rue')$$, 'refus');
select pg_temp.expect('D8 une fiche terrain sans observation est refusée',
  $$select public.capture_field_prospect('barbershop', 'QA PLAT1 Terrain C', 'FR', 'Saint-Denis', '   ')$$, 'refus');
select pg_temp.expect_count('D9 le stagiaire voit ce qu''il a saisi',
  $$select count(*) from public.prospects where origin = 'field' and field_captured_by = '9a100000-0000-0000-0000-000000000006'$$, 1);

-- ============================================================================
-- E. SUPPORT ET MODÉRATEUR N'ACCÈDENT PAS AU CRM
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000003');
select pg_temp.expect_count('E1 le support ne voit aucun prospect',
  $$select count(*) from public.prospects$$, 0);
select pg_temp.expect_count('E2 le support ne voit aucune campagne',
  $$select count(*) from public.outreach_campaigns$$, 0);
select pg_temp.expect_count('E3 le support ne voit aucune source',
  $$select count(*) from public.prospect_sources$$, 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000004');
select pg_temp.expect_count('E4 le modérateur ne voit aucun prospect',
  $$select count(*) from public.prospects$$, 0);
select pg_temp.expect_count('E5 le modérateur ne voit aucun modèle',
  $$select count(*) from public.ml_model_versions$$, 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000005');
select pg_temp.expect_count('E6 le commercial voit les prospects',
  $$select count(*) from public.prospects where id in ('9a1b0000-0000-0000-0000-000000000001','9a1b0000-0000-0000-0000-000000000002')$$, 2);

-- ============================================================================
-- F. ONBOARDINGS ET MODÉRATION
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000003');
select pg_temp.expect('F1 le support ne valide pas un onboarding',
  $$select public.review_professional_application('9a1b0000-0000-0000-0000-0000000000ff', 'approve')$$, 'refus');
select pg_temp.expect('F2 le support ne masque pas un avis',
  $$select public.moderate_review('9a1b0000-0000-0000-0000-0000000000ff', 'removed', 'spam')$$, 'refus');

do $$
declare v_state text;
begin
  -- Le commercial et le modérateur passent la garde d'onboarding : ils butent
  -- sur « candidature introuvable », pas sur « non autorisé ».
  foreach v_state in array array['9a100000-0000-0000-0000-000000000005', '9a100000-0000-0000-0000-000000000004'] loop
    perform pg_temp.be(v_state::uuid);
    declare v_sqlstate text;
    begin
      begin
        perform public.review_professional_application('9a1b0000-0000-0000-0000-0000000000ff', 'approve');
      exception when others then v_sqlstate := sqlstate;
      end;
      if v_sqlstate = '42501' then
        raise exception 'ÉCHEC — F3 % refusé par la garde d''onboarding', v_state;
      end if;
      raise notice 'ok — F3 % passe la garde d''onboarding (refus %)', v_state, v_sqlstate;
    end;
  end loop;
end $$;

select pg_temp.be('9a100000-0000-0000-0000-000000000005');
select pg_temp.expect('F4 le commercial ne masque pas un post',
  $$select public.moderate_post('9a1b0000-0000-0000-0000-0000000000ff', 'hidden')$$, 'refus');

do $$
declare v_sqlstate text;
begin
  perform pg_temp.be('9a100000-0000-0000-0000-000000000004');
  begin
    perform public.moderate_post('9a1b0000-0000-0000-0000-0000000000ff', 'hidden');
  exception when others then v_sqlstate := sqlstate;
  end;
  if v_sqlstate = '42501' then
    raise exception 'ÉCHEC — F5 le modérateur refusé par la garde de modération';
  end if;
  raise notice 'ok — F5 le modérateur passe la garde de modération (refus %)', v_sqlstate;
end $$;

-- ============================================================================
-- G. LA VUE EN TANT QUE
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000003');
select pg_temp.expect('G1 la vue en tant que est refusée au support',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization')$$, 'refus');

select pg_temp.be('9a100000-0000-0000-0000-000000000005');
select pg_temp.expect('G2 refusée au commercial',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization')$$, 'refus');

select pg_temp.be('9a100000-0000-0000-0000-000000000006');
select pg_temp.expect('G3 refusée au stagiaire',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization')$$, 'refus');

select pg_temp.as_anon();
select pg_temp.expect('G4 refusée à un anonyme',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization')$$, 'refus');

select pg_temp.be('9a100000-0000-0000-0000-000000000004');
select pg_temp.expect('G5 accordée au modérateur',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization', null, 'QA PLAT-1')$$, 'ok');
select pg_temp.expect_count('G6 la session porte une échéance à trente minutes',
  $$select count(*) from public.platform_support_sessions where platform_actor_id = '9a100000-0000-0000-0000-000000000004' and ended_at is null and expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'$$, 1);

-- ============================================================================
-- H. EN VUE EMPRUNTÉE, AUCUN GESTE DE PAIEMENT
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect('H1 hors vue empruntée, le fondateur assigne un plan',
  $$select public.assign_commercial_plan((select id from public.organizations order by created_at limit 1), (select plan_key from public.commercial_plans order by plan_key limit 1), 'active', 'QA PLAT-1')$$, 'ok');
select pg_temp.expect('H2 le fondateur entre en vue empruntée',
  $$select public.start_platform_support_session((select id from public.organizations order by created_at limit 1), 'organization', null, 'QA PLAT-1')$$, 'ok');
select pg_temp.expect('H3 en vue empruntée : assignation de plan REFUSÉE',
  $$select public.assign_commercial_plan((select id from public.organizations order by created_at limit 1), (select plan_key from public.commercial_plans order by plan_key desc limit 1), 'active', 'QA PLAT-1')$$, 'refus');
select pg_temp.expect('H4 en vue empruntée : portail de facturation REFUSÉ',
  $$select * from public.prepare_billing_portal((select id from public.organizations order by created_at limit 1))$$, 'refus');
select pg_temp.expect('H5 en vue empruntée : résiliation REFUSÉE',
  $$select * from public.request_billing_cancellation((select id from public.organizations order by created_at limit 1))$$, 'refus');
select pg_temp.expect('H6 en vue empruntée : paiement REFUSÉ',
  $$select * from public.prepare_billing_checkout((select id from public.organizations order by created_at limit 1), (select plan_key from public.commercial_plans order by plan_key limit 1), 'month')$$, 'refus');
select pg_temp.expect('H7 en vue empruntée : changement de plan REFUSÉ',
  $$select * from public.request_plan_change((select id from public.organizations order by created_at limit 1), (select plan_key from public.commercial_plans order by plan_key limit 1), 'month')$$, 'refus');
select pg_temp.expect('H8 en vue empruntée : devis REFUSÉ',
  $$select public.request_billing_quote((select id from public.organizations order by created_at limit 1), 3, 'QA')$$, 'refus');

-- Une session ÉCHUE n'emprunte plus rien. (Le vieillissement se fait hors
-- rôle applicatif : `authenticated` n'a aucun droit d'écriture sur cette
-- table, et c'est précisément ce qu'on veut.)
reset role;
update public.platform_support_sessions
set started_at = now() - interval '2 hours', expires_at = now() - interval '90 minutes'
where platform_actor_id = '9a100000-0000-0000-0000-000000000001' and ended_at is null;
set local role authenticated;
select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect('H9 session échue : le paiement redevient possible',
  $$select public.assign_commercial_plan((select id from public.organizations order by created_at limit 1), (select plan_key from public.commercial_plans order by plan_key desc limit 1), 'active', 'QA PLAT-1')$$, 'ok');

-- ============================================================================
-- I. LE JOURNAL D'AUDIT
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000001');
select pg_temp.expect_count('I1 le fondateur lit le journal',
  $$select case when count(*) > 0 then 1 else 0 end from public.platform_audit_log$$, 1);

select pg_temp.be('9a100000-0000-0000-0000-000000000003');
select pg_temp.expect_count('I2 le support ne lit pas le journal',
  $$select count(*) from public.platform_audit_log$$, 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000004');
select pg_temp.expect_count('I3 le modérateur ne lit pas le journal',
  $$select count(*) from public.platform_audit_log$$, 0);

select pg_temp.be('9a100000-0000-0000-0000-000000000005');
select pg_temp.expect_count('I4 le commercial ne lit pas le journal',
  $$select count(*) from public.platform_audit_log$$, 0);

reset role;
select pg_temp.expect('I5 même postgres ne modifie pas le journal',
  $$update public.platform_audit_log set action = 'falsifie' where true$$, 'refus');
select pg_temp.expect('I6 même postgres ne supprime pas le journal',
  $$delete from public.platform_audit_log where true$$, 'refus');
set local role authenticated;

-- Les sept familles d'action que PLAT-1 exige sont représentées.
do $$
declare
  v_missing text[];
begin
  perform pg_temp.be('9a100000-0000-0000-0000-000000000001');
  select array_agg(a) into v_missing from unnest(array[
    'external_professional_published',
    'professional_application_approved',
    'post_moderated',
    'appointment_cancelled_by_platform',
    'marketplace_withdrawal_completed',
    'platform_support_session_started',
    'platform_member_role_changed'
  ]) a
  where not exists (
    select 1 from public.platform_audit_log l where l.action = a
  ) and not exists (
    -- Certaines familles n'ont pas encore d'occurrence dans cette base : on
    -- vérifie alors que la RPC qui les écrit existe, plutôt que d'inventer
    -- une ligne pour faire passer le test.
    select 1 from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc like '%' || a || '%'
  );
  if v_missing is not null then
    raise exception 'ÉCHEC — I7 familles d''action sans écrivain ni trace : %', v_missing;
  end if;
  raise notice 'ok — I7 les sept familles d''action ont leur écrivain';
end $$;

-- ============================================================================
-- J. LE PROFESSIONNEL PEUT SAVOIR
-- ============================================================================

do $$
declare
  v_org uuid;
  v_owner uuid;
  v_n bigint;
begin
  select m.organization_id, m.user_id into v_org, v_owner
  from public.memberships m where m.role = 'owner' limit 1;

  perform pg_temp.be('9a100000-0000-0000-0000-000000000004');
  perform public.start_platform_support_session(v_org, 'organization', null, 'QA PLAT-1 trace');

  perform pg_temp.be(v_owner);
  select count(*) into v_n from public.list_organization_support_sessions(v_org);
  if v_n < 1 then
    raise exception 'ÉCHEC — J1 le propriétaire ne voit pas la vue empruntée subie';
  end if;
  raise notice 'ok — J1 le propriétaire voit la vue empruntée subie (% ligne(s))', v_n;

  perform pg_temp.be('9a100000-0000-0000-0000-000000000007');
  select count(*) into v_n from public.list_organization_support_sessions(v_org);
  if v_n <> 0 then
    raise exception 'ÉCHEC — J2 un tiers voit les sessions d''une organisation';
  end if;
  raise notice 'ok — J2 un tiers ne voit rien';
end $$;

-- ============================================================================
-- K. L'ANNULATION PAR LE SUPPORT
-- ============================================================================

select pg_temp.be('9a100000-0000-0000-0000-000000000005');
select pg_temp.expect('K1 le commercial n''annule pas un rendez-vous',
  $$select public.cancel_appointment_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'motif')$$, 'refus');

do $$
declare v_sqlstate text;
begin
  perform pg_temp.be('9a100000-0000-0000-0000-000000000003');
  begin
    perform public.cancel_appointment_as_platform('9a1b0000-0000-0000-0000-0000000000ff', 'client injoignable');
  exception when others then v_sqlstate := sqlstate;
  end;
  if v_sqlstate = '42501' then
    raise exception 'ÉCHEC — K2 le support refusé par la garde d''annulation';
  end if;
  raise notice 'ok — K2 le support passe la garde d''annulation (refus %)', v_sqlstate;

  begin
    perform public.cancel_appointment_as_platform('9a1b0000-0000-0000-0000-0000000000ff', '  ');
  exception when others then v_sqlstate := sqlstate;
  end;
  if v_sqlstate <> '22023' then
    raise exception 'ÉCHEC — K3 une annulation sans motif aurait dû être refusée (%)', v_sqlstate;
  end if;
  raise notice 'ok — K3 une annulation sans motif est refusée';
end $$;

reset role;

do $$ begin raise notice '========== PLAT-1 : suite de permissions VERTE =========='; end $$;

rollback;
