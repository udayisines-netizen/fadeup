-- FadeUp — B3 : retour arrière de 20260907011000_b3_trial.sql.
--
-- Restaure effective_plan_key et complete_onboarding à leur définition
-- d'avant B3, supprime les fonctions et la table de l'essai, retire les
-- gabarits ajoutés. Les lignes d'organization_trials disparaissent avec la
-- table : c'est le seul retour arrière de B3 qui perde une donnée écrite
-- pendant que la migration était en vigueur, et c'est inévitable — un état
-- « essai consommé » n'a nulle part où vivre dans le schéma d'avant. À ne
-- jouer qu'en connaissance de cause.

set lock_timeout = '5s';

begin;

-- 1. Le balayage et ses aides.
drop function if exists public.run_trial_maintenance();
drop function if exists private.org_owner_recipient(uuid);
drop function if exists public.start_organization_trial(uuid);
drop function if exists private.start_trial_if_eligible(uuid, text);
drop function if exists private.trial_plan_for_org(uuid);
drop function if exists private.org_ready_to_publish(uuid);

-- 2. complete_onboarding n'a pas été modifiée par la migration (elle
--    appartient à supabase_admin) : rien à restaurer.

-- 3. effective_plan_key : la définition d'avant B3, à l'identique.
create or replace function private.effective_plan_key(p_organization_id uuid)
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when s.status = 'canceled' then 'free'
    else s.plan_key
  end
  from public.organization_commercial_state s
  where s.organization_id = p_organization_id;
$$;

-- Le commentaire R2 d'origine, à l'identique (relevé sur la production avant
-- B3 — un `is null` ici laissait un écart au diff de schéma du test de
-- retour arrière).
comment on function private.effective_plan_key(uuid) is
'The plan actually in force for an organization, with commercial status applied exactly once: canceled degrades to free (network presence, nothing deleted), past_due keeps the assigned plan because a failed payment is a conversation rather than a shutdown. Returns NULL when the organization has no commercial state, which every caller treats as deny. Performs no authorization: private schema, no client EXECUTE, and every public caller checks membership first.';

-- 4. La table. Voir l'en-tête : la perte des lignes est réelle et assumée.
drop table if exists public.organization_trials;

-- 5. Les gabarits ajoutés par B3.
delete from public.email_templates
where template_key in ('trial_ending_soon', 'trial_ending_final');

commit;
