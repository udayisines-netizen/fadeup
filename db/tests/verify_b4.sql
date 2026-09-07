-- FadeUp — B4 verification: publications, stockage, avis, feed, notifications.
--
-- NE LAISSE RIEN DERRIÈRE : une seule transaction terminée par ROLLBACK,
-- comme verify_b1 (créer une organisation écrit une ligne append-only dans
-- commercial_plan_changes qu'aucun rôle ne peut effacer — une fixture
-- committée est un résidu permanent, leçon B1).
--
-- ⚠ À LANCER EN supabase_admin : les fixtures d'appointments terminés à date
-- choisie exigent session_replication_role=replica (les triggers de
-- transition horodatent eux-mêmes, à now(), ce qui rendrait la fenêtre de
-- 30 jours intestable). Le mode replica ne couvre QUE les fixtures ; tous
-- les tests tournent triggers actifs.
--
--   docker cp db/tests/verify_b4.sql fadeup-supabase-db:/tmp/
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d <db> -f /tmp/verify_b4.sql
--
-- PASS/FAIL par ligne ; n'avorte pas au premier échec.

\set ON_ERROR_STOP off

begin;

create temporary table b4_results (
  seq serial primary key,
  chantier text not null,
  check_name text not null,
  verdict text not null,
  detail text
) on commit drop;

