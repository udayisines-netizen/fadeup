-- B5 — retour arrière du chantier 3 (colonne de genre).
--
-- À APPLIQUER EN postgres. Détruit la réponse de genre de tous les comptes :
-- c'est un retour arrière de schéma, pas une migration de données.

begin;

alter table public.customer_profiles drop column if exists gender;

drop type if exists public.customer_gender;

comment on column public.customer_profiles.haircut_frequency is null;

commit;
