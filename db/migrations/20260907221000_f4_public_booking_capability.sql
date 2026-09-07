-- F4 — `get_public_booking_capability` : le récapitulatif du tunnel doit dire
-- AVANT le geste si le client CONFIRME un rendez-vous ou ENVOIE une demande
-- (F4 §3 : « Le client doit savoir qu'il envoie une demande » — la loi vaut
-- avant l'envoi, pas seulement après). Aucune RPC publique n'exposait cette
-- information ; B2 l'expose déjà pour les organisations VOISINES
-- (`get_public_booking_alternatives.accepts_immediate_booking`) — celle-ci
-- répond la même question pour l'organisation qu'on regarde. Le nom du champ
-- est repris à l'identique : un seul vocabulaire.
--
-- Purement additive. À APPLIQUER EN postgres.
-- Invariant X3 (règle 4) : grants EXPLICITES, et la RPC est ajoutée à
-- l'allowlist de `db/tests/x3_anon_surface.sh` et à la sonde
-- `db/tests/probe_public_rpcs.sh` dans le même commit.

begin;

create or replace function public.get_public_booking_capability(p_organization_slug text)
returns table(accepts_immediate_booking boolean)
language sql
stable
security definer
set search_path to ''
as $function$
  -- Même prédicat que get_public_organization (le slug seul) : le tunnel les
  -- appelle ensemble et les deux doivent voir le même monde. Une organisation
  -- inconnue rend ZÉRO ligne — ce que get_public_organization révèle déjà.
  select private.org_has_capability(o.id, 'booking')
  from public.organizations o
  where o.slug = p_organization_slug;
$function$;

revoke all on function public.get_public_booking_capability(text) from public;
grant execute on function public.get_public_booking_capability(text) to anon, authenticated, service_role;

comment on function public.get_public_booking_capability(text) is
  'F4 — le tunnel annonce avant le geste : confirmation immédiate ou demande. '
  'Même sémantique que get_public_booking_alternatives.accepts_immediate_booking.';

commit;
