-- X3 — Chantier 2b : retrait d'EXECUTE là où aucun usage légitime n'existe.
--
-- À APPLIQUER EN supabase_admin (fonctions possédées par postgres ET par
-- supabase_admin ; le superuser révoque en tant que propriétaire de chacune).
--
-- 1. Schéma private : EXECUTE PUBLIC retiré partout. Les grants explicites
--    (authenticated sur has_org_role & co, prospect_worker, postgres) sont
--    conservés — ce sont eux, désormais, la seule porte d'entrée. 17
--    fonctions avaient une ACL NULL (EXECUTE PUBLIC implicite du défaut
--    PostgreSQL) : la révocation matérialise leur ACL sans PUBLIC.
-- 2. Fonctions trigger de public et private : EXECUTE retiré à PUBLIC, anon
--    et authenticated. Le déclenchement d'un trigger ne vérifie pas EXECUTE
--    (contrôlé au CREATE TRIGGER) — vérifié par la campagne e2e après
--    application.
-- 3. Les trois utilitaires publics qui portaient un EXECUTE PUBLIC explicite
--    (normalize_phone_number, suggested_currency_for_country,
--    suggested_timezone_for_country) le perdent ; leurs grants explicites
--    anon/authenticated/service_role restent (le front les appelle en RPC),
--    et tous leurs appelants SQL sont SECURITY DEFINER.

begin;

revoke execute on all functions in schema private from public;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

revoke execute on function public.normalize_phone_number(p_raw text, p_country text) from public;
revoke execute on function public.suggested_currency_for_country(p_country_code text) from public;
revoke execute on function public.suggested_timezone_for_country(p_country_code text) from public;

commit;
