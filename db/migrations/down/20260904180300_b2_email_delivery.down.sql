-- FadeUp — B2 chantier 2, retour arrière.
--
-- Supprime l'expéditeur : email_outbox redevient une file d'attente sans
-- facteur, exactement ce qu'elle était depuis R1A.
--
-- CE QU'IL N'EST PAS POSSIBLE DE DÉFAIRE, ET C'EST DIT PLUTÔT QUE CACHÉ.
-- La valeur 'sending' ajoutée à l'enum email_delivery_status RESTE :
-- PostgreSQL ne sait pas retirer une valeur d'un enum, et la seule voie —
-- recréer le type, réécrire toutes les colonnes qui l'utilisent — est
-- infiniment plus risquée que de laisser une valeur inutilisée en place. Le
-- script remet donc d'abord toute ligne 'sending' en 'queued', pour qu'aucune
-- ligne ne porte un état que plus rien ne sait traiter.
--
-- Le secret du vault n'est PAS supprimé : il n'a pas été créé par cette
-- migration mais par db/seeds/b2_install_resend_secret.sh, et le retirer
-- obligerait à le réinstaller à la main après un simple aller-retour.
-- Supprimer la ligne :  delete from vault.secrets where name = 'resend_api_key';
--
-- Doit être exécuté APRÈS le retour arrière de 20260904180400.
--
-- Idempotent : sans risque à rejouer.

set lock_timeout = '5s';

begin;

update public.email_outbox
set status = 'queued', net_request_id = null, locked_at = null, updated_at = now()
where status = 'sending';

drop function if exists public.run_email_delivery();
drop function if exists private.email_reconcile_batch(integer);
drop function if exists private.email_dispatch_batch(integer);
drop function if exists private.render_email_template(text, text, jsonb);
drop function if exists private.resend_api_key();

drop index if exists public.email_outbox_reconcilable_idx;
drop index if exists public.email_outbox_dispatchable_idx;
drop index if exists public.email_outbox_dedupe_key_unique;

alter table public.email_outbox
  drop column if exists dispatched_at,
  drop column if exists dedupe_key,
  drop column if exists provider_message_id,
  drop column if exists net_request_id,
  drop column if exists stream;

drop table if exists public.email_templates;
drop table if exists public.email_streams;
drop type if exists public.email_stream;

commit;
