-- FadeUp — F1b chantier 5 (1/2) : type de notification du balayage de grâce.
--
--   queue_grace_removed — le client a été retiré de la file parce que le
--   délai après appel était écoulé (balayage automatique, activable par
--   salon). Formulation JAMAIS culpabilisante : « le délai était écoulé »,
--   pas « vous n'êtes pas venu ».
--
-- Fichier séparé exprès : une valeur d'enum ajoutée n'est pas utilisable
-- dans la transaction qui l'ajoute — run_queue_grace_maintenance arrive
-- dans 20260907153000, après commit de celle-ci (même motif que B4).
--
-- Idempotent : if not exists.

alter type public.notification_type add value if not exists 'queue_grace_removed';
