-- Retour arrière — OS-2 notes privées client.
-- Rôle : postgres. Ne supprime AUCUNE donnée métier autre que les notes
-- elles-mêmes, qui n'existaient pas avant cette migration.
begin;

drop function if exists public.get_my_customer_notes();
drop function if exists public.delete_customer_note(uuid);
drop function if exists public.update_customer_note(uuid, text);
drop function if exists public.add_customer_note(uuid, text);
drop function if exists public.list_customer_notes(uuid);

delete from public.platform_role_permissions where permission_key = 'customer_notes.read';
delete from public.platform_permissions where key = 'customer_notes.read';

drop trigger if exists customers_reject_legacy_notes on public.customers;
drop function if exists public.reject_legacy_customer_notes();
comment on column public.customers.notes is null;

drop trigger if exists customer_notes_set_updated_at on public.customer_notes;
drop trigger if exists customer_notes_check_consistency on public.customer_notes;
drop table if exists public.customer_notes;
drop function if exists public.check_customer_note_consistency();

commit;
