-- FadeUp — B2, chantier 1c: les alternatives après une expiration.
--
-- MASTER_SPEC §5 : « Non-réponse : "La demande n'a pas été confirmée à temps",
-- puis des alternatives proches capables d'assurer un service équivalent.
-- JAMAIS présenté comme une confirmation ni comme un no-show. »
--
-- La dernière phrase est une contrainte de langue, que les gabarits portent.
-- Celle-ci est une contrainte de données : proposer une alternative qui ne
-- peut pas servir serait un second échec après le premier, et c'est ce qui
-- décide un client à ne plus revenir.
--
-- CE QUE « CAPABLE D'ASSURER » VEUT DIRE ICI, HONNÊTEMENT
--
-- La fonction ne promet pas une disponibilité : vérifier un créneau réel chez
-- dix salons demanderait dix appels à get_public_available_slots, et une
-- réponse qui serait périmée à l'affichage. Elle promet ce qu'elle peut
-- prouver, et le DIT dans la réponse :
--
--   accepts_immediate_booking = true   l'organisation détient la capacité
--                                      `booking` : une réservation ferme est
--                                      possible, sous réserve du créneau
--   accepts_immediate_booking = false  elle recevra une DEMANDE, comme celle
--                                      qui vient d'expirer
--
-- Cette colonne existe pour que l'interface ne présente jamais un « réservez
-- ici » là où le client recevrait une seconde attente. Aujourd'hui, aucune
-- organisation de la base ne détient `booking` : la colonne vaudra false
-- partout, et c'est une information vraie, pas un défaut.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

create or replace function public.get_public_booking_alternatives(
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_service_query text default null,
  p_exclude_organization_id uuid default null,
  p_radius_km double precision default 10,
  p_limit integer default 5
)
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  marketplace_supply_type text,
  location_id uuid,
  location_name text,
  location_kind public.location_kind,
  city text,
  distance_km double precision,
  covers_search_point boolean,
  starting_price_cents integer,
  is_open_now boolean,
  accepts_immediate_booking boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.organization_id,
    s.organization_name,
    s.organization_slug,
    s.marketplace_supply_type,
    s.location_id,
    s.location_name,
    s.location_kind,
    s.city,
    s.distance_km,
    s.covers_search_point,
    s.starting_price_cents,
    s.is_open_now,
    coalesce(private.org_has_capability(s.organization_id, 'booking'), false)
  from public.search_public_professionals(
    p_service_query => nullif(btrim(coalesce(p_service_query, '')), ''),
    p_latitude      => p_latitude,
    p_longitude     => p_longitude,
    -- MASTER_SPEC §8 : 10 km par défaut en zone urbaine. Le rayon reste
    -- réglable parce qu'une expiration en zone peu dense mérite d'élargir
    -- plutôt que de rendre une liste vide.
    p_radius_km     => p_radius_km,
    -- L'offre marketplace, et rien d'autre : un barbier salarié n'est pas une
    -- alternative autonome (MASTER_SPEC §2). Le défaut corrigé par B1 le
    -- ferait déjà, mais l'écrire ici évite qu'un futur changement de défaut
    -- passe inaperçu dans cette fonction-ci.
    p_entity_type   => 'shop',
    p_sort          => 'nearest',
    -- On demande plus large que p_limit puis on filtre l'organisation
    -- d'origine : filtrer APRÈS la pagination rendrait parfois quatre
    -- alternatives au lieu de cinq, sans raison visible.
    p_limit         => greatest(p_limit, 0) + 1
  ) s
  where p_exclude_organization_id is null
     or s.organization_id <> p_exclude_organization_id
  limit greatest(p_limit, 0);
$$;

comment on function public.get_public_booking_alternatives(double precision, double precision, text, uuid, double precision, integer) is
'Anon-callable. Les alternatives proposées après l''expiration d''une demande (MASTER_SPEC §5) : établissements de l''offre marketplace, proches du point donné, offrant un service dont le nom correspond, l''organisation d''origine exclue, triés par distance.

Ne promet AUCUNE disponibilité et n''en vérifie aucune : elle retourne `accepts_immediate_booking`, qui dit si l''organisation détient la capacité `booking` et peut donc confirmer, ou si elle recevra une nouvelle demande. Une interface qui affiche « réservez ici » sur une ligne à false envoie le client vers une seconde attente juste après la première.

Un professionnel en zone de service apparaît si sa zone couvre le point cherché, avec covers_search_point = true et sans adresse inventée.';

revoke all on function public.get_public_booking_alternatives(double precision, double precision, text, uuid, double precision, integer) from public;
grant execute on function public.get_public_booking_alternatives(double precision, double precision, text, uuid, double precision, integer) to anon, authenticated, service_role;

commit;
