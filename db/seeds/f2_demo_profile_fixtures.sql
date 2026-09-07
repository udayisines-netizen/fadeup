-- ============================================================================
-- F2 — Fixtures de démonstration des profils publics
-- ============================================================================
--
-- Le jeu de démonstration B1 a créé HUIT identités professionnelles
-- (`demo.*`) et HUIT profils staff dans les organisations `demo-*`, mais ne
-- les a jamais reliés (barbers.professional_id NULL partout) ni publiés
-- (is_public = false partout). Résultat mesuré le 2026-09-07 : AUCUN
-- professionnel de la base n'est résoluble par /pro/:handle — les deux écrans
-- de F2 n'auraient aucune donnée réelle à montrer.
--
-- Ce seed relie et publie QUATRE identités du jeu de démonstration, pour
-- couvrir les quatre cas produits de F2 :
--
--   1. demo.kais.bellamine — REVENDIQUÉ, salarié de Maison Kaïs (barbershop) :
--      le cas « Travaille chez [Salon] » + RÉSERVER + file F1.
--   2. demo.fadel — REVENDIQUÉ, indépendant (Atelier Fadel, solo) :
--      le cas « profil pro et profil public fusionnés ».
--   3. demo.moussa.diakite — NON REVENDIQUÉ, rattaché à Barber Corner :
--      le cas de lancement (badge neutre, chemin de revendication,
--      aucune métrique fabriquée). Le rattachement sert d'ancre de
--      publication (private.professional_publication_anchor) mais n'est PAS
--      exposé publiquement (décision B1 : le lien staff<->identité n'est
--      public qu'après revendication).
--   4. demo.sofian.cuts — NON REVENDIQUÉ, barbier à domicile (zone de
--      service) : le cas mobile, aucune adresse.
--
-- HONNÊTETÉ SUR LA REVENDICATION : ce seed pose l'ÉTAT FINAL du cycle de
-- claim (user_id + claimed_at + claim_state, contraintes
-- professionals_claim_state_matches_user/_timestamp respectées) en levant le
-- garde par le GUC `fadeup.professional_claim_write` — le même mécanisme que
-- le cycle réel, mais SANS passer par submit_professional_claim →
-- review_professional_claim. C'est un contournement de fixture, assumé et
-- limité aux deux identités démo ci-dessous.
--
-- DEUX COMPTES AUTH SONT CRÉÉS : qa-f2-kais@fadeup.test et
-- qa-f2-fadel@fadeup.test — porteurs des deux revendications, VERROUILLÉS :
-- leur mot de passe est un aléa jeté à la création (personne ne peut se
-- connecter ; un lot futur qui en aurait besoin le réinitialise par l'API
-- admin GoTrue). Aucun secret ne vit dans ce fichier. Colonnes token à ''
-- (un NULL fait échouer GoTrue sur /token).
--
-- Idempotent : rejouable sans effet au-delà du premier passage.
-- Seed de DONNÉES DE DÉMONSTRATION, exécuté volontairement en production
-- (supabase_admin) — contrairement à marketplace_demo.sql, c'est son usage.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Les deux comptes auth des identités revendiquées.
-- ----------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, phone_change, phone_change_token, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
)
select
  '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated',
  -- Mot de passe ALÉATOIRE, jeté : les comptes existent pour porter la
  -- revendication (FK), pas pour se connecter.
  v.email, extensions.crypt(gen_random_uuid()::text || gen_random_uuid()::text, extensions.gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '', '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false
from (values
  ('f2000000-0000-4000-8000-000000000001'::uuid, 'qa-f2-kais@fadeup.test'),
  ('f2000000-0000-4000-8000-000000000002'::uuid, 'qa-f2-fadel@fadeup.test')
) as v(id, email)
where not exists (select 1 from auth.users u where u.email = v.email);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(), u.id, u.id::text,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email in ('qa-f2-kais@fadeup.test', 'qa-f2-fadel@fadeup.test')
  and not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email');

-- ----------------------------------------------------------------------------
-- 1. Rattacher les quatre barbers démo à leur identité professionnelle.
--    (UPDATE direct : le trigger d'assignation ne s'exerce qu'à l'INSERT ;
--    l'ancre de publication accepte ce rattachement quel que soit le claim.)
-- ----------------------------------------------------------------------------
update public.barbers b
set professional_id = v.professional_id
from (values
  ('de300601-0000-4000-8000-000000000001'::uuid, 'de300401-0000-4000-8000-000000000001'::uuid), -- Maison Kaïs   -> demo.kais.bellamine
  ('de300604-0000-4000-8000-000000000004'::uuid, 'de300404-0000-4000-8000-000000000004'::uuid), -- Atelier Fadel -> demo.fadel
  ('de300606-0000-4000-8000-000000000006'::uuid, 'de300406-0000-4000-8000-000000000006'::uuid), -- Barber Corner -> demo.moussa.diakite
  ('de300605-0000-4000-8000-000000000005'::uuid, 'de300405-0000-4000-8000-000000000005'::uuid)  -- Sofian Cuts   -> demo.sofian.cuts
) as v(barber_id, professional_id)
where b.id = v.barber_id
  and b.professional_id is distinct from v.professional_id;

-- ----------------------------------------------------------------------------
-- 2. Revendiquer Kaïs et Fadel — le vrai cycle de vie, pas un contournement.
-- ----------------------------------------------------------------------------
do $$
begin
  perform set_config('fadeup.professional_claim_write', 'on', true);

  update public.professionals
  set claim_state = 'claimed',
      user_id     = 'f2000000-0000-4000-8000-000000000001',
      claimed_at  = now(),
      is_public   = true
  where id = 'de300401-0000-4000-8000-000000000001'
    and claim_state = 'unclaimed';

  update public.professionals
  set claim_state = 'claimed',
      user_id     = 'f2000000-0000-4000-8000-000000000002',
      claimed_at  = now(),
      is_public   = true
  where id = 'de300404-0000-4000-8000-000000000004'
    and claim_state = 'unclaimed';

  perform set_config('fadeup.professional_claim_write', 'off', true);
end $$;

-- ----------------------------------------------------------------------------
-- 3. Publier Moussa et Sofian, NON revendiqués — le cas de lancement.
--    Le guard exige une ancre : le rattachement du §1 la fournit.
-- ----------------------------------------------------------------------------
update public.professionals
set is_public = true
where id in (
  'de300406-0000-4000-8000-000000000006',  -- demo.moussa.diakite
  'de300405-0000-4000-8000-000000000005'   -- demo.sofian.cuts
)
and not is_public;

-- ----------------------------------------------------------------------------
-- 4. Le salon vitrine est RÉELLEMENT réservable.
--
-- Toutes les organisations démo étaient en Free : aucune n'acceptait ni
-- réservation ni file — le CTA du profil public n'aurait jamais montré son
-- état actif sur données réelles. Maison Kaïs reçoit un plan ACCORDÉ
-- (salon_essential, entitlement_source='early_access' — le mécanisme même du
-- seed B1, aucun paiement, aucun objet Stripe), tracé dans le journal
-- append-only, et sa file est ouverte. Réversible par le chemin inverse.
-- ----------------------------------------------------------------------------
update public.organization_commercial_state
set plan_key = 'salon_essential', status = 'active', entitlement_source = 'early_access',
    assigned_at = now(),
    assignment_note = 'F2 — salon vitrine des profils publics : plan accordé (booking + walkIns), aucun paiement'
where organization_id = 'de300001-0000-4000-8000-000000000001'
  and plan_key = 'free';

insert into public.commercial_plan_changes
  (organization_id, previous_plan_key, new_plan_key, previous_status, new_status,
   entitlement_source, changed_by, change_reason)
select 'de300001-0000-4000-8000-000000000001', 'free', 'salon_essential', 'active', 'active',
       'early_access', null,
       'F2 demo showcase — granted plan so the flagship demo shop is truly bookable'
where not exists (
  select 1 from public.commercial_plan_changes
  where organization_id = 'de300001-0000-4000-8000-000000000001'
    and new_plan_key = 'salon_essential'
    and change_reason like 'F2 demo showcase%'
);

update public.location_service_settings
set queue_open = true
where location_id = 'de300101-0000-4000-8000-000000000001'
  and not queue_open;

-- ----------------------------------------------------------------------------
-- 5. Constat de sortie.
-- ----------------------------------------------------------------------------
do $$
declare
  v_public integer;
  v_linked integer;
begin
  select count(*) into v_public from public.professionals where handle like 'demo.%' and is_public;
  select count(*) into v_linked from public.barbers where professional_id in (
    select id from public.professionals where handle like 'demo.%');
  raise notice 'F2 fixtures: % identités demo.* publiques (attendu 4), % barbers démo rattachés (attendu 4)', v_public, v_linked;
end $$;

commit;
