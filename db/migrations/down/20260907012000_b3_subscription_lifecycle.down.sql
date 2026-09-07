-- FadeUp — B3 : retour arrière de 20260907012000_b3_subscription_lifecycle.sql.
--
-- Supprime le journal des webhooks, le traitement, le balayage et les aides
-- de secret. Les secrets EUX-MÊMES restent dans le vault : ils n'ont pas été
-- posés par la migration (c'est le rôle de db/seeds/b3_install_stripe_secrets.sh)
-- et un retour arrière de schéma n'est pas une rotation de clé.
--
-- Les lignes de commercial_plan_changes écrites avec entitlement_source
-- 'billing' restent : la table est append-only par conception (B1 l'a appris
-- en essayant d'en effacer), et l'histoire de ce qui a été facturé n'a pas à
-- disparaître avec le mécanisme.

set lock_timeout = '5s';

begin;

drop function if exists public.run_billing_maintenance();
drop function if exists private.process_stripe_event(text);
drop function if exists private.apply_billing_state(uuid, text, public.commercial_status, text, text, text);

drop table if exists public.stripe_webhook_events;

delete from public.email_templates where template_key = 'payment_failed_notice';

drop function if exists private.billing_livemode();
drop function if exists private.stripe_webhook_secret();
drop function if exists private.stripe_secret_key();

commit;
