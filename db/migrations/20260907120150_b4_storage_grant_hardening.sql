-- FadeUp — B4 chantier 2 (annexe) : grants de storage.objects / storage.buckets.
--
-- ⚠ À APPLIQUER EN supabase_admin. Les grants à retirer ont pour grantor
-- supabase_storage_admin ; un REVOKE exécuté par postgres est un no-op
-- silencieux (mesuré). Même précédent que R4.1 : certains objets du cluster
-- n'appartiennent pas à postgres.
--
--   docker exec -i fadeup-supabase-db psql -U supabase_admin -d postgres \
--     -v ON_ERROR_STOP=1 < db/migrations/20260907120150_b4_storage_grant_hardening.sql
--
-- CE QUI EST MESURÉ AVANT : anon = arwdDxtm (TOUT, y compris TRUNCATE) sur
-- storage.objects et storage.buckets ; authenticated pareil. TRUNCATE n'est
-- pas soumis à RLS : un anon pouvait vider les métadonnées de tous les
-- fichiers du produit. Même défaut que B1 (queue_entries) et B2
-- (email_outbox), trouvé ici sur les tables que le chantier 2 met en jeu.
--
-- APRÈS :
--   anon          → SELECT seul (la policy de lecture publique et la
--                   signature d'URL s'évaluent sous ce rôle)
--   authenticated → garde le DML que ses policies gouvernent ; perd
--                   TRUNCATE, TRIGGER, REFERENCES (aucune policy, aucun
--                   appelant, et TRUNCATE ignore RLS)
--
-- Le bloc final ÉCHOUE si un superutilisateur applique ce fichier sans
-- effet ; appliqué par postgres (replay jetable), il AVERTIT au lieu de
-- casser la chaîne de replay — et verify_b4 porte l'assertion finale sur la
-- vraie base.
--
-- Idempotent : sûr à rejouer (en supabase_admin).

set lock_timeout = '5s';

begin;

-- MAINTAIN est dans la liste : c'est précisément le privilège que le test de
-- restauration fidèle de B2 avait montré oublié.
revoke insert, update, delete, truncate, trigger, references, maintain on table storage.objects from anon;
revoke insert, update, delete, truncate, trigger, references, maintain on table storage.buckets from anon;
revoke truncate, trigger, references, maintain on table storage.objects from authenticated;
revoke truncate, trigger, references, maintain on table storage.buckets from authenticated;

do $$
declare
  v_ineffective boolean;
begin
  v_ineffective :=
       has_table_privilege('anon', 'storage.objects', 'TRUNCATE')
    or has_table_privilege('anon', 'storage.objects', 'INSERT')
    or has_table_privilege('anon', 'storage.buckets', 'TRUNCATE')
    or has_table_privilege('authenticated', 'storage.objects', 'TRUNCATE')
    or has_table_privilege('authenticated', 'storage.buckets', 'TRUNCATE');
  if v_ineffective then
    if (select rolsuper from pg_roles where rolname = current_user) then
      raise exception 'storage grant hardening did not take effect even as a superuser — investigate the grantor chain';
    else
      raise warning 'storage grant hardening was a NO-OP under role % — apply this file as supabase_admin against the real database (verify_b4 asserts the final state)', current_user;
    end if;
  end if;
end;
$$;

commit;
