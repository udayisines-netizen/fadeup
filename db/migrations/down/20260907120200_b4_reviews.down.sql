-- FadeUp — B4 chantier 3, retour arrière.
--
-- Supprime le domaine avis : tables, triggers, helpers, policies storage et
-- bucket review-photos (s'il est vide — un bucket non vide est laissé en
-- place et signalé, vider des fichiers clients est une décision de données).
-- DESTRUCTIF pour les avis écrits pendant que la migration était en vigueur ;
-- aucune donnée antérieure à B4 n'existe dans ces tables.

set lock_timeout = '5s';

begin;

drop policy if exists review_photos_objects_insert_own on storage.objects;
drop policy if exists review_photos_objects_delete_own on storage.objects;
drop policy if exists review_photos_objects_select_own on storage.objects;
drop policy if exists review_photos_objects_select_visible on storage.objects;

drop function if exists private.can_view_review_photo_path(text);

drop table if exists public.review_reports;
drop table if exists public.review_photos;
drop table if exists public.reviews;
drop table if exists public.review_reputation;

drop function if exists public.maintain_review_reputation();
drop function if exists private.apply_reputation_delta(text, uuid, integer, integer);
drop function if exists public.reviews_guard_immutable();
drop function if exists public.check_reviews_consistency();

-- storage.protect_delete refuse tout DELETE direct sans ce réglage local —
-- c'est son échappatoire officielle, portée par la transaction seulement.
select set_config('storage.allow_delete_query', 'true', true);

delete from storage.buckets b
 where b.id = 'review-photos'
   and not exists (select 1 from storage.objects o where o.bucket_id = 'review-photos');

commit;

do $$
begin
  if exists (select 1 from storage.buckets where id = 'review-photos') then
    raise notice 'review-photos bucket left in place: it still contains objects. Empty it deliberately before removing.';
  end if;
end;
$$;
