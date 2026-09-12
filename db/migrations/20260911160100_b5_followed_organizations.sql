-- B5 — chantier 2 : les noms des salons suivis.
--
-- À APPLIQUER EN postgres (public.list_my_followed_organizations appartient à
-- postgres — proowner vérifié, doctrine DB_OWNERSHIP §2 règle 2).
--
-- LE MANQUE : la RPC ne rendait que (organization_id, followed_at). L'écran
-- compte de M1b ne pouvait donc afficher qu'un COMPTEUR — « 3 salons suivis »
-- — plutôt qu'une liste, parce qu'afficher des UUID est absurde et qu'une
-- résolution N+1 côté client aurait été pire (M1b §11).
--
-- CE QUI EST AJOUTÉ, ET POURQUOI PAS PLUS. Trois colonnes, choisies parce que
-- chacune est DÉJÀ publique pour n'importe qui, anonyme compris :
--   organization_name, organization_slug  get_public_organization(slug) les
--                                         rend en anon, sans filtre de
--                                         visibilité (mesuré).
--   city                                  list_public_locations(slug) rend
--                                         l'adresse COMPLÈTE en anon
--                                         (address_line1/2, city, region,
--                                         postal_code, country), sans filtre
--                                         de visibilité non plus. La ville
--                                         est donc un sous-ensemble strict.
-- Rien d'autre n'est ajouté. En particulier PAS d'image : il n'existe aucune
-- colonne d'imagerie d'établissement en base (manque hérité de D1 §13.1,
-- toujours ouvert) — les bannières de démonstration vivent dans un registre
-- de fichiers côté web, pas dans le schéma. Inventer une colonne ici serait
-- élargir le lot ; rendre un chemin qui n'existe pas serait un mensonge.
--
-- LA LOCALISATION CHOISIE : la plus ancienne localisation ACTIVE de
-- l'organisation (order by created_at, id — déterministe même à égalité).
-- Une organisation multi-établissements en a plusieurs ; une ligne
-- d'abonnement en affiche une. Le choix est explicite et documenté plutôt
-- qu'arbitraire, et left join : une organisation sans localisation active
-- rend city NULL, jamais une ligne manquante.
--
-- CE QUI NE CHANGE PAS : le filtre exists(get_public_organization(o.slug))
-- est conservé tel quel. Il est aujourd'hui un no-op (la fonction n'applique
-- aucun filtre), mais il porte une INTENTION — « seulement les organisations
-- qui ont un profil public » — qui redeviendra effective si cette fonction
-- gagne un jour un filtre. Le retirer serait une décision silencieuse.
--
-- LE MOTIF NUL : le rejet `v_user_id is null` en tête est conservé mot pour
-- mot (X3 §1, motif sûr dominant). Un appelant anonyme reçoit 42501, jamais
-- une liste vide qui ressemblerait à « vous ne suivez personne ».
--
-- ACL : le type de retour change, donc DROP + CREATE (CREATE OR REPLACE ne
-- peut pas changer les paramètres OUT). Un DROP emporte l'ACL — les grants
-- sont donc REMATÉRIALISÉS explicitement ci-dessous, à l'identique de l'ACL
-- mesurée avant migration : postgres=X/postgres, service_role=X/postgres,
-- authenticated=X/postgres. AUCUN grant anon : le contrat de surface
-- x3_anon_surface.sh reste inchangé (41 RPC), aucune dérive à déclarer.
--
-- list_my_followed_professionals : VÉRIFIÉE, non modifiée. Elle rend déjà
-- (id, display_name, handle, headline, avatar_url, followed_at) — le même
-- défaut ne s'y trouve pas. Voir le rapport B5 §4 pour la seule divergence
-- mesurée (absence volontaire de filtre is_public, décision B4 assumée et
-- documentée dans le COMMENT de la fonction), laissée intacte : revenir
-- dessus serait défaire une décision d'un autre lot sans mandat.

begin;

drop function if exists public.list_my_followed_organizations();

create function public.list_my_followed_organizations()
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  city text,
  country_code text,
  followed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();

  if v_user_id is null then
    raise exception 'authentication required'
      using errcode = '42501';
  end if;

  return query
  select
    f.organization_id,
    o.name,
    o.slug,
    loc.city,
    o.country_code,
    f.followed_at
  from public.organization_follows f
  join public.organizations o
    on o.id = f.organization_id
  left join lateral (
    select l.city
    from public.locations l
    where l.organization_id = o.id
      and l.is_active
    order by l.created_at, l.id
    limit 1
  ) loc on true
  where f.follower_user_id = v_user_id
    and f.is_following = true
    and exists (
      select 1
      from public.get_public_organization(o.slug::text)
    )
  order by f.followed_at desc nulls last;
end;
$$;

comment on function public.list_my_followed_organizations() is
  'Authentifié uniquement. Les abonnements actifs de l''appelant, résolus en lignes affichables. AUCUN paramètre : l''abonné est toujours auth.uid(), il n''y a rien à forger. N''expose que ce qu''un profil public expose déjà en anonyme — nom et slug (get_public_organization), ville (list_public_locations rend l''adresse complète) — et rien de plus : ni nombre d''abonnés, ni état commercial, ni visibilité marketplace, ni imagerie (aucune colonne d''imagerie d''établissement n''existe en base, manque D1 §13.1). La ville est celle de la plus ancienne localisation ACTIVE (déterministe) ; NULL si l''organisation n''en a aucune.';

grant execute on function public.list_my_followed_organizations() to authenticated;
grant execute on function public.list_my_followed_organizations() to service_role;

commit;
