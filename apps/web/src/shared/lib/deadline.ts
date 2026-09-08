/**
 * L'échéance d'une demande en attente — lue depuis `expires_at`, JAMAIS
 * recalculée : B2 la plafonne en base par `least(TTL org, starts_at)` et
 * cette loi ne vit qu'à un seul endroit.
 *
 * Ici ne vivent que des DÉRIVÉS d'affichage purs, testés :
 *  - le temps restant, jamais négatif (une échéance dépassée dit « expiré »,
 *    pas « -3 min ») ;
 *  - la fenêtre d'annulation libre de 12 h (MASTER_SPEC §6) — l'annulation
 *    reste PERMISE après, elle est simplement dite « tardive » avant le
 *    geste ; aucune pénalité n'existe (aucun moyen de paiement).
 */

/** Millisecondes restantes, bornées à zéro. */
export function remainingMs(deadlineIso: string, now: Date): number {
  const deadline = Date.parse(deadlineIso)
  if (Number.isNaN(deadline)) return 0
  return Math.max(0, deadline - now.getTime())
}

export function isExpired(deadlineIso: string, now: Date): boolean {
  return remainingMs(deadlineIso, now) === 0
}

/**
 * Le temps restant, en unités lisibles. `null` quand l'échéance est passée —
 * l'appelant affiche alors l'état « expiré », jamais un nombre négatif.
 */
export function remainingParts(deadlineIso: string, now: Date): { hours: number; minutes: number } | null {
  const ms = remainingMs(deadlineIso, now)
  if (ms === 0) return null
  const totalMinutes = Math.ceil(ms / 60_000)
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 }
}

/** Fenêtre d'annulation libre : jusqu'à 12 h avant le début (MASTER_SPEC §6). */
export const FREE_CANCEL_HOURS = 12

export function isLateCancellation(startsAtIso: string, now: Date): boolean {
  const starts = Date.parse(startsAtIso)
  if (Number.isNaN(starts)) return false
  return starts - now.getTime() < FREE_CANCEL_HOURS * 3_600_000
}
