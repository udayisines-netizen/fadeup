-- Down de 20260907173000_x3_default_acl_hardening.sql.
-- À APPLIQUER EN supabase_admin. Restaure les défauts pré-X3 ; les entrées
-- private redevenues égales au défaut câblé de PostgreSQL disparaissent
-- d'elles-mêmes de pg_default_acl.

begin;

alter default privileges for role postgres in schema public
  grant truncate, trigger, references, maintain on tables to anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant truncate, trigger, references, maintain on tables to anon, authenticated;
alter default privileges for role postgres in schema storage
  grant truncate, trigger, references, maintain on tables to anon, authenticated;

alter default privileges for role postgres in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role supabase_admin in schema public
  grant execute on functions to anon, authenticated;
alter default privileges for role postgres in schema storage
  grant execute on functions to anon, authenticated;

alter default privileges for role postgres
  grant execute on functions to public;
alter default privileges for role supabase_admin
  grant execute on functions to public;

commit;
