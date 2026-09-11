-- FadeUp — retour arrière de 20260911100000_plat1_role_enum.sql
--
-- PostgreSQL n'a PAS d'« alter type drop value » : les trois valeurs neuves de
-- public.platform_role ne peuvent pas être retirées sans recréer le type, donc
-- sans casser les 190 policies, colonnes et fonctions qui le référencent. Le
-- piège est connu (F1b l'a rencontré sur une énumération multi-fonctions).
--
-- Ce que ce fichier fait à la place, et qui suffit : il REFUSE de tourner tant
-- qu'un compte porte un des trois rôles neufs, puis rétablit le commentaire du
-- type. Une valeur d'énumération que personne ne porte et qu'aucune grille ne
-- dote de droits n'autorise rien — le défaut est le refus. Elle reste visible
-- dans `enum_range`, et c'est le seul résidu assumé de ce lot.
--
-- À passer APRÈS les retours arrière de 20260911100200 et 20260911100100.
-- À APPLIQUER EN postgres.

set lock_timeout = '5s';

begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.platform_members
  where role in ('platform_sales', 'platform_moderator', 'platform_intern');

  if v_count > 0 then
    raise exception '% compte(s) interne(s) portent encore un rôle PLAT-1 — réassignez-les avant le retour arrière', v_count
      using errcode = '42501';
  end if;
end $$;

comment on type public.platform_role is
  'FadeUp platform staff role — NOT a barbershop role (see public.membership_role for that unrelated concept).';

commit;

do $$ begin raise notice 'PLAT-1 : retour arrière du jeu de rôles (valeurs d''énumération conservées, sans droits)'; end $$;