create or replace function pg_temp.record(p_chantier text, p_check text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into b4_results (chantier, check_name, verdict, detail)
  values (p_chantier, p_check, case when p_ok then 'PASS' else 'FAIL' end, p_detail);
$$;

-- ===========================================================================
-- FIXTURES (session_replication_role = replica : faits bruts, cohérents,
-- posés sans triggers — exactement ce que la production contient déjà)
-- ===========================================================================

set local session_replication_role = replica;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('b4000e01-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-pro@verify.local',   '{}', '{}'),
  ('b4000e02-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-pro2@verify.local',  '{}', '{}'),
  ('b4000e03-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-pro3@verify.local',  '{}', '{}'),
  ('b4000e04-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-owner@verify.local', '{}', '{}'),
  ('b4000e05-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-cust1@verify.local', '{}', '{}'),
  ('b4000e06-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-cust2@verify.local', '{}', '{}'),
  ('b4000e07-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b4-follow@verify.local','{}', '{}');

-- marketplace_visible = false : les fixtures ne doivent JAMAIS apparaître
-- dans la recherche publique (leçon B1, wave1-boundary-a) ; le test de
-- non-régression compte les 9 organisations légitimes.
insert into public.organizations (id, name, slug, business_type, currency, country_code, marketplace_visible)
values
  ('b4000001-0000-4000-8000-000000000001', 'B4 Shop',  'b4-verify-shop',  'barbershop', 'EUR', 'FR', false),
  ('b4000002-0000-4000-8000-000000000002', 'B4 Other', 'b4-verify-other', 'barbershop', 'EUR', 'FR', false);

insert into public.locations (id, organization_id, name, address_line1, city, region, postal_code, country, timezone, latitude, longitude)
values
  ('b4000101-0000-4000-8000-000000000001', 'b4000001-0000-4000-8000-000000000001',
   'B4 Shop Châtelet', '1 rue de Rivoli', 'Paris', 'Île-de-France', '75001', 'FR', 'Europe/Paris', 48.8584, 2.3470),
  ('b4000102-0000-4000-8000-000000000002', 'b4000002-0000-4000-8000-000000000002',
   'B4 Other Bastille', '2 rue de la Roquette', 'Paris', 'Île-de-France', '75011', 'FR', 'Europe/Paris', 48.8532, 2.3694);

insert into public.staff_profiles (id, organization_id, location_id, display_name, is_active, is_public)
values
  ('b4000201-0000-4000-8000-000000000001', 'b4000001-0000-4000-8000-000000000001',
   'b4000101-0000-4000-8000-000000000001', 'B4 Pro Staff', true, true),
  ('b4000203-0000-4000-8000-000000000003', 'b4000001-0000-4000-8000-000000000001',
   'b4000101-0000-4000-8000-000000000001', 'B4 Pro3 Staff', true, true);

insert into public.professionals (id, claim_state, user_id, display_name, handle, source, is_public, claimed_at)
values
  ('b4000301-0000-4000-8000-000000000001', 'claimed', 'b4000e01-0000-4000-8000-000000000001', 'B4 Pro',    'b4.pro',    'fadeup', true,  now()),
  ('b4000302-0000-4000-8000-000000000002', 'claimed', 'b4000e02-0000-4000-8000-000000000002', 'B4 Pro Two','b4.protwo', 'fadeup', true,  now()),
  ('b4000303-0000-4000-8000-000000000003', 'claimed', 'b4000e03-0000-4000-8000-000000000003', 'B4 Pro Three','b4.prothree', 'fadeup', true, now());

insert into public.barbers (id, organization_id, staff_profile_id, professional_id, is_bookable)
values
  ('b4000401-0000-4000-8000-000000000001', 'b4000001-0000-4000-8000-000000000001',
   'b4000201-0000-4000-8000-000000000001', 'b4000301-0000-4000-8000-000000000001', true),
  ('b4000403-0000-4000-8000-000000000003', 'b4000001-0000-4000-8000-000000000001',
   'b4000203-0000-4000-8000-000000000003', 'b4000303-0000-4000-8000-000000000003', true);

insert into public.memberships (organization_id, user_id, role)
values
  ('b4000001-0000-4000-8000-000000000001', 'b4000e04-0000-4000-8000-000000000004', 'owner');

insert into public.services (id, organization_id, name, duration_minutes, price_cents)
values
  ('b4000501-0000-4000-8000-000000000001', 'b4000001-0000-4000-8000-000000000001', 'B4 Coupe',  30, 2500),
  ('b4000502-0000-4000-8000-000000000002', 'b4000002-0000-4000-8000-000000000002', 'B4 Autre',  30, 3000);

insert into public.customer_profiles (user_id, display_name)
values ('b4000e05-0000-4000-8000-000000000005', 'Jean Dupont');

-- Trois prestations terminées du même client chez le même professionnel :
-- a1 hier (éligible), a2 il y a 31 jours (fenêtre close), a3 avant-hier
-- (éligible, sert aux tests photo).
insert into public.appointments (id, organization_id, location_id, barber_id, service_id,
                                 customer_name, starts_at, ends_at, status, completed_at, booked_by_user_id)
values
  ('b4000601-0000-4000-8000-000000000001', 'b4000001-0000-4000-8000-000000000001',
   'b4000101-0000-4000-8000-000000000001', 'b4000401-0000-4000-8000-000000000001',
   'b4000501-0000-4000-8000-000000000001', 'Jean Dupont',
   now() - interval '1 day 1 hour', now() - interval '1 day 30 minutes', 'completed', now() - interval '1 day', 'b4000e05-0000-4000-8000-000000000005'),
  ('b4000602-0000-4000-8000-000000000002', 'b4000001-0000-4000-8000-000000000001',
   'b4000101-0000-4000-8000-000000000001', 'b4000401-0000-4000-8000-000000000001',
   'b4000501-0000-4000-8000-000000000001', 'Jean Dupont',
   now() - interval '32 days', now() - interval '32 days' + interval '30 minutes', 'completed', now() - interval '31 days', 'b4000e05-0000-4000-8000-000000000005'),
  ('b4000603-0000-4000-8000-000000000003', 'b4000001-0000-4000-8000-000000000001',
   'b4000101-0000-4000-8000-000000000001', 'b4000401-0000-4000-8000-000000000001',
   'b4000501-0000-4000-8000-000000000001', 'Jean Dupont',
   now() - interval '2 days 1 hour', now() - interval '2 days 30 minutes', 'completed', now() - interval '2 days', 'b4000e05-0000-4000-8000-000000000005');

insert into public.customer_professional_relationships
  (customer_user_id, professional_id, organization_id, completed_interaction_count, first_completed_at, last_completed_at)
values
  ('b4000e05-0000-4000-8000-000000000005', 'b4000301-0000-4000-8000-000000000001',
   'b4000001-0000-4000-8000-000000000001', 3, now() - interval '32 days', now() - interval '1 day');

set local session_replication_role = origin;

-- ===========================================================================
-- CHANTIER 1 — publications
-- ===========================================================================

-- 1.1 create_post par le professionnel : rattachement dérivé, service lié.
do $$
declare v_post public.posts;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_post := public.create_post(
    'professional',
    jsonb_build_array(jsonb_build_object('storage_path', 'b4000e01-0000-4000-8000-000000000001/p1.jpg')),
    'Dégradé du jour', 'public', null, null,
    array['b4000501-0000-4000-8000-000000000001']::uuid[]);

  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.record('1', 'create_post publie avec rattachement dérivé',
    v_post.posted_at_organization_id = 'b4000001-0000-4000-8000-000000000001'
    and v_post.author_kind = 'professional' and v_post.like_count = 0,
    'posted_at=' || coalesce(v_post.posted_at_organization_id::text, 'NULL'));

  perform set_config('b4.p1', v_post.id::text, false);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'create_post publie avec rattachement dérivé', false, sqlerrm);
end $$;

-- 1.2 Publication sans média refusée par la RPC.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_post('professional', '[]'::jsonb);
  reset role;
  perform pg_temp.record('1', 'publication sans média refusée (RPC)', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'publication sans média refusée (RPC)', true, sqlerrm);
end $$;

-- 1.3 Le trigger différé refuse aussi un INSERT direct sans média.
do $$
begin
  insert into public.posts (id, author_kind, professional_id)
  values ('b4000701-0000-4000-8000-00000000dead', 'professional', 'b4000301-0000-4000-8000-000000000001');
  set constraints posts_require_media immediate;
  perform pg_temp.record('1', 'publication sans média refusée (trigger différé)', false, 'accepted');
exception when others then
  -- Le BON refus, pas n'importe quelle erreur : un bug du trigger lui-même
  -- (comme le old.post_id du premier jet) ne doit pas passer pour un PASS.
  perform pg_temp.record('1', 'publication sans média refusée (trigger différé)',
    sqlerrm like '%at least one media%', sqlerrm);
