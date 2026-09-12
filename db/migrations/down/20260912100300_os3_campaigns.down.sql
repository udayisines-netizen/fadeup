-- FadeUp — OS-3 : retour arrière des sollicitations par modèles.
--
-- ORDRE : les lignes d'envoi d'abord (elles portent le flux marketing), puis
-- les fonctions, puis les tables, puis les colonnes de `customers`, puis les
-- gabarits et le flux. L'étiquette `marketing` de l'enum survit — voir
-- 20260912100100_os3_marketing_stream_label.down.sql, qui le déclare.

begin;

-- Les sollicitations encore en file n'ont plus de gabarit ni de flux : les
-- laisser ferait échouer le prochain lot d'envoi avec un motif obscur.
delete from public.email_outbox where stream = 'marketing';

drop function if exists public.unsubscribe_customer_marketing(text);
drop function if exists public.list_notification_campaigns(uuid, integer);
drop function if exists public.send_notification_campaign(uuid, public.notification_campaign_kind, text, jsonb);
drop function if exists public.preview_notification_campaign(uuid, public.notification_campaign_kind, jsonb);
drop function if exists public.get_campaign_quota(uuid);
drop function if exists private.campaign_audience(uuid, public.notification_campaign_kind, jsonb);
drop function if exists private.campaign_free_slots_tomorrow(uuid, uuid, uuid);
drop function if exists private.declared_cadence_days(public.customer_haircut_frequency);
drop function if exists private.assert_campaign_text(text, text, integer);
drop function if exists private.marketing_next_attempt_at(text, timestamptz);

drop table if exists public.notification_campaign_recipients;
drop table if exists public.notification_campaigns;
drop type if exists public.notification_campaign_kind;

drop index if exists public.customers_do_not_contact_idx;
drop index if exists public.customers_marketing_unsubscribe_token_key;
alter table public.customers drop column if exists marketing_unsubscribe_token;
alter table public.customers drop column if exists do_not_contact;

delete from public.email_templates where template_key like 'campaign_%';
delete from public.email_streams where stream = 'marketing';

commit;
