-- Retour arrière — OS-2 fiches clients.
-- Rôle : postgres. Fonctions de lecture seulement : rien à restaurer.
begin;
drop function if exists public.get_organization_customer_history(uuid, integer);
drop function if exists public.get_organization_customer(uuid);
drop function if exists public.list_organization_customers(uuid, text, text, integer, integer);
drop function if exists private.customer_visit_stats(uuid);
commit;
