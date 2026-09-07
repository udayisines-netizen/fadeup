# FadeUp — suivi d'erreurs frontend (X1)

## État

L'intégration est **complète et inerte** : sans `VITE_SENTRY_DSN` au moment de
la build, aucun SDK n'est téléchargé, aucun octet ne s'ajoute au bundle
d'entrée, aucun appel réseau ne part. Le jour où le fondateur crée le projet
Sentry, activer le suivi = passer une variable de build. Aucun code à écrire.

## Ce qui est couvert (`src/shared/observability/errorReporting.ts`)

- **Erreurs de rendu** : la boundary globale (`components/error-boundary.tsx`,
  au-dessus du router) et la `RouteErrorBoundary` (errorElement racine du
  router, par laquelle passent les erreurs de rendu des quatre shells —
  Consumer, Pro, Marketing, Platform). Les 404 ne sont pas signalés.
- **Erreurs de mutation** : `MutationCache.onError` du QueryClient unique —
  chaque action utilisateur qui n'a pas pris effet laisse une trace.
- **Échecs realtime** : trois échecs consécutifs de souscription d'un canal
  (`useChannel`) — un raté isolé est un aléa réseau, pas un événement.
- **Erreurs non attrapées** : handlers globaux du SDK
  (onerror/onunhandledrejection), actifs dès l'init.

Le SDK est chargé par import dynamique dans son propre chunk : l'entrée
consumer ne le porte jamais (budget 180 Ko gzip).

## Aucune donnée personnelle — vérifié

Configuration mesurée sur une erreur réelle (voir rapport X1) :

- `sendDefaultPii: false`, `event.user` supprimé dans `beforeSend` ;
- en-têtes, cookies et corps de requête supprimés ;
- **toutes les URL sont tronquées à `?` et `#`** (événement et fils
  d'Ariane) : un filtre PostgREST (`?email=eq.…`) ou un fragment de session
  (`/auth/callback#access_token=…`) ne partent jamais ;
- fils d'Ariane `console` supprimés (ils peuvent citer du contenu) ;
- pas de replay, pas de tracing, pas de session tracking.

## Ce que le fondateur doit créer

1. Compte Sentry (niveau gratuit — 5 000 erreurs/mois, largement assez) et
   un projet **React**. Région de stockage : UE.
2. Récupérer le **DSN** du projet (Settings → Client Keys). Le DSN est
   public par construction.
3. Déploiement : ajouter à `infra/web/.env` la ligne
   `VITE_SENTRY_DSN=<dsn>` puis passer l'ARG dans
   `infra/web/docker-compose.yml`/`Dockerfile` (même mécanique que
   `VITE_SUPABASE_URL`) et reconstruire `fadeup-web`. Poser aussi
   `VITE_SENTRY_RELEASE` (recommandé : `git describe --always`).
4. Cartes source (traces lisibles) : créer un **auth token** interne
   (scope `project:releases`) — c'est un **secret**, uniquement en variable
   d'environnement — puis, à chaque release :

   ```bash
   SENTRY_AUTH_TOKEN=… SENTRY_ORG=… SENTRY_PROJECT=… \
   VITE_SENTRY_RELEASE=$(git describe --always) \
   node scripts/sentry-sourcemaps.mjs
   ```

   Le script émet les cartes (`sourcemap: 'hidden'` — le JS reste identique
   octet pour octet à la build servie), les téléverse, puis les **supprime** :
   la build déployée ne contient jamais de `.map`, donc rien n'est servi
   publiquement.

## Fonctions Edge — décision

Les deux fonctions Stripe de B3 ne sont **pas** instrumentées par Sentry dans
X1 : il n'existe pas encore de DSN, et modifier du code de webhook de
facturation en production sans pouvoir observer le résultat est un risque
supérieur au gain. Le mode de défaillance qui compte — « un webhook échoue en
silence » — est couvert autrement et dès maintenant : la supervision X1 lit
`public.stripe_webhook_events` toutes les 5 minutes et alerte si un événement
reste non `processed` plus d'une heure (voir `infra/ops/monitor.sh`).
Instrumenter les fonctions Edge (`@sentry/deno`) devient pertinent quand le
projet Sentry existera — à faire dans le lot billing suivant.