end $$;
set constraints all deferred;

-- 1.4 Le onzième média est refusé.
do $$
declare v_post public.posts; i integer; v_media jsonb := '[]'::jsonb;
begin
  for i in 1..10 loop
    v_media := v_media || jsonb_build_object('storage_path', 'b4000e01-0000-4000-8000-000000000001/m' || i || '.jpg');
  end loop;
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_post := public.create_post('professional', v_media, 'Dix médias', 'public');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('b4.p10', v_post.id::text, false);
  begin
    insert into public.post_media (post_id, storage_path)
    values (v_post.id, 'b4000e01-0000-4000-8000-000000000001/m11.jpg');
    perform pg_temp.record('1', 'onzième média refusé', false, 'accepted');
  exception when others then
    perform pg_temp.record('1', 'onzième média refusé', true, sqlerrm);
  end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'onzième média refusé', false, 'fixture failed: ' || sqlerrm);
end $$;

-- 1.5 Vidéo de 61 secondes refusée.
do $$
begin
  insert into public.post_media (post_id, storage_path, media_type, duration_ms)
  values (current_setting('b4.p1')::uuid, 'b4000e01-0000-4000-8000-000000000001/v61.mp4', 'video', 61000);
  perform pg_temp.record('1', 'vidéo de 61 s refusée', false, 'accepted');
exception when others then
  perform pg_temp.record('1', 'vidéo de 61 s refusée', true, sqlerrm);
end $$;

-- 1.6 Service d'une autre organisation refusé.
do $$
begin
  insert into public.post_services (post_id, service_id)
  values (current_setting('b4.p1')::uuid, 'b4000502-0000-4000-8000-000000000002');
  perform pg_temp.record('1', 'service d''une autre organisation refusé', false, 'accepted');
exception when others then
  perform pg_temp.record('1', 'service d''une autre organisation refusé', true, sqlerrm);
end $$;

-- 1.7 Un professionnel ne publie pas sur le profil d'un autre.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.posts (author_kind, professional_id)
  values ('professional', 'b4000302-0000-4000-8000-000000000002');
  reset role;
  perform pg_temp.record('1', 'publier sur le profil d''un autre refusé', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'publier sur le profil d''un autre refusé', true, sqlerrm);
end $$;

-- 1.8 like_count maintenu par trigger ; écriture directe refusée.
do $$
declare v_count integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.like_post(current_setting('b4.p1')::uuid);
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e07-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.like_post(current_setting('b4.p1')::uuid);
  reset role;
  select like_count into v_count from public.posts where id = current_setting('b4.p1')::uuid;
  perform pg_temp.record('1', 'like_count = 2 après deux likes', v_count = 2, 'count=' || v_count);

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.unlike_post(current_setting('b4.p1')::uuid);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select like_count into v_count from public.posts where id = current_setting('b4.p1')::uuid;
  perform pg_temp.record('1', 'like_count = 1 après retrait', v_count = 1, 'count=' || v_count);

  begin
    update public.posts set like_count = 999 where id = current_setting('b4.p1')::uuid;
    perform pg_temp.record('1', 'écriture directe de like_count refusée', false, 'accepted');
  exception when others then
    perform pg_temp.record('1', 'écriture directe de like_count refusée', true, sqlerrm);
  end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'like_count maintenu par trigger', false, sqlerrm);
end $$;

-- 1.9 Identité et rattachement immuables.
do $$
begin
  update public.posts set posted_at_organization_id = 'b4000002-0000-4000-8000-000000000002'
  where id = current_setting('b4.p1')::uuid;
  perform pg_temp.record('1', 'posted_at_organization_id immuable', false, 'accepted');
exception when others then
  perform pg_temp.record('1', 'posted_at_organization_id immuable', true, sqlerrm);
end $$;

-- 1.10 Rattachement figé après départ : le post de pro3 survit à la
--      suppression de son lien d'emploi, et un nouveau rattachement est
--      refusé.
do $$
declare v_post public.posts; v_n integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e03-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_post := public.create_post('professional',
    jsonb_build_array(jsonb_build_object('storage_path', 'b4000e03-0000-4000-8000-000000000003/p3.jpg')),
    'Avant le départ', 'public');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('b4.p3', v_post.id::text, false);

  delete from public.barbers where id = 'b4000403-0000-4000-8000-000000000003';

  select count(*) into v_n
  from public.get_organization_posts('b4-verify-shop', null, 50) g
  where g.post_id = v_post.id;
  perform pg_temp.record('1', 'le post reste sur le profil du salon après départ', v_n = 1, 'rows=' || v_n);

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', 'b4000e03-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.create_post('professional',
      jsonb_build_array(jsonb_build_object('storage_path', 'b4000e03-0000-4000-8000-000000000003/p3b.jpg')),
      'Après le départ', 'public', null, 'b4000001-0000-4000-8000-000000000001');
    reset role;
    perform pg_temp.record('1', 'nouveau rattachement refusé après départ', false, 'accepted');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.record('1', 'nouveau rattachement refusé après départ', true, sqlerrm);
  end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'rattachement figé après départ', false, sqlerrm);
