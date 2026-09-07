/**
 * X1 — suivi d'erreurs frontend (Sentry), chargé paresseusement.
 *
 * DEUX CONTRAINTES STRUCTURENT CE MODULE.
 *
 * 1. Budget : l'entrée consumer doit rester sous 180 Ko gzip. Le SDK Sentry
 *    pèse ~30 Ko gzip — il n'entre donc JAMAIS dans le chunk d'entrée.
 *    `initErrorReporting()` fait un import dynamique, qui ne se déclenche
 *    que si `VITE_SENTRY_DSN` est défini. Sans DSN : zéro octet, zéro appel
 *    réseau. Les erreurs survenues avant la fin du chargement du SDK sont
 *    mises en file et rejouées.
 *
 * 2. RGPD : AUCUNE donnée personnelle ne quitte le navigateur. Ni e-mail, ni
 *    téléphone, ni contenu de formulaire, ni identité utilisateur. La config
 *    par défaut de Sentry capture plus qu'on ne croit : les URL des fils
 *    d'Ariane fetch/xhr peuvent porter des filtres PostgREST
 *    (`?email=eq.…`), et l'URL de la page un fragment de session
 *    (`/auth/callback#access_token=…`). Tout passe donc par `scrubUrl`, les
 *    en-têtes de requête sont supprimés, et `sendDefaultPii` reste false.
 *
 * Le DSN Sentry n'est pas un secret (il finit dans le bundle par
 * construction) ; le jeton d'upload des cartes source, lui, en est un et ne
 * transite que par scripts/sentry-sourcemaps.mjs côté CI/serveur.
 */

type SentryModule = typeof import('@sentry/react')

let sentry: SentryModule | null = null
let initStarted = false

/** Erreurs signalées avant la fin du chargement du SDK. */
const pending: Array<{ error: unknown; context: string }> = []
const PENDING_CAP = 20

/** Retire query string et fragment — les deux véhicules de PII dans une URL. */
function scrubUrl(raw: string): string {
  const cut = raw.search(/[?#]/)
  return cut === -1 ? raw : raw.slice(0, cut)
}

function getDsn(): string | undefined {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined
  return dsn && dsn.length > 0 ? dsn : undefined
}

export function initErrorReporting(): void {
  const dsn = getDsn()
  if (!dsn || initStarted) return
  initStarted = true

  void import('@sentry/react')
    .then((mod) => {
      mod.init({
        dsn,
        release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
        environment: import.meta.env.MODE,
        // Erreurs uniquement : pas de tracing, pas de replay, pas de session —
        // le niveau gratuit couvre le volume et le bundle reste minimal.
        tracesSampleRate: 0,
        sendDefaultPii: false,
        maxBreadcrumbs: 30,
        beforeSend(event) {
          // Jamais d'identité : même un id interne relie l'erreur à une
          // personne ; le diagnostic n'en a pas besoin.
          delete event.user
          if (event.request) {
            delete event.request.headers
            delete event.request.cookies
            delete event.request.data
            if (event.request.url) event.request.url = scrubUrl(event.request.url)
            if (event.request.query_string) delete event.request.query_string
          }
          return event
        },
        beforeBreadcrumb(breadcrumb) {
          // Le contenu tapé par l'utilisateur (console incluse) et les corps
          // de réponse n'apportent rien au diagnostic et peuvent tout porter.
          if (breadcrumb.category === 'console') return null
          if (typeof breadcrumb.data?.url === 'string') {
            breadcrumb.data.url = scrubUrl(breadcrumb.data.url)
          }
          if (typeof breadcrumb.data?.from === 'string') breadcrumb.data.from = scrubUrl(breadcrumb.data.from)
          if (typeof breadcrumb.data?.to === 'string') breadcrumb.data.to = scrubUrl(breadcrumb.data.to)
          return breadcrumb
        },
      })
      sentry = mod
      for (const item of pending.splice(0)) {
        mod.captureException(item.error, { tags: { fadeup_context: item.context } })
      }
    })
    .catch(() => {
      // Un bloqueur de contenu qui refuse le chunk Sentry ne doit jamais
      // casser l'application qu'il était censé observer.
      initStarted = false
    })
}

/**
 * Point d'entrée unique du signalement applicatif : boundaries, mutations,
 * realtime. `context` est une étiquette technique (jamais du contenu).
 */
export function reportError(error: unknown, context: string): void {
  if (!getDsn()) return
  if (sentry) {
    sentry.captureException(error, { tags: { fadeup_context: context } })
  } else if (pending.length < PENDING_CAP) {
    pending.push({ error, context })
  }
}
