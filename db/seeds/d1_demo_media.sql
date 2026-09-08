-- ============================================================================
-- D1 — Imagerie de démonstration (bannières, portraits, portfolio)
-- ============================================================================
--
-- OBJET. La refonte D1 (carte de résultat avec mini-bannière, profil
-- modèle X) ne se voit pas sans images. Ce seed pose :
--
--   1. Deux PORTRAITS sur les identités `demo.*` (professionals.avatar_url
--      + staff_profiles.avatar_url) — servis depuis
--      `apps/web/public/demo-media/avatars/`.
--   2. Sept images de PORTFOLIO (posts B4 réels) : 3 posts supplémentaires
--      de demo.kais.bellamine et 2 posts d'organisation d'Atelier Fadel —
--      médias JPEG téléversés dans le bucket privé `post-media` sous le
--      préfixe `d1-demo/`, signés par l'anonyme via la chaîne B4 réelle.
--
-- Les BANNIÈRES d'établissement n'ont AUCUN contrat en base (aucune colonne
-- d'imagerie sur organizations/locations — mesuré) : elles vivent dans
-- `apps/web/public/demo-media/banners/<slug>.jpg` et sont résolues par le
-- registre frontend `src/shared/lib/demoMedia.ts`, qui ne s'applique QU'AUX
-- slugs `demo-*`. Écart déclaré pour M1a : un vrai contrat d'imagerie
-- d'établissement reste à créer.
--
-- PROVENANCE. Toutes les images sont des DÉRIVÉS (recadrages) des deux
-- générations Artlist déjà payées du 2026-08-31 (Seedream 5.0 Pro,
-- generation ids 01a058d7-1074-7357-a0df-ed5c1fb6fa4d et
-- 01a0596d-771e-7f8e-9b46-69b91be8cd38 — 4 sorties chacune, récupérées via
-- l'historique sans dépense). AUCUNE ne représente un professionnel réel ni
-- un salon existant (MASTER_SPEC §2). Deux sujets seulement dans ces
-- scènes : seuls demo.kais.bellamine et demo.moussa.diakite reçoivent un
-- portrait photo — donner le même visage à deux identités différentes
-- aurait été un mensonge visuel. Les autres gardent le monogramme.
--
-- MARQUAGE / RETRAIT (convention QA_DATA §3) :
--   · avatars : handles `demo.*`, chemins `/demo-media/…` — retrait :
--     `update professionals set avatar_url = null where handle like 'demo.%'`
--     (idem staff_profiles) + suppression du dossier public/demo-media.
--   · posts : UUID préfixe hex `d1de`, caption suffixée « — démo FadeUp »,
--     médias sous `post-media/d1-demo/` — retrait :
--     `delete from public.posts where id::text like 'd1de%'` (post_media
--     suit par cascade) + suppression des objets `d1-demo/*` du bucket.
--
-- IDEMPOTENT : UUID fixes + gardes d'existence ; rejouable sans effet.
-- EXÉCUTION — manuelle uniquement :
--   docker exec -i fadeup-supabase-db psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < db/seeds/d1_demo_media.sql
-- (rôle postgres : tables posts/post_media/professionals lui appartiennent)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Portraits — seulement là où un visage distinct existe dans les sources.
-- ----------------------------------------------------------------------------
update public.professionals
set avatar_url = '/demo-media/avatars/' || handle || '.jpg'
where handle in ('demo.kais.bellamine', 'demo.moussa.diakite')
  and avatar_url is null;

update public.staff_profiles sp
set avatar_url = p.avatar_url
from public.barbers b
join public.professionals p on p.id = b.professional_id
where b.staff_profile_id = sp.id
  and p.handle in ('demo.kais.bellamine', 'demo.moussa.diakite')
  and sp.avatar_url is null;

-- ----------------------------------------------------------------------------
-- 2. Portfolio de demo.kais.bellamine — 3 posts professionnels de plus
--    (le post F2 34639de8… reste le premier).
-- ----------------------------------------------------------------------------
insert into public.posts (id, author_kind, professional_id, posted_at_organization_id, caption, visibility)
select v.id::uuid, 'professional', 'de300401-0000-4000-8000-000000000001', 'de300001-0000-4000-8000-000000000001', v.caption, 'public'
from (values
  ('d1de0001-0000-4000-8000-000000000001', 'Mid fade, contour net — démo FadeUp'),
  ('d1de0002-0000-4000-8000-000000000002', 'Taper + finition tondeuse — démo FadeUp'),
  ('d1de0003-0000-4000-8000-000000000003', 'Skin fade sur cheveux bouclés — démo FadeUp')
) as v(id, caption)
where not exists (select 1 from public.posts p where p.id = v.id::uuid);

insert into public.post_media (id, post_id, storage_path, media_type, width, height, position)
select v.id::uuid, v.post_id::uuid, v.path, 'image', 1080, 1080, 0
from (values
  ('d1de0011-0000-4000-8000-000000000011', 'd1de0001-0000-4000-8000-000000000001', 'd1-demo/kais-1.jpg'),
  ('d1de0012-0000-4000-8000-000000000012', 'd1de0002-0000-4000-8000-000000000002', 'd1-demo/kais-2.jpg'),
  ('d1de0013-0000-4000-8000-000000000013', 'd1de0003-0000-4000-8000-000000000003', 'd1-demo/kais-3.jpg')
) as v(id, post_id, path)
where not exists (select 1 from public.post_media m where m.id = v.id::uuid);

-- Second média du post 3 (grille à plusieurs médias, cas réel du viewer P4).
insert into public.post_media (id, post_id, storage_path, media_type, width, height, position)
select 'd1de0014-0000-4000-8000-000000000014', 'd1de0003-0000-4000-8000-000000000003', 'd1-demo/kais-4.jpg', 'image', 1080, 1080, 1
where not exists (select 1 from public.post_media m where m.id = 'd1de0014-0000-4000-8000-000000000014');

-- ----------------------------------------------------------------------------
-- 3. Portfolio d'Atelier Fadel — 2 posts d'ORGANISATION (l'autre profil
--    exigé par D1 §3 « au moins deux profils »).
-- ----------------------------------------------------------------------------
insert into public.posts (id, author_kind, organization_id, caption, visibility)
select v.id::uuid, 'organization', 'de300003-0000-4000-8000-000000000003', v.caption, 'public'
from (values
  ('d1de0004-0000-4000-8000-000000000004', 'Dégradé miroir, résultat client — démo FadeUp'),
  ('d1de0005-0000-4000-8000-000000000005', 'L''atelier, lumière du matin — démo FadeUp')
) as v(id, caption)
where not exists (select 1 from public.posts p where p.id = v.id::uuid);

insert into public.post_media (id, post_id, storage_path, media_type, width, height, position)
select v.id::uuid, v.post_id::uuid, v.path, 'image', 1080, 1080, v.pos
from (values
  ('d1de0015-0000-4000-8000-000000000015', 'd1de0004-0000-4000-8000-000000000004', 'd1-demo/fadel-1.jpg', 0),
  ('d1de0016-0000-4000-8000-000000000016', 'd1de0005-0000-4000-8000-000000000005', 'd1-demo/fadel-2.jpg', 0),
  ('d1de0017-0000-4000-8000-000000000017', 'd1de0005-0000-4000-8000-000000000005', 'd1-demo/fadel-3.jpg', 1)
) as v(id, post_id, path, pos)
where not exists (select 1 from public.post_media m where m.id = v.id::uuid);

commit;

-- Vérification rapide (lecture seule) :
--   select count(*) from public.posts where id::text like 'd1de%';   -- 5
--   select count(*) from public.post_media where id::text like 'd1de%'; -- 7
