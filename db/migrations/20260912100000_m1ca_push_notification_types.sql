-- FadeUp — M1c-a (1/2) : les types de notification que le push introduit.
--
-- Trois événements sur les quatre du lot n'existaient pas dans
-- `notification_type` :
--
--   queue_called       — « c'est ton tour » : le salon vient d'appeler le
--                        client. C'est LE plus important : sans lui, un
--                        téléphone verrouillé n'est pas prévenu, et M1b ne
--                        compense qu'au premier plan (écran maintenu éveillé).
--   booking_reminder   — le rappel avant rendez-vous. Le gabarit e-mail
--                        `booking_reminder` existe en base depuis B2 ; RIEN
--                        ne le déclenchait. La deuxième migration du lot
--                        pose le déclencheur.
--   post_published     — nouveau post d'un professionnel ou d'un salon suivi.
--
-- Le quatrième — demande acceptée ou refusée — réutilise
-- `booking_confirmed` / `booking_declined`, qui existent depuis le lot C.
--
-- Fichier séparé exprès : une valeur d'enum ajoutée n'est pas utilisable dans
-- la transaction qui l'ajoute. Les triggers et les fonctions qui s'en servent
-- arrivent dans 20260912100100, après le commit de celle-ci (même motif que
-- B4 20260907120300 et F1b 20260907152000).
--
-- Idempotent : `if not exists`.

alter type public.notification_type add value if not exists 'queue_called';
alter type public.notification_type add value if not exists 'booking_reminder';
alter type public.notification_type add value if not exists 'post_published';
