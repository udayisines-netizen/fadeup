/**
 * M1b — LA logique du suivi de place, extraite du composant pour être testée
 * sous Node : ce module n'importe NI React Native, NI Expo, NI le client
 * Supabase. Il ne fabrique aucune donnée — il ne fait que dériver ce qui est
 * affichable de ce que la base a répondu.
 *
 * Trois lois y vivent, celles qui coûtent cher quand on les rate :
 *  - le compte à rebours n'est JAMAIS négatif : sans échéance il n'existe
 *    pas, échéance dépassée il bascule sur « le délai est écoulé » ;
 *  - un état d'écran par état réel de l'entrée — et pour les sorties, la
 *    distinction entre un balayage automatique (sans reproche) et une
 *    clôture décidée par le salon ;
 *  - l'estimation d'attente ne s'affiche que si la base en fournit une
 *    fiable ET qu'il reste quelqu'un devant (le point de vérité des minutes
 *    reste `formatEstimatedWait`, jamais un calcul local).
 */
import { formatEstimatedWait } from '@/shared/lib/waitTime'

/** Statuts de `queue_entries` tels que la RPC de suivi les expose. */
export type TrackedStatus =
  | 'waiting'
  | 'called'
  | 'in_service'
  | 'completed'
  | 'cancelled'
  | 'no_show'

/**
 * La part de `QueueEntryTracking` dont la dérivation a besoin — structurel à
 * dessein : le type de l'API (copie verbatim du web) reste assignable ici
 * sans que ce module dépende de la couche data.
 */
export interface TrackedEntryLike {
  status: TrackedStatus
  /** true = sorti par le balayage de grâce, pas par un geste du salon. */
  removed_automatically: boolean
}

/** Les quatre fins possibles — chacune a son titre et son texte i18n. */
export type EndedKey = 'completed' | 'left' | 'removedAuto' | 'removedManual'

export type TrackingView =
  /** Première réponse pas encore arrivée : rien n'est affirmé. */
  | { kind: 'loading' }
  /** Le serveur ne connaît plus cette entrée (entry_not_found au poll). */
  | { kind: 'gone' }
  | { kind: 'waiting' }
  | { kind: 'called' }
  | { kind: 'in_service' }
  | { kind: 'ended'; key: EndedKey }

/**
 * L'état d'écran du suivi. `gone` PRIME sur tout : si le serveur ne reconnaît
 * plus l'entrée, la dernière donnée reçue ne veut plus rien dire.
 */
export function deriveTrackingView(entry: TrackedEntryLike | null, gone: boolean): TrackingView {
  if (gone) return { kind: 'gone' }
  if (!entry) return { kind: 'loading' }
  switch (entry.status) {
    case 'waiting':
      return { kind: 'waiting' }
    case 'called':
      return { kind: 'called' }
    case 'in_service':
      return { kind: 'in_service' }
    case 'completed':
      return { kind: 'ended', key: 'completed' }
    case 'cancelled':
      return { kind: 'ended', key: 'left' }
    case 'no_show':
      return { kind: 'ended', key: entry.removed_automatically ? 'removedAuto' : 'removedManual' }
  }
}

/**
 * `m:ss` à partir d'un reste en millisecondes. `null` = RIEN à afficher :
 * pas d'échéance (null en entrée) ou échéance atteinte/dépassée — l'appelant
 * bascule alors sur `queue.track.deadlinePassed`, jamais sur un nombre
 * négatif.
 */
export function formatCountdown(remainingMs: number | null): string | null {
  if (remainingMs === null || !Number.isFinite(remainingMs)) return null
  if (remainingMs <= 0) return null
  const totalSeconds = Math.floor(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export type CalledCountdown =
  /** Aucune échéance publiée : l'appel reste visible SANS minutes. */
  | { kind: 'none' }
  | { kind: 'countdown'; label: string }
  | { kind: 'passed' }

/**
 * L'échéance d'appel (`called_deadline_at`, absolue, calculée serveur) vue
 * par l'écran. Une date illisible est traitée comme une absence d'échéance —
 * jamais comme un délai écoulé.
 */
export function deriveCalledCountdown(
  deadlineIso: string | null | undefined,
  now: Date,
): CalledCountdown {
  if (!deadlineIso) return { kind: 'none' }
  const deadline = Date.parse(deadlineIso)
  if (Number.isNaN(deadline)) return { kind: 'none' }
  const label = formatCountdown(deadline - now.getTime())
  return label === null ? { kind: 'passed' } : { kind: 'countdown', label }
}

/**
 * Minutes d'attente AFFICHABLES sur le suivi, ou `null`. Reprend la garde du
 * web (QueueTracking) : une estimation fiable ne s'affiche que s'il reste
 * quelqu'un devant — sinon le chiffre de position dit déjà tout.
 */
export function displayableWaitMinutes(
  estimatedMinutes: number | null | undefined,
  peopleAhead: number | null | undefined,
): number | null {
  const wait = formatEstimatedWait(estimatedMinutes ?? null)
  if (!wait) return null
  if (peopleAhead === null || peopleAhead === undefined || peopleAhead <= 0) return null
  return wait.minutes
}

/**
 * La clé i18n du « nombre devant vous ». Zéro a son propre libellé — « Vous
 * êtes le prochain », pas « 0 personne devant vous » — et on le désigne
 * EXPLICITEMENT plutôt que de dépendre du suffixe `_zero` d'i18next : la
 * phrase existe dans les deux catalogues, elle doit sortir à coup sûr.
 * `null` (nombre inconnu) = aucune ligne, jamais un zéro inventé.
 */
export function peopleAheadLabelKey(count: number | null | undefined): string | null {
  if (count === null || count === undefined || !Number.isFinite(count)) return null
  return count === 0 ? 'queue.track.peopleAhead_zero' : 'queue.track.peopleAhead'
}
