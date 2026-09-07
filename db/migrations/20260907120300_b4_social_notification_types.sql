-- FadeUp — B4 chantier 5 (1/2) : types de notifications sociales.
--
-- L'enum notification_type ne portait que des types de réservation et
-- l'invitation d'équipe. Quatre types sociaux s'ajoutent :
--
--   new_follower     — nouveau follower (professionnel ou organisation)
--   post_liked       — like sur une publication
--   review_received  — nouvel avis reçu
--   review_reply     — réponse publique du professionnel à un avis
--
-- PAS de type de commentaire : il n'y a pas de commentaires (décision
-- produit verrouillée, MASTER_SPEC §11).
--
-- Fichier séparé exprès : une valeur d'enum ajoutée n'est pas utilisable
-- dans la transaction qui l'ajoute — les triggers qui s'en servent arrivent
-- dans 20260907120500, après commit de celle-ci.
--
-- Idempotent : if not exists.

alter type public.notification_type add value if not exists 'new_follower';
alter type public.notification_type add value if not exists 'post_liked';
alter type public.notification_type add value if not exists 'review_received';
alter type public.notification_type add value if not exists 'review_reply';
