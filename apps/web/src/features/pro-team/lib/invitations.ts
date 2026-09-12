/**
 * OS-2 — l'échéance d'une invitation, lue honnêtement.
 *
 * Sept jours, usage unique (migration OS-2 §2). Le reste se compte en jours
 * PLEINS restants : une invitation qui expire dans trois heures n'est pas
 * expirée, il lui reste zéro jour plein. « 0 jour » et « expirée » sont deux
 * états distincts — les confondre ferait disparaître un lien encore valide.
 */

export interface InvitationExpiry {
  expired: boolean
  /** Jours PLEINS restants (0 quand il reste moins de 24 h, jamais négatif). */
  days: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function invitationExpiry(
  expiresAt: string | Date | null,
  now: Date | number,
): InvitationExpiry {
  if (expiresAt === null) return { expired: false, days: 0 }
  const end = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt)
  /* Une date illisible n'est pas une date expirée : on ne fabrique pas un
     état opérationnel à partir d'une donnée absente. */
  if (Number.isNaN(end)) return { expired: false, days: 0 }
  const from = now instanceof Date ? now.getTime() : now
  const remaining = end - from
  if (remaining <= 0) return { expired: true, days: 0 }
  return { expired: false, days: Math.floor(remaining / DAY_MS) }
}
