-- FadeUp — OS-1 (1/2) : blocages de temps RÉCURRENTS — la série.
--
-- MASTER_SPEC §14 : « blocage de temps ponctuel et récurrent ». `time_blocks`
-- porte des lignes ponctuelles et rien d'autre ; `check_appointment_time_blocks`
-- et `compute_available_slots` les lisent ligne par ligne. Une récurrence
-- s'implémente donc en MATÉRIALISANT ses occurrences (une ligne par semaine,
-- bornée : jusqu'à une date, 52 occurrences au plus, côté client), ce qui
-- garde intacts les deux lecteurs existants et leur autorité. Ce que ces
-- lignes perdent sans ce fichier, c'est le lien entre elles : « supprimer la
-- série » devient impossible. `series_id` est ce lien, et rien de plus.
--
-- Écriture : inchangée — INSERT/DELETE directs sous RLS (`time_blocks_insert`
-- / `time_blocks_delete` : gestionnaires ou le barber lui-même), une série
-- s'insère en UN INSERT multi-lignes (atomique) et se retire par
-- `delete … where series_id = …` (RLS ligne par ligne).
--
-- À APPLIQUER EN supabase_admin : `public.time_blocks` lui appartient
-- (DB_OWNERSHIP règle 2, mesuré le 2026-09-11 : relowner = supabase_admin).
-- Le fichier ne touche rien d'autre — le reste d'OS-1 est en postgres
-- (20260911101000).

set lock_timeout = '5s';

begin;

alter table public.time_blocks
  add column series_id uuid;

comment on column public.time_blocks.series_id is
  'OS-1 — identifiant de SÉRIE d''un blocage récurrent : chaque occurrence est une ligne ordinaire (les lecteurs existants ne changent pas), la série est le lien qui permet de la retirer d''un coup. NULL = blocage ponctuel. Généré côté client (uuid v4) au moment de l''insertion multi-lignes.';

create index time_blocks_series_idx
  on public.time_blocks (series_id)
  where series_id is not null;

commit;
