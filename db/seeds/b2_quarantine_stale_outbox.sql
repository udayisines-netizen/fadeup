-- FadeUp — B2 : mettre en quarantaine la file d'attente antérieure à l'expéditeur.
--
-- LE PROBLÈME, TROUVÉ EN TESTANT L'EXPÉDITEUR
--
-- `email_outbox` contenait 15 lignes `queued` au moment où B2 lui a donné un
-- facteur. Elles s'y étaient accumulées depuis R1A parce que rien ne les
-- vidait. Brancher l'expéditeur sans rien faire les aurait toutes envoyées au
-- premier tick, et c'est exactement ce que la première exécution de test a
-- fait — sur la base de restauration, où pg_net ne traite rien, donc sans
-- conséquence. En production, cela aurait produit :
--
--   - des « votre candidature est acceptée » vieux de 6 à 21 jours partant
--     vers de vraies adresses Gmail, sans contexte, trois semaines après la
--     décision ;
--   - six messages vers des adresses en @fadeup.test — un TLD qui n'existe
--     pas — donc six rebonds durs sur un domaine d'envoi neuf, ce qui est la
--     manière la plus rapide d'abîmer une réputation qui n'a pas encore
--     d'historique.
--
-- CE QUE FAIT CE SCRIPT
--
-- Il marque ces lignes `failed` avec un motif explicite. `failed` et non
-- `sent` : elles n'ont jamais été envoyées, et écrire l'inverse serait un
-- mensonge dans la table qui sert de journal de délivrance.
--
-- Il ne supprime rien : la trace de ce qui a été demandé reste lisible, et
-- last_error dit pourquoi ce n'est pas parti.
--
-- BORNE TEMPORELLE. Le script ne touche QUE les lignes créées avant l'heure
-- d'application des migrations B2. Une ligne écrite après — une vraie demande
-- de réservation — n'est pas concernée, et rejouer le script plus tard ne peut
-- pas l'atteindre non plus.
--
-- À exécuter AVANT d'activer l'envoi dans le scheduler.

set lock_timeout = '5s';

begin;

update public.email_outbox
set status = 'failed',
    last_error = 'quarantined by B2: queued before an email sender existed; '
                 || 'delivering it now would surprise the recipient and, for @fadeup.test '
                 || 'fixtures, hard-bounce a brand-new sending domain',
    updated_at = now()
where status = 'queued'
  and created_at < timestamptz '2026-09-04 18:00:00+00';

commit;
