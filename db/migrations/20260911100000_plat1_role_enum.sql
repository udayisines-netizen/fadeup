-- FadeUp — PLAT-1 (1/3) : les trois rôles internes manquants.
--
-- CE QUI EXISTE. `public.platform_role` porte trois valeurs depuis
-- 20260810130000 : platform_owner, platform_admin, platform_support. Le
-- fondateur en a tranché six. Les trois qui manquent sont le commercial, le
-- modérateur et le stagiaire.
--
-- CE QUI NE CHANGE PAS. Aucune valeur existante n'est renommée : trois
-- comptes internes RÉELS portent platform_owner/platform_admin en production,
-- et `private.is_platform_admin()` (owner + admin) reste la garde de lecture
-- locataire, inchangée. Une valeur d'énumération neuve n'apparaît dans AUCUNE
-- policy existante : toutes énumèrent leurs rôles nommément (vérifié sur les
-- 187 policies qui mentionnent « platform »). Le défaut est donc le refus,
-- sans une ligne de plus.
--
-- POURQUOI UN FICHIER À PART. `alter type ... add value` valide en PG 17,
-- mais la valeur neuve n'est pas utilisable dans la transaction qui la crée.
-- La grille de permissions de 20260911100100 les référence : elle exige que
-- cette migration soit committée d'abord. Même motif que 20260908030000.
--
-- À APPLIQUER EN postgres (propriétaire du type — vérifié).
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

alter type public.platform_role add value if not exists 'platform_sales'     after 'platform_support';
alter type public.platform_role add value if not exists 'platform_moderator' after 'platform_sales';
alter type public.platform_role add value if not exists 'platform_intern'    after 'platform_moderator';

comment on type public.platform_role is
  'Rôle interne FadeUp — À NE PAS CONFONDRE avec public.membership_role, qui est le rôle dans un salon. Six valeurs depuis PLAT-1 : platform_owner (fondateur, seul à gérer les rôles internes et à supprimer un barber), platform_admin (tout sauf ces deux gestes), platform_support (appels clients et pros, sans CRM), platform_sales (CRM, publication marketplace, onboardings, plans commerciaux), platform_moderator (contenu, avis, onboardings, vue en tant que, sans CRM), platform_intern (stagiaire terrain : saisit des prospects dans sa zone, rien de public). Le rôle seul n''autorise rien : les droits sont dans public.platform_role_permissions et se vérifient par private.platform_can().';
