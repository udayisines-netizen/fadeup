-- FadeUp — B4 chantier 2, retour arrière.
--
-- Retire les policies post-media de storage.objects, la garde de chemin, le
-- USAGE anon sur private, et le bucket s'il est vide. Un bucket non vide
-- n'est PAS vidé : supprimer des fichiers uploadés est une décision de
-- données, pas de schéma — le DELETE est refusé par la FK de storage et le
-- script le dit au lieu de forcer.
--
-- La révocation d'EXECUTE PUBLIC sur private.queue_stage n'est pas rétablie :
-- c'était un resserrement pur, le rétablir affaiblirait sans raison.

set lock_timeout = '5s';

begin;

drop policy if exists post_media_objects_insert_own on storage.objects;
drop policy if exists post_media_objects_delete_own on storage.objects;
drop policy if exists post_media_objects_select_own on storage.objects;
drop policy if exists post_media_objects_select_visible on storage.objects;

drop function if exists private.can_view_post_media_path(text);

revoke usage on schema private from anon;

-- storage.protect_delete refuse tout DELETE direct sans ce réglage local —
-- c'est son échappatoire officielle, portée par la transaction seulement.
select set_config('storage.allow_delete_query', 'true', true);

delete from storage.buckets b
 where b.id = 'post-media'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'post-media');

commit;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'post-media') then
    raise notice 'post-media bucket left in place: it still contains objects. Empty it deliberately before removing.';
  end if;
end;
$$;