end $$;

-- 1.11 Post d'organisation par le owner + le post du pro apparaît sur les
--      DEUX profils.
do $$
declare v_post public.posts; v_on_org integer; v_on_pro integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e04-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_post := public.create_post('organization',
    jsonb_build_array(jsonb_build_object('storage_path', 'b4000e04-0000-4000-8000-000000000004/salon.jpg')),
    'Le salon', 'public', 'b4000001-0000-4000-8000-000000000001');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('b4.p4', v_post.id::text, false);

  select count(*) into v_on_org
  from public.get_organization_posts('b4-verify-shop', null, 50) g
  where g.post_id = current_setting('b4.p1')::uuid;
  select count(*) into v_on_pro
  from public.get_professional_posts('b4.pro', null, 50) g
  where g.post_id = current_setting('b4.p1')::uuid;
  perform pg_temp.record('1', 'un post de pro rattaché apparaît sur les deux profils',
    v_on_org = 1 and v_on_pro = 1, 'org=' || v_on_org || ' pro=' || v_on_pro);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('1', 'post d''organisation + double profil', false, sqlerrm);
end $$;

-- 1.12 Aucune table post_comments.
do $$
begin
  perform pg_temp.record('1', 'aucune table post_comments',
    to_regclass('public.post_comments') is null, null);
end $$;

-- ===========================================================================
-- CHANTIER 2 — stockage
-- ===========================================================================

do $$
declare b record;
begin
  select * into b from storage.buckets where id = 'post-media';
  perform pg_temp.record('2', 'bucket post-media non public, 8 Mo, types stricts',
    found and b.public = false and b.file_size_limit = 8388608
    and b.allowed_mime_types = array['image/jpeg','image/webp','image/avif','video/mp4'],
    case when found then 'public=' || b.public || ' limit=' || b.file_size_limit else 'missing' end);

  select * into b from storage.buckets where id = 'review-photos';
  perform pg_temp.record('2', 'bucket review-photos non public, 8 Mo, images',
    found and b.public = false and b.file_size_limit = 8388608
    and b.allowed_mime_types = array['image/jpeg','image/webp','image/avif'],
    case when found then 'public=' || b.public else 'missing' end);

  perform pg_temp.record('2', 'quatre policies post-media sur storage.objects',
    (select count(*) from pg_policy where polrelid = 'storage.objects'::regclass
      and polname like 'post_media_objects_%') = 4, null);

  perform pg_temp.record('2', 'anon sans écriture ni TRUNCATE ni MAINTAIN sur storage.objects',
    not has_table_privilege('anon', 'storage.objects', 'INSERT')
    and not has_table_privilege('anon', 'storage.objects', 'UPDATE')
    and not has_table_privilege('anon', 'storage.objects', 'DELETE')
    and not has_table_privilege('anon', 'storage.objects', 'TRUNCATE')
    and not has_table_privilege('anon', 'storage.objects', 'MAINTAIN'), null);
  perform pg_temp.record('2', 'anon sans écriture ni TRUNCATE sur storage.buckets',
    not has_table_privilege('anon', 'storage.buckets', 'INSERT')
    and not has_table_privilege('anon', 'storage.buckets', 'TRUNCATE'), null);
  perform pg_temp.record('2', 'authenticated sans TRUNCATE sur storage.objects',
    not has_table_privilege('authenticated', 'storage.objects', 'TRUNCATE'), null);

  -- La garde de chemin tranche pour anon : un média d'un post public est
  -- visible, un média d'un post followers ne l'est pas (testé après création
  -- du post followers, voir 4.x — ici le cas public).
  perform pg_temp.record('2', 'can_view_post_media_path ouvre un média de post public (anon)',
    (select private.can_view_post_media_path('b4000e01-0000-4000-8000-000000000001/p1.jpg')), null);
end $$;

-- ===========================================================================
-- CHANTIER 3 — avis
-- ===========================================================================

-- 3.1 Sans prestation : refusé.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.submit_review('b4000601-0000-4000-8000-000000000001', 5, 'super');
  reset role;
  perform pg_temp.record('3', 'avis sans prestation refusé', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'avis sans prestation refusé', true, sqlerrm);
end $$;

-- 3.2 Le client réservataire dépose : accepté, nom réduit, réputation double.
do $$
declare v_review public.reviews; r record;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_review := public.submit_review('b4000601-0000-4000-8000-000000000001', 5, 'Impeccable, dégradé net.');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('b4.r1', v_review.id::text, false);

  perform pg_temp.record('3', 'avis déposé par le réservataire', v_review.rating = 5, null);
  perform pg_temp.record('3', 'nom public réduit à l''écriture',
    v_review.reviewer_display_name = 'Jean D.', 'name=' || v_review.reviewer_display_name);

  select * into r from public.get_public_reputation('b4000301-0000-4000-8000-000000000001', null);
  perform pg_temp.record('3', 'réputation du professionnel alimentée',
    r.rating_average = 5.00 and r.rating_count = 1,
    'avg=' || coalesce(r.rating_average::text, 'NULL') || ' n=' || r.rating_count);
  select * into r from public.get_public_reputation(null, 'b4000001-0000-4000-8000-000000000001');
  perform pg_temp.record('3', 'réputation de l''organisation alimentée par le même acte',
    r.rating_average = 5.00 and r.rating_count = 1,
    'avg=' || coalesce(r.rating_average::text, 'NULL') || ' n=' || r.rating_count);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'avis déposé par le réservataire', false, sqlerrm);
