-- FadeUp — CORRECTIF DE PRODUCTION, hors périmètre OS-2, assumé ici.
--
-- RÔLE D'APPLICATION : postgres.
--
-- CE QUI ÉTAIT CASSÉ, ET COMMENT ON L'A TROUVÉ
--
-- La campagne de non-régression d'OS-2 (2026-09-11, 19 h) a fait rougir
-- `e2e/f1/live-queue.spec.ts`. La trace montre que le PATCH de « Appeler le
-- suivant » répond 403 :
--
--     {"code":"42501","message":"permission denied for function
--      erasure_display_sentinel"}
--
-- Reproduit hors test, en session RÉELLE de propriétaire de salon, sur une
-- entrée de file réelle : même 403. Étaient donc cassés EN PRODUCTION, pour
-- tous les rôles :
--
--   · toute transition de file par un professionnel
--     (trigger `public.restrict_queue_entry_self_update`)
--   · toute mise à jour de rendez-vous par un barber
--     (trigger `public.restrict_appointment_self_update`)
--   · toute écriture d'avis (trigger `public.reviews_guard_immutable`)
--
-- LA CAUSE. Le lot B5 (effacement de compte, branche `b5/missing-contracts`,
-- non fusionnée mais APPLIQUÉE en production) a ajouté des appels à
-- `private.erasure_display_sentinel()` et `private.erasure_update_allowed()`
-- dans ces trois fonctions de trigger. Or ces triggers ne sont PAS
-- `SECURITY DEFINER` (`prosecdef = false`, vérifié) : ils s'exécutent avec
-- les droits de l'appelant, donc `authenticated`. Et depuis le durcissement
-- X3 des ACL par défaut (`20260907173000`), une fonction NEUVE de `private`
-- ne naît plus exécutable par PUBLIC — DB_OWNERSHIP §3 règle 4 impose un
-- `grant execute` explicite, qui a été oublié. Le piège que la règle 4
-- décrit exactement.
--
-- POURQUOI OS-2 LE CORRIGE. La session qui portait B5 était terminée quand
-- le défaut a été trouvé ; il n'y avait personne à qui le rendre, et la
-- production était cassée sur un geste du quotidien. Le correctif est le
-- plus petit possible : trois `grant execute`, aucune redéfinition, aucun
-- changement de sémantique.
--
-- CE QUE CES TROIS FONCTIONS EXPOSENT — rien.
--
--   · `erasure_display_sentinel()` rend la constante '[deleted]'.
--   · `account_erasure_active()` lit un GUC transactionnel ET exige
--     `current_user in ('postgres','supabase_admin')` : appelée par
--     `authenticated`, elle rend TOUJOURS false. La garde reste entière.
--   · `erasure_update_allowed(jsonb, jsonb, jsonb)` est un prédicat pur sur
--     des valeurs que l'appelant possède déjà, et il commence par
--     `account_erasure_active()` — donc false pour `authenticated`.
--
-- Accorder l'exécution ne donne aucun pouvoir : cela rend seulement au
-- trigger le droit d'évaluer sa propre garde.
--
-- REJEU À BLANC. Les grants sont CONDITIONNELS : sur une base où B5 n'est
-- pas appliqué (la branche `os2/operations` seule, une CI, un bac d'essai),
-- les fonctions n'existent pas et ce fichier ne fait rien. Il ne peut donc
-- pas casser un rejeu, quel que soit l'ordre de fusion des deux branches.

begin;

do $hotfix$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'private.erasure_display_sentinel()',
    'private.account_erasure_active()',
    'private.erasure_update_allowed(jsonb, jsonb, jsonb)'
  ] loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
        and p.oid = to_regprocedure(v_signature)
    ) then
      execute format('grant execute on function %s to authenticated', v_signature);
      raise notice 'grant execute % to authenticated', v_signature;
    else
      raise notice 'ignoré (absent de cette base) : %', v_signature;
    end if;
  end loop;
end;
$hotfix$;

commit;
