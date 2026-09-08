-- X2 — retour arrière de 20260908120100_x2_information_template.sql.
-- À APPLIQUER EN postgres.
--
-- Supprime le gabarit d'information article 14 (FR + EN). Les messages en
-- file qui le référencent sont retirés par le down de 20260908120000 ; si ce
-- fichier est rejoué seul, les lignes queued restantes échoueraient au rendu
-- (42704) et finiraient failed après leurs tentatives — sans effet de bord.

set lock_timeout = '5s';

begin;

delete from public.email_templates
where template_key = 'external_profile_published';

commit;
