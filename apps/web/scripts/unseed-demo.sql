-- ============================================================================
-- FadeUp — P1c suppression du seed de démonstration (miroir de seed-demo.sql)
-- ============================================================================
-- Retire TOUT ce que seed-demo.sql a créé, et rien d'autre. Le repérage est
-- le marquage documenté : organisations `demo-%`, professionnels `demo.%`,
-- UUID préfixés `de3`. Les cascades FK (ON DELETE CASCADE sur
-- organization_id) emportent lieux, services, horaires, équipe, réglages.
--
-- EXÉCUTION — MANUELLE UNIQUEMENT :
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     < apps/web/scripts/unseed-demo.sql
-- ============================================================================

begin;

-- Garde : refuse de tourner si une activité réelle s'est accrochée aux
-- organisations de démonstration (un vrai rendez-vous, une vraie entrée en
-- file, un vrai follow) — dans ce cas, arbitrage humain obligatoire.
do $$
declare
  v_count integer;
begin
  select (select count(*) from public.appointments a join public.organizations o on o.id = a.organization_id and o.slug like 'demo-%')
       + (select count(*) from public.queue_entries q join public.organizations o on o.id = q.organization_id and o.slug like 'demo-%')
       + (select count(*) from public.professional_follows f join public.professionals p on p.id = f.professional_id and p.handle like 'demo.%')
       + (select count(*) from public.organization_follows f join public.organizations o on o.id = f.organization_id and o.slug like 'demo-%')
    into v_count;
  if v_count > 0 then
    raise exception 'unseed-demo: % ligne(s) d''activité RÉELLE rattachée(s) aux organisations de démonstration — suppression refusée, arbitrer manuellement', v_count;
  end if;
end $$;

-- L'historique commercial est append-only par conception
-- (commercial_plan_changes_append_only) : la cascade de suppression des
-- organisations serait refusée. La désactivation est LOCALE à cette
-- transaction, uniquement pour purger l'historique des organisations de
-- démonstration — jamais celui d'une organisation réelle.
alter table public.commercial_plan_changes disable trigger commercial_plan_changes_append_only;
delete from public.commercial_plan_changes cpc
using public.organizations o
where o.id = cpc.organization_id and o.slug like 'demo-%' and o.id::text like 'de3%';
alter table public.commercial_plan_changes enable trigger commercial_plan_changes_append_only;

-- Organisations (cascade : locations, location_hours, location_service_settings,
-- services, service_locations, staff_profiles, barbers, barber_services,
-- barber_working_hours, organization_commercial_state).
delete from public.organizations where slug like 'demo-%' and id::text like 'de3%';

-- Identités professionnelles de démonstration (non référencées après cascade).
delete from public.professionals where handle like 'demo.%' and id::text like 'de3%' and claim_state = 'unclaimed';

do $$
begin
  raise notice 'unseed-demo: OK — organisations demo-%% et professionnels demo.%% supprimés.';
end $$;

commit;
