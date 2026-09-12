/**
 * M1c-a — POURQUOI un jeton push n'a pas pu être obtenu, dit honnêtement.
 *
 * Trois causes n'ont rien à voir avec le client et ne doivent JAMAIS lui être
 * présentées comme un échec de sa part, ni comme un succès :
 *
 *   expoGo        — depuis le SDK 53, Expo Go ne porte plus le push distant.
 *                   Un build de développement est nécessaire. C'est le cas de
 *                   TOUTE vérification faite aujourd'hui, faute de licence
 *                   Apple (rapport M1c-a §4).
 *   noProjectId   — `getExpoPushTokenAsync` exige un identifiant de projet
 *                   Expo (`extra.eas.projectId`). Le compte Expo est gratuit
 *                   et n'a rien à voir avec Apple, mais il n'existe pas encore.
 *   notADevice    — un simulateur n'a pas d'APNs.
 *
 * Module PUR : aucune dépendance Expo, testable sous Node.
 */

export type PushUnavailableReason =
  | 'expo_go'
  | 'no_project_id'
  | 'not_a_device'
  | 'permission_denied'
  | 'network'
  | 'unknown'

interface ErrorLike {
  code?: string
  message?: string
}

/**
 * Classe l'échec d'obtention d'un jeton. Le code d'erreur d'Expo prime sur le
 * texte du message : un message est traduit et déplacé, un code non.
 */
export function classifyPushFailure(raw: unknown): PushUnavailableReason {
  const error = (typeof raw === 'object' && raw !== null ? raw : {}) as ErrorLike
  const code = error.code ?? ''
  const message = error.message ?? ''

  if (code === 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' || /no "?projectid"?/i.test(message)) {
    return 'no_project_id'
  }
  if (/expo go/i.test(message)) return 'expo_go'
  if (code === 'ERR_UNAVAILABLE' || /must use physical device|simulator/i.test(message)) {
    return 'not_a_device'
  }
  if (/denied|permission/i.test(message)) return 'permission_denied'
  if (code === 'ERR_TIMEOUT' || /network|timeout|fetch|offline/i.test(message)) return 'network'
  return 'unknown'
}

/**
 * La clé i18n du message rendu au client. `null` = NE RIEN DIRE : une
 * indisponibilité technique (Expo Go, projet non configuré, simulateur) est
 * notre problème, pas le sien — l'écran de suivi garde alors son comportement
 * de M1b (il reste éveillé), et rien ne promet une notification.
 */
export function pushUnavailableMessageKey(reason: PushUnavailableReason): string | null {
  switch (reason) {
    case 'permission_denied':
      return 'mobile.push.deniedHint'
    case 'network':
      return 'mobile.push.networkHint'
    case 'expo_go':
    case 'no_project_id':
    case 'not_a_device':
    case 'unknown':
      return null
  }
}
