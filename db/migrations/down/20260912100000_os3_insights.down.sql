-- FadeUp — OS-3 : retour arrière des insights.
--
-- OS-3 n'a REDÉFINI aucune fonction existante : les quatre objets ci-dessous
-- sont neufs, et les retirer rend l'état d'avant à l'identique. Aucune ACL à
-- re-matérialiser, aucune fonction à restaurer verbatim.

begin;

drop function if exists public.get_organization_duration_gaps(uuid, uuid);
drop function if exists public.get_organization_insights(uuid, timestamptz, timestamptz);
drop function if exists private.organization_delivered_in_window(uuid, timestamptz, timestamptz);
drop function if exists private.insights_window(timestamptz, timestamptz);

commit;
