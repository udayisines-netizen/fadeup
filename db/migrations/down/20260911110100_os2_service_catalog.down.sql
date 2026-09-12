-- Retour arrière — OS-2 catalogue de services.
-- Rôle : postgres. Les colonnes retirées ne portent que des métadonnées
-- créées par OS-2 ; aucun service, aucun prix, aucun historique n'est touché.
-- Un service laissé « brouillon » (price_pending) redevient simplement un
-- service inactif à 0 — état déjà représentable avant OS-2.
begin;

drop function if exists public.create_service_category(uuid, text);
drop function if exists public.set_service_barbers(uuid, uuid[]);
drop function if exists public.delete_service(uuid);
drop function if exists public.restore_service(uuid);
drop function if exists public.archive_service(uuid);
drop function if exists public.set_service_price(uuid, integer);
drop function if exists public.update_service(uuid, text, integer, text, uuid, integer);
drop function if exists public.create_service(uuid, text, integer, integer, text, uuid, uuid[]);
drop function if exists private.assert_catalog_author(uuid, integer);
drop function if exists public.list_organization_services(uuid, boolean);

alter table public.services drop constraint if exists services_pending_price_not_active;
drop index if exists public.services_org_active_idx;
alter table public.services
  drop column if exists price_pending,
  drop column if exists archived_at;

commit;
