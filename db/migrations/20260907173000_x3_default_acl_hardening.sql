-- X3 — Chantier 2c : durcissement des privilèges PAR DÉFAUT.
-- Sans cette migration, les révocations des deux précédentes se
-- réappliqueraient à l'envers : chaque nouvelle table de public/storage
-- renaîtrait avec arwdDxtm pour anon/authenticated, chaque nouvelle fonction
-- de public avec EXECUTE anon/authenticated, chaque nouvelle fonction de
-- private avec EXECUTE PUBLIC (défaut PostgreSQL, aucune entrée
-- pg_default_acl n'existait pour private).
--
-- À APPLIQUER EN supabase_admin (FOR ROLE exige d'être membre du rôle visé ;
-- le superuser peut altérer les défauts de postgres ET de supabase_admin).
--
-- Après cette migration :
--   - une nouvelle table de public/storage naît sans TRUNCATE/TRIGGER/
--     REFERENCES/MAINTAIN pour anon/authenticated (SELECT/INSERT/UPDATE/
--     DELETE restent, gouvernés par RLS comme aujourd'hui) ;
--   - une nouvelle fonction de public naît SANS EXECUTE anon/authenticated :
--     toute migration qui crée une RPC destinée aux clients doit désormais
--     l'accorder EXPLICITEMENT (grant execute ... to anon/authenticated).
--     service_role et postgres gardent leur défaut ;
--   - une nouvelle fonction de private naît sans EXECUTE PUBLIC.
-- Doctrine détaillée : docs/frontend/DB_OWNERSHIP.md.
--
-- Hors périmètre, inchangés : les défauts des schémas graphql/graphql_public
-- (gérés par pg_graphql), supabase_functions, auth, realtime, extensions ;
-- les défauts sur SEQUENCES (rwU pour anon/authenticated — signalé au
-- rapport, aucun risque TRUNCATE-like).

begin;

-- Tables : les quatre verbes sans usage client, pour les deux créateurs.
alter default privileges for role postgres in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;
alter default privileges for role postgres in schema storage
  revoke truncate, trigger, references, maintain on tables from anon, authenticated;

-- Fonctions de public : plus d'EXECUTE client implicite à la naissance.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema storage
  revoke execute on functions from anon, authenticated;

-- EXECUTE PUBLIC implicite : une entrée par-schéma s'AJOUTE au défaut global
-- et ne peut pas retirer le PUBLIC=X câblé de PostgreSQL (mesuré au bac
-- d'essai : un REVOKE par-schéma inexistant est un no-op complet, l'entrée
-- n'est même pas créée). Seul un REVOKE GLOBAL par rôle créateur remplace le
-- défaut câblé. Il vaut pour TOUS les schémas où ces rôles créent des
-- fonctions — c'est voulu (private compris) et documenté DB_OWNERSHIP.md ;
-- effet de bord assumé : après un futur CREATE/ALTER EXTENSION exécuté par
-- supabase_admin, les NOUVELLES fonctions d'extension ne seront plus
-- PUBLIC-exécutables — vérifier alors les chemins clients et accorder
-- explicitement si besoin.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role supabase_admin
  revoke execute on functions from public;

commit;
