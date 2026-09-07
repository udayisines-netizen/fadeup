-- Retour arrière F1 : retire le GRANT. Remet l'état B1 (transitions de file
-- impossibles via l'API — l'état défectueux d'origine, à ne restaurer que
-- pour un retour arrière complet du lot).
revoke execute on function private.queue_stage(public.queue_status) from authenticated;