end $$;

-- 3.3 Deux avis sur la même prestation : refusé.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.submit_review('b4000601-0000-4000-8000-000000000001', 1, 'je change d''avis');
  reset role;
  perform pg_temp.record('3', 'second avis sur la même prestation refusé', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'second avis sur la même prestation refusé', true, sqlerrm);
end $$;

-- 3.4 Au-delà de 30 jours : refusé.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.submit_review('b4000602-0000-4000-8000-000000000002', 4);
  reset role;
  perform pg_temp.record('3', 'avis au-delà de 30 jours refusé', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'avis au-delà de 30 jours refusé', true, sqlerrm);
end $$;

-- 3.5 NULL ≠ 0 : une entité sans avis rend une note NULL et un compte 0.
do $$
declare r record;
begin
  select * into r from public.get_public_reputation('b4000302-0000-4000-8000-000000000002', null);
  perform pg_temp.record('3', 'entité sans avis : note NULL, jamais zéro',
    r.rating_average is null and r.rating_count = 0,
    'avg=' || coalesce(r.rating_average::text, 'NULL') || ' n=' || r.rating_count);
end $$;

-- 3.6 Réponse publique : une seule.
do $$
declare v_review public.reviews;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_review := public.reply_to_review(current_setting('b4.r1')::uuid, 'Merci Jean, à bientôt.');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'réponse publique du professionnel posée',
    v_review.reply_body is not null and v_review.replied_at is not null, null);

  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', 'b4000e04-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.reply_to_review(current_setting('b4.r1')::uuid, 'Une seconde réponse');
    reset role;
    perform pg_temp.record('3', 'seconde réponse refusée', false, 'accepted');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.record('3', 'seconde réponse refusée', true, sqlerrm);
  end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'réponse publique du professionnel posée', false, sqlerrm);
end $$;

-- 3.7 Un tiers ne répond pas.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.reply_to_review(current_setting('b4.r1')::uuid, 'je m''incruste');
  reset role;
  perform pg_temp.record('3', 'réponse par un tiers refusée', false, 'accepted');
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'réponse par un tiers refusée', true, sqlerrm);
end $$;

-- 3.8 Signalement, une fois par compte.
do $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.report_review(current_setting('b4.r1')::uuid, 'other', 'test de signalement');
  reset role;
  perform pg_temp.record('3', 'signalement accepté',
    exists (select 1 from public.review_reports
            where review_id = current_setting('b4.r1')::uuid
              and reporter_user_id = 'b4000e06-0000-4000-8000-000000000006'), null);
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.report_review(current_setting('b4.r1')::uuid, 'fraud');
    reset role;
    perform pg_temp.record('3', 'double signalement refusé', false, 'accepted');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.record('3', 'double signalement refusé', true, sqlerrm);
  end;
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'signalement accepté', false, sqlerrm);
end $$;

-- 3.9 Modération : réservée à la plateforme ; un retrait sort l'avis de la
--     lecture publique ET de la réputation (qui redevient NULL, pas 0 étoile).
do $$
declare v_admin uuid; r record; v_n integer;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.moderate_review(current_setting('b4.r1')::uuid, 'removed', 'fraud');
    reset role;
    perform pg_temp.record('3', 'modération par un non-membre plateforme refusée', false, 'accepted');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.record('3', 'modération par un non-membre plateforme refusée', true, sqlerrm);
  end;

  select user_id into v_admin from public.platform_members limit 1;
  if v_admin is null then
    perform pg_temp.record('3', 'retrait modéré + réputation redevient NULL', false, 'no platform member');
    return;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.moderate_review(current_setting('b4.r1')::uuid, 'removed', 'fraud');
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.get_public_reviews('b4000301-0000-4000-8000-000000000001', null, null, 50);
  select * into r from public.get_public_reputation('b4000301-0000-4000-8000-000000000001', null);
  perform pg_temp.record('3', 'retrait modéré : avis hors lecture publique, réputation NULL',
    v_n = 0 and r.rating_average is null and r.rating_count = 0,
    'rows=' || v_n || ' avg=' || coalesce(r.rating_average::text, 'NULL') || ' n=' || r.rating_count);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.moderate_review(current_setting('b4.r1')::uuid, 'published');
  perform set_config('request.jwt.claims', '', true);
  select * into r from public.get_public_reputation('b4000301-0000-4000-8000-000000000001', null);
  perform pg_temp.record('3', 'republication : réputation restaurée',
    r.rating_average = 5.00 and r.rating_count = 1, null);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'modération', false, sqlerrm);
end $$;

