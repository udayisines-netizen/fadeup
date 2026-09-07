-- ============================================================================
-- F2 — Contrats de lecture des profils publics
-- ============================================================================
--
-- F2 construit /pro/:handle et /shop/:slug. Trois lectures manquent au
-- contrat public, constatées contre la base de production le 2026-09-07 :
--
--   1. get_public_professional_workplace — AUCUNE RPC ne résout un handle vers
--      son lieu de travail. `get_public_professional_by_handle` rend l'identité
--      portable seule ; `get_public_barber` exige (slug, barber_id) que le
--      visiteur d'un lien partagé /pro/:handle ne possède pas. Sans cette
--      résolution inverse, « Travaille chez [Salon] », le CTA RÉSERVER (état
--      réel par get_public_service_state) et les services sont inconstructibles
--      depuis une URL partageable — la hiérarchie du MASTER_SPEC §9 exige les
--      trois.
--
--   2. list_public_location_hours — `location_hours` existe (R1A) mais sa seule
--      policy SELECT est réservée aux membres de l'organisation : `anon` reçoit
--      zéro ligne. Le profil salon exige « semaine plus état ouvert ou fermé
--      maintenant » (MASTER_SPEC §9) ; la recherche calcule déjà is_open_now à
--      partir de ces lignes, elles sont donc déjà publiées indirectement.
--
--   3. get_public_organization_follower_count — « Abonnés : public »
--      (MASTER_SPEC §9) et le graphe `organization_follows` existent, mais
--      aucun contrat ne porte le compte côté salon (le côté professionnel l'a
--      via private.professional_follower_count depuis B1). Sans lui, le profil
--      salon afficherait « — » pour une donnée qui existe — un état vide
--      mensonger, l'inverse de la loi produit.
--
-- Tout est ADDITIF : trois fonctions nouvelles, aucune table, aucune colonne,
-- aucune fonction existante modifiée. Lecture seule (STABLE, aucune écriture —
-- la classe d'erreur du 405 de B1 est connue). ACL calquées sur les lectures
-- publiques existantes : EXECUTE à anon/authenticated/service_role, PUBLIC
-- révoqué (leçon F1b : le défaut PostgreSQL accorde EXECUTE à PUBLIC).
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. La résolution inverse : professionnel -> lieu de travail public.
--
-- Miroir exact de la décision B1 dans get_public_barber : le lien
-- staff <-> identité professionnelle n'est public QUE pour une identité
-- revendiquée (get_public_barber rend professional_id NULL sinon). La
-- résolution inverse respecte la même frontière — un profil non revendiqué
-- ne publie pas d'employeur, il n'a d'ailleurs jamais confirmé y travailler.
--
-- Les prédicats de visibilité sont ceux de get_public_barber :
-- b.is_bookable, sp.is_active, sp.is_public — plus p.is_public (la porte de
-- publication de l'identité elle-même, R1B/B1).
--
-- TABLE (et pas une ligne unique) : rien dans le schéma n'interdit à une
-- identité revendiquée plusieurs rattachements. Le front prend le premier
-- (le plus ancien) comme rattachement principal.
-- ----------------------------------------------------------------------------
create or replace function public.get_public_professional_workplace(p_professional_id uuid)
returns table(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  marketplace_supply_type text,
  barber_id uuid,
  location_id uuid,
  location_name text
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    o.id,
    o.name,
    o.slug,
    -- LE mapping, copié à l'identique de search_public_professionals (B1) :
    -- énuméré valeur par valeur, un type ajouté plus tard rend NULL.
    case o.business_type
      when 'solo_professional' then 'independent'
      when 'barbershop'        then 'barbershop'
      when 'hair_salon'        then 'barbershop'
      when 'mixed_salon'       then 'barbershop'
      when 'multi_location'    then 'barbershop'
      else null
    end::text,
    b.id,
    sp.location_id,
    l.name
  from public.barbers b
  join public.professionals p on p.id = b.professional_id
  join public.organizations o on o.id = b.organization_id
  join public.staff_profiles sp on sp.id = b.staff_profile_id
  left join public.locations l on l.id = sp.location_id and l.is_active
  where b.professional_id = p_professional_id
    and p.claim_state = 'claimed'
    and p.is_public
    and b.is_bookable
    and sp.is_active
    and sp.is_public
  order by b.created_at;
$$;

comment on function public.get_public_professional_workplace(uuid) is
  'F2 — resolves a public, claimed professional identity to its public workplace(s): the reverse of list_public_organization_barbers.professional_id. Unclaimed identities resolve to zero rows, mirroring get_public_barber''s NULL professional_id (the staff<->identity link is public only after claim).';

revoke all on function public.get_public_professional_workplace(uuid) from public;
grant execute on function public.get_public_professional_workplace(uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Les horaires publics d'un lieu.
--
-- Lignes brutes de la semaine (0 = dimanche, convention de la table) ; le
-- front calcule « ouvert maintenant » dans le fuseau du lieu
-- (locations.timezone, déjà public via list_public_locations). Aucune ligne
-- pour un lieu inactif ou une organisation inconnue. Les deux intervalles
-- (coupure du midi) sont exposés tels quels.
-- ----------------------------------------------------------------------------
create or replace function public.list_public_location_hours(
  p_organization_slug text,
  p_location_id uuid
)
returns table(
  day_of_week smallint,
  is_closed boolean,
  open_time time,
  close_time time,
  second_open_time time,
  second_close_time time
)
language sql
stable
security definer
set search_path to ''
as $$
  select
    h.day_of_week,
    h.is_closed,
    h.open_time,
    h.close_time,
    h.second_open_time,
    h.second_close_time
  from public.location_hours h
  join public.locations l on l.id = h.location_id and l.is_active
  join public.organizations o on o.id = h.organization_id
  where o.slug = p_organization_slug
    and h.location_id = p_location_id
  order by h.day_of_week;
$$;

comment on function public.list_public_location_hours(text, uuid) is
  'F2 — public weekly opening hours of an active location. The search RPCs already derive is_open_now from these rows; this exposes the week itself for the shop profile (MASTER_SPEC §9: week plus open/closed now, in the location timezone).';

revoke all on function public.list_public_location_hours(text, uuid) from public;
grant execute on function public.list_public_location_hours(text, uuid) to anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Le compte d'abonnés d'une organisation.
--
-- Jumelle de private.professional_follower_count (B1) : même plafond à 10 000
-- (le COUNT ne balaie jamais une table entière au service d'un profil), même
-- sémantique (les seuls suivis actifs). organization_follows porte
-- is_following (booléen), pas l'enum state de professional_follows.
-- ----------------------------------------------------------------------------
create or replace function public.get_public_organization_follower_count(p_organization_id uuid)
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select count(*)::integer
  from (
    select 1
    from public.organization_follows f
    where f.organization_id = p_organization_id
      and f.is_following
    limit 10000
  ) capped;
$$;

comment on function public.get_public_organization_follower_count(uuid) is
  'F2 — public follower count of an organization, capped at 10000 like private.professional_follower_count. Followers are public by product law (MASTER_SPEC §9); the professional side has carried this since B1, the organization side gets it here.';

revoke all on function public.get_public_organization_follower_count(uuid) from public;
grant execute on function public.get_public_organization_follower_count(uuid) to anon, authenticated, service_role;

commit;
