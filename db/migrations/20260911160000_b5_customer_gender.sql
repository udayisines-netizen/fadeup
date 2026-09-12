-- B5 — chantier 3 : la colonne de genre (et la finalité déclarée).
--
-- À APPLIQUER EN postgres (public.customer_profiles appartient à postgres,
-- aucun objet supabase_admin n'est redéfini ici).
--
-- M1a collecte la réponse « Vous êtes… ? » dans l'onboarding et la garde en
-- AsyncStorage, faute de colonne (M1a §12, M1b §12.7). Cette migration ouvre
-- la colonne, avec les valeurs de l'enum VERBATIM celles du client
-- (apps/mobile/src/features/onboarding/storage.ts, GENDER_ANSWERS) — même
-- règle que customer_haircut_frequency : pas de table de traduction, toute
-- dérive casse la compilation.
--
-- Trois propriétés portées par le schéma lui-même, pas par une convention :
--   1. OPTIONNELLE et EFFAÇABLE — la colonne est nullable, NULL = « pas de
--      réponse » comme « réponse retirée ». Rien ne distingue les deux, et
--      c'est voulu : un drapeau « a refusé de répondre » serait lui-même une
--      donnée sur la personne.
--   2. FINALITÉ UNIQUE ET DÉCLARÉE — orienter la découverte vers barbershop
--      ou salon mixte. Écrite dans le COMMENT, qui est la seule déclaration
--      que le schéma peut porter et que db-audit/SCHEMA.sql publie.
--   3. JAMAIS PUBLIQUE — aucune RPC ne la projette. Mesuré avant écriture :
--      les trois seules fonctions qui lisent customer_profiles
--      (get_my_access, get_shared_passport, submit_review) énumèrent leurs
--      colonnes une à une ; aucune n'utilise select *. La suite anonyme
--      (db/tests/x3_anon_surface.sh) le revérifie à chaque campagne, et
--      db/tests/verify_b5.sql l'assert explicitement (section D).
--
-- La fréquence de coupe, elle, avait déjà sa colonne (customer_profiles.
-- haircut_frequency, migration 20260813120000) : M1b l'y écrit par
-- profileSync.ts. Rien à ajouter en base — le manque était côté écran
-- (aucune surface pour la modifier ou l'effacer), corrigé hors migration.

begin;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_gender') then
    create type public.customer_gender as enum ('man', 'woman', 'no_preference');
  end if;
end
$$;

comment on type public.customer_gender is
  'Réponse à la question de genre de l''onboarding client (M1a). Valeurs VERBATIM celles du client mobile (GENDER_ANSWERS) — aucune table de traduction. « no_preference » est la réponse « peu importe », pas une absence de réponse : l''absence est NULL.';

alter table public.customer_profiles
  add column if not exists gender public.customer_gender;

comment on column public.customer_profiles.gender is
  'Préférence de recommandation déclarée par le client. FINALITÉ UNIQUE ET EXCLUSIVE : orienter la découverte vers barbershop ou salon mixte. Donnée personnelle, OPTIONNELLE (NULL = pas de réponse ou réponse retirée), modifiable et effaçable par son titulaire via la RLS de customer_profiles. N''est exposée par AUCUNE surface publique ni professionnelle : aucune RPC ne la projette, aucun profil ne l''affiche, aucune recherche ne l''utilise aujourd''hui. Part avec public.delete_my_account().';

comment on column public.customer_profiles.haircut_frequency is
  'Fréquence de coupe déclarée à l''onboarding (M1a), enum customer_haircut_frequency. Donnée personnelle optionnelle, modifiable et effaçable (NULL) par son titulaire. Sert aux recommandations ; le rappel de rebooking fondé dessus est hors périmètre B5 (OS-3). Part avec public.delete_my_account().';

commit;