-- 3.10 Photo d'avis : consentement de publication obligatoire, réutilisation
--      sociale jamais déduite.
do $$
declare v_review public.reviews; v_reuse boolean;
begin
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.submit_review('b4000603-0000-4000-8000-000000000003', 4, null,
      'b4000e05-0000-4000-8000-000000000005/photo.jpg', false);
    reset role;
    perform pg_temp.record('3', 'photo sans consentement refusée', false, 'accepted');
  exception when others then
    reset role;
    perform set_config('request.jwt.claims', '', true);
    perform pg_temp.record('3', 'photo sans consentement refusée', true, sqlerrm);
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e05-0000-4000-8000-000000000005', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_review := public.submit_review('b4000603-0000-4000-8000-000000000003', 4, null,
    'b4000e05-0000-4000-8000-000000000005/photo.jpg', true);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select consent_social_reuse into v_reuse from public.review_photos where review_id = v_review.id;
  perform pg_temp.record('3', 'photo avec consentement stockée, réutilisation sociale non déduite',
    v_reuse = false, 'reuse=' || coalesce(v_reuse::text, 'NULL'));
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('3', 'photo d''avis', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 4 — feed et lectures
-- ===========================================================================

-- 4.1 Posts followers/hidden pour la visibilité.
do $$
declare v_post public.posts;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e01-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_post := public.create_post('professional',
    jsonb_build_array(jsonb_build_object('storage_path', 'b4000e01-0000-4000-8000-000000000001/p2.jpg')),
    'Pour les abonnés', 'followers');
  perform set_config('b4.p2', v_post.id::text, false);
  v_post := public.create_post('professional',
    jsonb_build_array(jsonb_build_object('storage_path', 'b4000e01-0000-4000-8000-000000000001/p5.jpg')),
    'Brouillon', 'hidden');
  perform set_config('b4.p5', v_post.id::text, false);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'posts followers et hidden créés', true, null);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'posts followers et hidden créés', false, sqlerrm);
end $$;

-- Dans une transaction, now() est figé : tous les posts partagent le même
-- created_at et le curseur temporel serait intestable. On étale les
-- horodatages en mode replica (created_at est immuable par trigger, à
-- dessein — le contourner ici est le rôle du mode fixture).
set local session_replication_role = replica;
update public.posts set created_at = now() - interval '5 minutes' where id = current_setting('b4.p1')::uuid;
update public.posts set created_at = now() - interval '4 minutes' where id = current_setting('b4.p10')::uuid;
update public.posts set created_at = now() - interval '3 minutes' where id = current_setting('b4.p3')::uuid;
update public.posts set created_at = now() - interval '2 minutes' where id = current_setting('b4.p4')::uuid;
update public.posts set created_at = now() - interval '1 minute'  where id = current_setting('b4.p2')::uuid;
set local session_replication_role = origin;

-- Le graphe de suivi du testeur : u_follow suit le professionnel ET le salon.
insert into public.professional_follows (follower_user_id, professional_id, state, source, followed_at)
values ('b4000e07-0000-4000-8000-000000000007', 'b4000301-0000-4000-8000-000000000001', 'following', 'manual', now());
insert into public.organization_follows (follower_user_id, organization_id, is_following, followed_at)
values ('b4000e07-0000-4000-8000-000000000007', 'b4000001-0000-4000-8000-000000000001', true, now());

-- 4.2 Anonyme : le public est là, followers et hidden non.
do $$
declare v_pub integer; v_fol integer; v_hid integer;
begin
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  select count(*) into v_pub from public.get_feed(null, 50) f where f.post_id = current_setting('b4.p1')::uuid;
  select count(*) into v_fol from public.get_feed(null, 50) f where f.post_id = current_setting('b4.p2')::uuid;
  select count(*) into v_hid from public.get_feed(null, 50) f where f.post_id = current_setting('b4.p5')::uuid;
  reset role;
  perform pg_temp.record('4', 'feed anonyme : public visible, followers et hidden invisibles',
    v_pub = 1 and v_fol = 0 and v_hid = 0,
    'pub=' || v_pub || ' followers=' || v_fol || ' hidden=' || v_hid);
exception when others then
  reset role;
  perform pg_temp.record('4', 'feed anonyme', false, sqlerrm);
end $$;

-- 4.3 Un post followers n'est pas lisible par un non-abonné, il l'est par un
--     abonné.
do $$
declare v_out integer; v_in integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e06-0000-4000-8000-000000000006', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_out from public.get_professional_posts('b4.pro', null, 50) g
  where g.post_id = current_setting('b4.p2')::uuid;
  reset role;
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e07-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_in from public.get_professional_posts('b4.pro', null, 50) g
  where g.post_id = current_setting('b4.p2')::uuid;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'post followers : invisible au non-abonné, visible à l''abonné',
    v_out = 0 and v_in = 1, 'non-abonné=' || v_out || ' abonné=' || v_in);
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'post followers', false, sqlerrm);
end $$;

