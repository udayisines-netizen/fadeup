-- FadeUp — M1c-a : retrait des fixtures de captures. Ne laisse RIEN.
--
-- L'ordre compte : ce qui référence le compte d'abord, le compte ensuite.
-- Les triggers restent DÉSACTIVÉS (mêmes raisons qu'à l'insertion : une
-- suppression ne doit pas mettre en file une annulation par e-mail).

\set ON_ERROR_STOP on

begin;

set local session_replication_role = replica;

delete from public.push_outbox
 where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from public.push_devices
 where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from public.notification_push_preferences
 where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from public.notifications
 where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from public.email_outbox
 where to_email = 'qa_m1ca_captures@fadeup.test';
delete from public.appointments
 where customer_id = 'c0dec001-0000-4000-8000-0000000000ca';
delete from public.customers
 where id = 'c0dec001-0000-4000-8000-0000000000ca';
delete from public.profiles
 where id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from auth.identities
 where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
delete from auth.users
 where id = 'c0dea001-0000-4000-8000-0000000000ca';

commit;

-- Preuve : les cinq comptes doivent tous renvoyer zéro.
select 'auth.users' as table, count(*) from auth.users where email = 'qa_m1ca_captures@fadeup.test'
union all select 'customers', count(*) from public.customers where id = 'c0dec001-0000-4000-8000-0000000000ca'
union all select 'appointments', count(*) from public.appointments where customer_id = 'c0dec001-0000-4000-8000-0000000000ca'
union all select 'push_devices', count(*) from public.push_devices where user_id = 'c0dea001-0000-4000-8000-0000000000ca'
union all select 'push_outbox', count(*) from public.push_outbox where user_id = 'c0dea001-0000-4000-8000-0000000000ca'
union all select 'preferences', count(*) from public.notification_push_preferences where user_id = 'c0dea001-0000-4000-8000-0000000000ca';
