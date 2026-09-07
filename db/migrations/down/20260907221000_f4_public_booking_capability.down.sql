-- F4 down — retire la lecture publique de capacité. À APPLIQUER EN postgres.
-- Effet : le tunnel ne peut plus annoncer avant le geste ; aucune donnée touchée.
begin;
drop function if exists public.get_public_booking_capability(text);
commit;