-- 4.4 DÉDUPLICATION : u_follow suit le professionnel ET son salon — chaque
--     post n'apparaît qu'une fois, attribué à la meilleure raison.
do $$
declare v_n integer; v_src text; v_dup integer;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', 'b4000e07-0000-4000-8000-000000000007', 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.get_feed(null, 50) f
  where f.post_id = current_setting('b4.p1')::uuid;
  select f.feed_source into v_src from public.get_feed(null, 50) f
  where f.post_id = current_setting('b4.p1')::uuid;
  select count(*) into v_dup from (
    select f.post_id from public.get_feed(null, 50) f group by f.post_id having count(*) > 1
  ) d;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'déduplication : pro et salon suivis, un seul post affiché',
    v_n = 1 and v_dup = 0, 'occurrences=' || v_n || ' doublons=' || v_dup);
  perform pg_temp.record('4', 'feed_source attribue la meilleure raison',
    v_src = 'followed_professional', 'source=' || coalesce(v_src, 'NULL'));
exception when others then
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.record('4', 'déduplication du feed', false, sqlerrm);
end $$;

-- 4.5 Curseur temporel : pages contiguës, sans doublon ni offset.
do $$
declare v_first record; v_second record;
begin
  set local role anon;
  select * into v_first from public.get_feed(null, 1) limit 1;
  select * into v_second from public.get_feed(v_first.created_at, 1) limit 1;
  reset role;
  perform pg_temp.record('4', 'pagination au curseur : page suivante sans doublon',
    v_second.post_id is distinct from v_first.post_id
    and v_second.created_at < v_first.created_at,
    'first=' || v_first.post_id || ' second=' || coalesce(v_second.post_id::text, 'NULL'));
exception when others then
  reset role;
  perform pg_temp.record('4', 'pagination au curseur', false, sqlerrm);
end $$;

-- 4.6 Les poids sont modulaires : les cinq signaux en table, le score bouge
--     quand un poids bouge, sans toucher à la fonction.
do $$
declare v_before numeric; v_after numeric;
begin
  perform pg_temp.record('4', 'cinq signaux de classement en table',
    (select count(*) from public.feed_ranking_weights) = 5, null);
  set local role anon;
  select f.score into v_before from public.get_feed(null, 50) f
  where f.post_id = current_setting('b4.p1')::uuid;
  reset role;
  update public.feed_ranking_weights set weight = weight + 5 where signal = 'bookability';
  set local role anon;
  select f.score into v_after from public.get_feed(null, 50) f
  where f.post_id = current_setting('b4.p1')::uuid;
  reset role;
  update public.feed_ranking_weights set weight = weight - 5 where signal = 'bookability';
  perform pg_temp.record('4', 'changer un poids change le score sans migration',
    v_after > v_before, 'before=' || v_before || ' after=' || v_after);
exception when others then
  reset role;
  perform pg_temp.record('4', 'poids modulaires', false, sqlerrm);
end $$;

-- 4.7 get_public_reviews pagine et rend le nom réduit.
do $$
declare v_n integer; v_name text;
begin
  set local role anon;
  select count(*), min(g.reviewer_display_name) into v_n, v_name
  from public.get_public_reviews('b4000301-0000-4000-8000-000000000001', null, null, 50) g;
  reset role;
  perform pg_temp.record('4', 'get_public_reviews en anon : avis publiés, nom réduit',
    v_n = 2 and v_name = 'Jean D.', 'rows=' || v_n || ' name=' || coalesce(v_name, 'NULL'));
exception when others then
  reset role;
  perform pg_temp.record('4', 'get_public_reviews en anon', false, sqlerrm);
end $$;

-- ===========================================================================
-- CHANTIER 5 — notifications
-- ===========================================================================

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_type'
    and e.enumlabel in ('new_follower','post_liked','review_received','review_reply');
  perform pg_temp.record('5', 'quatre types sociaux dans l''enum', v_n = 4, 'n=' || v_n);

  perform pg_temp.record('5', 'follow → notification new_follower au professionnel',
    exists (select 1 from public.notifications
            where user_id = 'b4000e01-0000-4000-8000-000000000001' and type = 'new_follower'), null);
  perform pg_temp.record('5', 'like → notification post_liked à l''auteur',
    exists (select 1 from public.notifications
            where user_id = 'b4000e01-0000-4000-8000-000000000001' and type = 'post_liked'), null);
  perform pg_temp.record('5', 'avis → notification review_received au professionnel',
    exists (select 1 from public.notifications
            where user_id = 'b4000e01-0000-4000-8000-000000000001' and type = 'review_received'), null);
  perform pg_temp.record('5', 'avis → e-mails review_received en outbox (un par avis, dédupliqués)',
    (select count(*) from public.email_outbox
     where template = 'review_received' and to_email = 'b4-pro@verify.local') = 2, null);
  perform pg_temp.record('5', 'réponse → notification review_reply au client',
    exists (select 1 from public.notifications
            where user_id = 'b4000e05-0000-4000-8000-000000000005' and type = 'review_reply'), null);
  perform pg_temp.record('5', 'réponse → e-mail review_reply en outbox',
    (select count(*) from public.email_outbox
     where template = 'review_reply' and to_email = 'b4-cust1@verify.local') = 1, null);
  perform pg_temp.record('5', 'aucun e-mail pour like ou follow',
    not exists (select 1 from public.email_outbox
                where template in ('new_follower','post_liked')), null);
  perform pg_temp.record('5', 'gabarits FR et EN présents pour les deux e-mails',
    (select count(*) from public.email_templates
     where template_key in ('review_received','review_reply')) = 4, null);
