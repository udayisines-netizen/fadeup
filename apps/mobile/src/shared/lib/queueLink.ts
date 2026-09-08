/**
 * LE lien que le QR du salon encode : `/q/<slug>?l=<locationId>&t=<jeton>`.
 * Consulter ne demande rien ; rejoindre exige le jeton (et la position, que
 * le navigateur fournit au moment du geste). Le même écran sert les deux —
 * ouvert depuis chez soi sans `t`, ou depuis le QR avec.
 */

export interface QueueLinkParts {
  slug: string
  locationId: string | null
  checkInToken: string | null
}

const TOKEN_SHAPE = /^[0-9a-f]{32}$/

/** Construit le chemin encodé dans le QR (jeton inclus). */
export function buildQueueLink(origin: string, slug: string, locationId: string, checkInToken?: string): string {
  const url = new URL(`/q/${encodeURIComponent(slug)}`, origin)
  url.searchParams.set('l', locationId)
  if (checkInToken) url.searchParams.set('t', checkInToken)
  return url.toString()
}

/**
 * Relit un lien scanné (QRScanner) ou l'URL courante. Retourne `null` si la
 * valeur n'est pas un lien de file FadeUp. Le jeton ne passe que s'il a la
 * forme exacte imposée par la contrainte `locations_queue_check_in_token_shape`.
 */
export function parseQueueLink(value: string): QueueLinkParts | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const match = /^\/q\/([^/]+)$/.exec(url.pathname)
  if (!match?.[1]) return null
  const token = url.searchParams.get('t')
  return {
    slug: decodeURIComponent(match[1]),
    locationId: url.searchParams.get('l'),
    checkInToken: token && TOKEN_SHAPE.test(token) ? token : null,
  }
}
