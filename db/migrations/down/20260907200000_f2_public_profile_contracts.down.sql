-- F2 — retour arrière : retire les trois lectures publiques ajoutées par
-- 20260907200000_f2_public_profile_contracts.sql. Purement destructeur de
-- fonctions NEUVES : aucune table, aucune colonne, aucune fonction préexistante
-- n'a été touchée par le up — le down ne recrée donc rien.
--
-- Conséquence honnête : tout front déployé qui appellerait ces RPC recevrait
-- de nouveau 404 (fonction inconnue) — c'est l'état d'avant F2.

begin;

drop function if exists public.get_public_professional_workplace(uuid);
drop function if exists public.list_public_location_hours(text, uuid);
drop function if exists public.get_public_organization_follower_count(uuid);

commit;
