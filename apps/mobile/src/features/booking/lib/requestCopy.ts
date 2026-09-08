/**
 * M1b — LA copie de l'écran « demande envoyée », assemblée dans un module
 * PUR, et LA garde de langue qui va avec.
 *
 * Motif : côté web, `noBookedWording.test.tsx` rend le composant et inspecte
 * `container.textContent`. Le mobile ne rend pas de composant sous Node (les
 * tests sont de la logique pure, M1a §10) — alors on inverse la dépendance :
 * TOUTES les chaînes de l'écran sont assemblées ICI, le composant ne fait
 * que les poser, et le test porte donc sur le texte réellement rendu.
 *
 * Loi tenue ici (F4 §2, §3, §9) : une DEMANDE n'est JAMAIS « Réservé » ni
 * « Confirmé ». `expired` est calculé sur `expires_at` LU de la RPC —
 * jamais déduit d'un enum de statut.
 *
 * Une demande expirée n'est NI un no-show NI un refus : on le dit, et on
 * invite à appeler le salon D'ABORD (aucun numéro n'existe en base — le
 * texte le reconnaît honnêtement) avant de proposer une alternative.
 */

/** La signature de `t` de i18next, réduite à ce dont ce module a besoin. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** `remainingParts` (shared/lib/deadline) — jamais négatif, `null` = passé. */
export interface RemainingParts {
  hours: number
  minutes: number
}

/**
 * Le compte à rebours d'une échéance — LA même phrase partout (écran de
 * demande, rangée de « Mes réservations », feuille de détail,
 * contre-proposition). `null` quand l'échéance est passée : on affiche alors
 * l'état expiré, jamais un nombre négatif.
 */
export function countdownText(t: Translate, remaining: RemainingParts | null): string | null {
  if (!remaining) return null
  return t('booking.request.expiresIn', {
    time:
      remaining.hours > 0
        ? t('booking.request.hoursMinutes', { hours: remaining.hours, minutes: remaining.minutes })
        : t('booking.request.minutesOnly', { minutes: remaining.minutes }),
  })
}

export interface RequestSentCopyInput {
  t: Translate
  /** `isExpired(result.expires_at, now)` — sur la valeur BRUTE de la RPC. */
  expired: boolean
  /** L'échéance ABSOLUE déjà formatée dans le fuseau DU LIEU, ou `null`. */
  deadlineAbsolute: string | null
  /** `remainingParts(result.expires_at, now)`. */
  remaining: RemainingParts | null
  /** Le récapitulatif porte-t-il un professionnel nommé ? */
  hasBarber: boolean
  /** Le récapitulatif porte-t-il une ligne prix (`price_cents` non nul) ? */
  hasPrice: boolean
}

/**
 * Toutes les chaînes de l'écran. `null` = la ligne n'existe pas dans cet
 * état (elle n'est pas rendue) — `null` n'est pas une chaîne vide.
 */
export interface RequestSentCopy {
  title: string
  body: string | null
  /**
   * Le libellé du badge d'état. Le composant rend `StateBadge`
   * (`pending-request`), qui lit LA MÊME clé `states.booking.pendingRequest` —
   * la nommer ici met le badge sous la garde de langue.
   */
  badgeLabel: string | null
  deadlineLabel: string | null
  deadlineValue: string | null
  countdown: string | null
  expiredCallFirstTitle: string | null
  expiredCallFirstBody: string | null
  recapServiceLabel: string
  recapProfessionalLabel: string | null
  recapWhenLabel: string
  recapPriceLabel: string | null
  findAlternative: string
  viewBookings: string
}

export function requestSentCopy(input: RequestSentCopyInput): RequestSentCopy {
  const { t, expired } = input
  return {
    title: expired ? t('booking.request.expiredTitle') : t('booking.request.title'),
    body: expired ? t('booking.request.expiredBody') : t('booking.request.body'),
    // Aucun badge d'attente sur une demande expirée : plus rien n'attend.
    badgeLabel: expired ? null : t('states.booking.pendingRequest'),
    deadlineLabel: !expired && input.deadlineAbsolute !== null ? t('booking.request.deadlineLabel') : null,
    deadlineValue: expired ? null : input.deadlineAbsolute,
    countdown: expired ? null : countdownText(t, input.remaining),
    expiredCallFirstTitle: expired ? t('mobile.bookingx.expiredCallFirst') : null,
    expiredCallFirstBody: expired ? t('mobile.bookingx.expiredCallFirstBody') : null,
    recapServiceLabel: t('booking.summary.service'),
    recapProfessionalLabel: input.hasBarber ? t('booking.summary.professional') : null,
    recapWhenLabel: t('booking.summary.when'),
    recapPriceLabel: input.hasPrice ? `${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}` : null,
    findAlternative: t('booking.request.findAlternative'),
    viewBookings: t('booking.request.viewBookings'),
  }
}

/** Les chaînes effectivement rendues, dans l'ordre — la matière du test. */
export function requestSentStrings(copy: RequestSentCopy): string[] {
  return [
    copy.title,
    copy.body,
    copy.badgeLabel,
    copy.deadlineLabel,
    copy.deadlineValue,
    copy.countdown,
    copy.expiredCallFirstTitle,
    copy.expiredCallFirstBody,
    copy.recapServiceLabel,
    copy.recapProfessionalLabel,
    copy.recapWhenLabel,
    copy.recapPriceLabel,
    copy.findAlternative,
    copy.viewBookings,
  ].filter((value): value is string => value !== null)
}
