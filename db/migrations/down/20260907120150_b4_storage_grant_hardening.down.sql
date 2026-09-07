-- FadeUp — B4 chantier 2 (annexe), retour arrière.
--
-- ⚠ À APPLIQUER EN supabase_admin (même raison que l'aller : le grantor est
-- supabase_storage_admin).
--
-- Rétablit les grants mesurés avant B4 : arwdDxtm pour anon et authenticated
-- sur storage.objects et storage.buckets. Oui, cela réinstalle le TRUNCATE
-- anon que l'aller retirait — c'est ce que « retour à l'état antérieur »
-- veut dire ; le retirer à nouveau appartient au lot de durcissement global
-- (BLOCKERS n°4).

set lock_timeout = '5s';

begin;

grant insert, update, delete, truncate, trigger, references, maintain on table storage.objects to anon;
grant insert, update, delete, truncate, trigger, references, maintain on table storage.buckets to anon;
grant truncate, trigger, references, maintain on table storage.objects to authenticated;
grant truncate, trigger, references, maintain on table storage.buckets to authenticated;

commit;
