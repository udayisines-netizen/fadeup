-- FadeUp — B4 chantier 2 : stockage des médias de publication.
--
-- Bucket post-media, NON PUBLIC, servi par URL signées — calqué sur
-- passport-photos (20260813140000), le seul bucket existant et fonctionnel :
-- même motif de dossier par propriétaire ({user_id}/…), mêmes policies
-- own-folder, MIME et taille validés par le Storage API contre le contenu
-- réel de l'upload, pas contre une extension déclarée.
--
-- Limite : 8 Mo. Types : image/jpeg, image/webp, image/avif, video/mp4.
--
-- LECTURE PUBLIQUE. Une publication `public` doit être visible d'un visiteur
-- non connecté (MASTER_SPEC §11) ; la signature d'URL passe par le Storage
-- API qui évalue les policies RLS de storage.objects sous le rôle appelant.
-- La policy de lecture délègue donc à private.can_view_post — la même
-- fonction que les policies de post_media — via la résolution
-- storage_path → post. Un média de post `followers` n'est signable que par un
-- abonné, un média de post `hidden` que par l'auteur, un média orphelin (pas
-- encore rattaché à un post) que par son uploader.
--
-- POURQUOI UNE FONCTION ET PAS UN EXISTS DANS LA POLICY : l'expression d'une
-- policy s'évalue sous le rôle appelant, et anon n'a — à dessein — aucun
-- droit SELECT sur public.post_media ni public.posts. Un EXISTS inline
-- échouerait en permission denied. private.can_view_post_media_path est
-- security definer, possédée par postgres (bypassrls), comme toutes les
-- gardes du schéma.
--
-- CE QUE ÇA EXIGE POUR anon : USAGE sur le schéma private et EXECUTE sur
-- cette seule fonction. Vérifié avant de l'accorder : les 15 fonctions
-- private à ACL par défaut sont des fonctions trigger, inappelables
-- directement ; la seule exception, queue_stage, est un mapping pur sans
-- accès aux données — et son EXECUTE PUBLIC est révoqué ici même, par
-- prudence. anon ne gagne AUCUN accès table.
--
-- LES GRANTS DE storage.objects/buckets sont durcis par le fichier annexe
-- 20260907120150 — séparé parce qu'il doit être appliqué en supabase_admin
-- (le grantor est supabase_storage_admin ; un REVOKE par postgres est un
-- no-op silencieux, mesuré). anon y perd tout sauf SELECT, y compris le
-- TRUNCATE que RLS ne soumet pas — même défaut que B1/B2, trouvé ici sur
-- les tables du chantier.
--
-- Idempotent : sûr à rejouer.

set lock_timeout = '5s';

begin;

-- ---------------------------------------------------------------------------
-- Bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 8388608,
        array['image/jpeg', 'image/webp', 'image/avif', 'video/mp4'])
on conflict (id) do update
  set public = false,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg', 'image/webp', 'image/avif', 'video/mp4'];

-- ---------------------------------------------------------------------------
-- Le strict nécessaire pour que la policy de lecture puisse trancher en anon
-- ---------------------------------------------------------------------------

revoke execute on function private.queue_stage(public.queue_status) from public;

grant usage on schema private to anon;

create or replace function private.can_view_post_media_path(p_name text)
returns boolean
language sql stable security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.post_media pm
    where pm.storage_path = p_name
      and private.can_view_post(pm.post_id)
  );
$$;

comment on function private.can_view_post_media_path(text) is
  'Garde de lecture du bucket post-media : résout un chemin d''objet vers son post (index unique post_media_storage_path_unique) et applique private.can_view_post sous le rôle appelant réel (auth.uid()). Security definer parce que les policies de storage.objects s''évaluent sous anon/authenticated, qui n''ont aucun droit direct sur post_media — et ne doivent pas en avoir.';

revoke execute on function private.can_view_post(uuid) from public;
grant execute on function private.can_view_post(uuid) to authenticated;
revoke execute on function private.can_manage_post(uuid) from public;
grant execute on function private.can_manage_post(uuid) to authenticated;
revoke execute on function private.can_view_post_media_path(text) from public;
grant execute on function private.can_view_post_media_path(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies — écriture : own-folder, exactement passport-photos.
-- Le chemin est structuré par auteur ({user_id}/…) pour que la policy
-- tranche sur le premier segment, sans jointure.
-- ---------------------------------------------------------------------------

drop policy if exists post_media_objects_insert_own on storage.objects;
create policy post_media_objects_insert_own
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-media'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists post_media_objects_delete_own on storage.objects;
create policy post_media_objects_delete_own
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-media'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Lecture : l'uploader voit toujours ses propres fichiers (il vient de les
-- envoyer, le post n'existe peut-être pas encore) ; tout autre lecteur ne
-- voit un objet que si le post auquel il appartient lui est visible.

drop policy if exists post_media_objects_select_own on storage.objects;
create policy post_media_objects_select_own
  on storage.objects for select to authenticated
  using (bucket_id = 'post-media'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists post_media_objects_select_visible on storage.objects;
create policy post_media_objects_select_visible
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'post-media'
         and private.can_view_post_media_path(name));

commit;
