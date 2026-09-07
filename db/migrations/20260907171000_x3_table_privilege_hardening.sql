-- X3 — Chantier 2a : retrait de TRUNCATE, TRIGGER, REFERENCES et MAINTAIN
-- pour anon et authenticated sur TOUTES les tables de public et storage.
--
-- À APPLIQUER EN supabase_admin. Les grants à retirer ont trois concédants
-- (postgres : 50-53 tables ; supabase_admin : 34-35 ; supabase_storage_admin :
-- storage.*). Un REVOKE exécuté par un superuser agit comme le propriétaire de
-- chaque objet — ici propriétaire = concédant partout (vérifié avant
-- écriture), donc aucun no-op silencieux. Un REVOKE par `postgres` (non
-- superuser) serait un no-op sur les objets de supabase_admin et de
-- supabase_storage_admin — leçon B4.
--
-- TRUNCATE n'est pas soumis à RLS (BLOCKERS §4) ; TRIGGER, REFERENCES et
-- MAINTAIN n'ont aucun usage client. SELECT/INSERT/UPDATE/DELETE restent tels
-- quels, filtrés par RLS.

begin;

revoke truncate, trigger, references, maintain
  on all tables in schema public, storage
  from anon, authenticated;

-- storage.buckets_analytics avait échappé au durcissement B4 (créée par le
-- service storage après coup) : anon et authenticated y détenaient
-- arwdDxtm. Alignement sur la posture des tables catalogues sœurs
-- (iceberg_*, s3_multipart_*, buckets_vectors) : lecture seule.
revoke insert, update, delete on storage.buckets_analytics from anon, authenticated;

commit;
