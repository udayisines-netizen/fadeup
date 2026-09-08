-- FadeUp — P1PRO (1/2) : type de notification de la contre-proposition.
--
--   booking_counter_proposed — le salon propose un autre horaire pour une
--   demande en attente. Le client est notifié (in-app + e-mail) et doit
--   répondre avant l'échéance.
--
-- Fichier séparé exprès : une valeur d'enum ajoutée n'est pas utilisable
-- dans la transaction qui l'ajoute — les RPC qui l'émettent arrivent dans
-- 20260908031000, après commit de celle-ci (même motif que B4 et F1b).
--
-- À APPLIQUER EN postgres. Idempotent : if not exists.

alter type public.notification_type add value if not exists 'booking_counter_proposed';