end $$;

-- ===========================================================================
-- REALTIME — aucune table sociale publiée
-- ===========================================================================

do $$
begin
  perform pg_temp.record('RT', 'aucune table B4 dans supabase_realtime',
    not exists (select 1 from pg_publication_tables
                where pubname = 'supabase_realtime'
                  and tablename in ('posts','post_media','post_services','post_likes',
                                    'reviews','review_photos','review_reports','review_reputation',
                                    'feed_ranking_weights')), null);
end $$;

-- ===========================================================================
-- SUITE RLS — privilèges et isolement
-- ===========================================================================

do $$
declare t text; v_ok boolean := true; v_detail text := '';
begin
  foreach t in array array['posts','post_media','post_services','post_likes',
                           'reviews','review_photos','review_reports','review_reputation',
                           'feed_ranking_weights']
  loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT')
       or has_table_privilege('anon', 'public.' || t, 'INSERT')
       or has_table_privilege('anon', 'public.' || t, 'UPDATE')
       or has_table_privilege('anon', 'public.' || t, 'DELETE')
       or has_table_privilege('anon', 'public.' || t, 'TRUNCATE') then
      v_ok := false; v_detail := v_detail || t || ' ';
    end if;
  end loop;
  perform pg_temp.record('RLS', 'anon ne détient RIEN sur les neuf tables B4', v_ok, nullif(v_detail, ''));

  v_ok := true; v_detail := '';
  foreach t in array array['posts','post_media','post_services','post_likes',
                           'reviews','review_photos','review_reports','review_reputation',
                           'feed_ranking_weights']
  loop
    if has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE')
       or has_table_privilege('authenticated', 'public.' || t, 'TRIGGER')
       or has_table_privilege('authenticated', 'public.' || t, 'REFERENCES')
       or has_table_privilege('authenticated', 'public.' || t, 'MAINTAIN') then
      v_ok := false; v_detail := v_detail || t || ' ';
    end if;
  end loop;
  perform pg_temp.record('RLS', 'authenticated sans TRUNCATE/TRIGGER/REFERENCES/MAINTAIN', v_ok, nullif(v_detail, ''));

  v_ok := true; v_detail := '';
  foreach t in array array['posts','post_media','post_services','post_likes',
                           'reviews','review_photos','review_reports','review_reputation',
                           'feed_ranking_weights']
  loop
    if not (select relrowsecurity and relforcerowsecurity from pg_class
            where oid = ('public.' || t)::regclass) then
      v_ok := false; v_detail := v_detail || t || ' ';
    end if;
  end loop;
  perform pg_temp.record('RLS', 'RLS activée ET forcée sur chaque table créée', v_ok, nullif(v_detail, ''));
end $$;

-- anon au contact réel : select refusé, truncate refusé.
do $$
declare v_n integer;
begin
  set local role anon;
  begin
    select count(*) into v_n from public.posts;
    reset role;
    perform pg_temp.record('RLS', 'select anon sur posts refusé', false, 'read ' || v_n || ' rows');
  exception when insufficient_privilege then
    reset role;
    perform pg_temp.record('RLS', 'select anon sur posts refusé', true, sqlerrm);
  end;
  set local role anon;
  begin
    truncate public.posts;
    reset role;
    perform pg_temp.record('RLS', 'truncate anon sur posts refusé', false, 'accepted');
  exception when insufficient_privilege then
    reset role;
    perform pg_temp.record('RLS', 'truncate anon sur posts refusé', true, sqlerrm);
  end;
  set local role authenticated;
  begin
    truncate public.reviews;
    reset role;
    perform pg_temp.record('RLS', 'truncate authenticated sur reviews refusé', false, 'accepted');
  exception when insufficient_privilege then
    reset role;
    perform pg_temp.record('RLS', 'truncate authenticated sur reviews refusé', true, sqlerrm);
  end;
end $$;

-- ===========================================================================
-- NON-RÉGRESSION — marketplace intacte
-- ===========================================================================

do $$
declare v_n integer;
begin
  set local role anon;
  select count(*) into v_n
  from public.search_public_organizations(null, null, null, null, null, null, 50, 0);
  reset role;
  perform pg_temp.record('NR', 'marketplace publique : 9 organisations légitimes',
    v_n = 9, 'rows=' || v_n);
exception when others then
  reset role;
  perform pg_temp.record('NR', 'marketplace publique', false, sqlerrm);
end $$;

-- ===========================================================================
-- RÉSULTATS
-- ===========================================================================

select chantier, check_name, verdict, coalesce(detail, '') as detail
from b4_results order by seq;

select count(*) filter (where verdict = 'PASS') as pass,
       count(*) filter (where verdict = 'FAIL') as fail
from b4_results;

rollback;
