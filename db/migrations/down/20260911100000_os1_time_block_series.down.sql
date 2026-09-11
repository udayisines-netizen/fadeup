-- OS-1 (1/2) — retour arrière de la série de blocages.
--
-- Retire l'index et la colonne. Les occurrences matérialisées RESTENT (ce
-- sont des blocages valides, ligne par ligne) ; seul le lien de série est
-- perdu — assumé, une série se retire alors occurrence par occurrence.
--
-- À APPLIQUER EN supabase_admin (propriétaire de public.time_blocks).

set lock_timeout = '5s';

begin;

drop index if exists public.time_blocks_series_idx;

alter table public.time_blocks
  drop column if exists series_id;

commit;
