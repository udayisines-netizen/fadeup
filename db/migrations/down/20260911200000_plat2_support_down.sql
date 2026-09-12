-- Retour arrière de 20260911200000_plat2_support.sql — À APPLIQUER EN postgres.
--
-- CE QUE CE RETOUR ARRIÈRE DÉTRUIT, et qu'il faut savoir avant de l'ordonner :
-- TOUS LES TICKETS DE SUPPORT et tout leur historique d'échanges. Les tables
-- sont supprimées, pas vidées d'un rôle : ce qui a été écrit dedans disparaît.
-- Tant qu'aucun ticket n'a été ouvert, le retour arrière ne coûte rien ; après,
-- il coûte cela. Rien d'autre n'est touché : aucune table antérieure à ce lot,
-- aucune policy antérieure, aucune ligne de journal (platform_audit_log est en
-- ajout seul et garde les traces des gestes déjà faits).

begin;

drop function if exists public.resend_platform_email(uuid, text);
drop function if exists public.remove_queue_entry_as_platform(uuid, text);
drop function if exists public.get_platform_organization_dossier(uuid);
drop function if exists public.get_platform_professional_dossier(uuid);
drop function if exists public.get_platform_customer_dossier(uuid);
drop function if exists private.assert_support_dossier(text, uuid);
drop function if exists public.set_support_ticket_status(uuid, public.support_ticket_status, text);
drop function if exists public.assign_support_ticket(uuid, uuid);
drop function if exists public.add_support_ticket_message(uuid, text, public.support_ticket_message_kind);
drop function if exists public.get_support_ticket(uuid);
drop function if exists public.list_support_tickets(boolean, boolean, integer);
drop function if exists public.open_support_ticket(public.support_ticket_origin, text, text, uuid, uuid, uuid, uuid, uuid, uuid);
drop function if exists private.assert_support_tickets();

drop table if exists public.support_ticket_messages;
drop table if exists public.support_tickets;
drop function if exists public.reject_support_ticket_message_mutation();
drop sequence if exists public.support_ticket_reference_seq;
drop type if exists public.support_ticket_message_kind;
drop type if exists public.support_ticket_status;
drop type if exists public.support_ticket_origin;

delete from public.platform_role_permissions
 where permission_key in ('support.tickets', 'support.dossier', 'queue.remove', 'email.resend');
delete from public.platform_permissions
 where key in ('support.tickets', 'support.dossier', 'queue.remove', 'email.resend');

commit;
