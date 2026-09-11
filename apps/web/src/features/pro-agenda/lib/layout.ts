/**
 * OS-1 — positionnement et conflits de l'agenda. Pur, testé en Vitest.
 *
 * - `positionInDay` : où dessiner un objet dans une colonne temporelle.
 * - `assignLanes` : deux objets qui se chevauchent dans une même colonne se
 *   partagent la largeur (le chevauchement FORCÉ est précisément le cas où
 *   ça arrive).
 * - `findConflicts` : l'avertissement AVANT le geste — même règle que la
 *   contrainte serveur (plages tampons comprises, cancelled/no_show exclus,
 *   les lignes terminées RETIENNENT leur créneau — piège P1PRO).
 * - `visibleHourRange` : la fenêtre d'heures à dessiner.
 */

import { minutesOfDayInZone } from '@/features/pro-agenda/lib/time'

export type AgendaStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'

export interface AgendaAppointment {
  id: string
  starts_at: string
  ends_at: string
  status: AgendaStatus
  barber_id: string | null
  buffer_before_minutes: number
  buffer_after_minutes: number
  overlap_forced_at: string | null
}

export interface AgendaTimeBlock {
  id: string
  starts_at: string
  ends_at: string
  barber_id: string
}

export interface Interval {
  start: number // ms epoch
  end: number
}

export interface Placement {
  top: number
  height: number
}

/**
 * Position verticale d'une plage dans une colonne « jour » qui commence à
 * `startHour` avec `hourHeight` px par heure. Les plages qui débordent la
 * fenêtre sont tronquées à ses bords (jamais négatives).
 */
export function positionInDay(
  starts: Date,
  ends: Date,
  timezone: string,
  startHour: number,
  endHour: number,
  hourHeight: number,
  dayStartsAt: Date,
): Placement {
  const dayStart = dayStartsAt.getTime()
  const dayEnd = dayStart + 24 * 60 * 60_000
  // Une plage qui commence la veille : on dessine sa portion du jour.
  const s = Math.max(starts.getTime(), dayStart)
  const e = Math.min(ends.getTime(), dayEnd)
  const startMin = s === dayStart ? 0 : minutesOfDayInZone(new Date(s), timezone)
  const endMin = e === dayEnd ? 24 * 60 : minutesOfDayInZone(new Date(e), timezone)
  const perMinute = hourHeight / 60
  const top = (startMin - startHour * 60) * perMinute
  const bottom = (endMin - startHour * 60) * perMinute
  const windowHeight = (endHour - startHour) * hourHeight
  const clampedTop = Math.max(0, Math.min(windowHeight, top))
  const clampedBottom = Math.max(clampedTop, Math.min(windowHeight, bottom))
  return { top: clampedTop, height: Math.max(0, clampedBottom - clampedTop) }
}

export interface Laned<T> {
  item: T
  lane: number
  lanes: number
}

/**
 * Répartition en couloirs : les objets qui se chevauchent (au sens strict,
 * `[start, end)`) reçoivent des couloirs distincts ; un groupe connexe
 * partage le même nombre de couloirs. Algorithme glouton sur le tri par
 * début — suffisant pour une colonne d'agenda (quelques dizaines d'objets).
 */
export function assignLanes<T>(items: T[], interval: (item: T) => Interval): Laned<T>[] {
  const sorted = [...items].sort((a, b) => interval(a).start - interval(b).start || interval(a).end - interval(b).end)
  const result: Laned<T>[] = []
  let cluster: Laned<T>[] = []
  let clusterEnd = -Infinity
  let laneEnds: number[] = []

  const flush = () => {
    const lanes = laneEnds.length
    for (const entry of cluster) entry.lanes = lanes
    result.push(...cluster)
    cluster = []
    laneEnds = []
  }

  for (const item of sorted) {
    const { start, end } = interval(item)
    if (cluster.length > 0 && start >= clusterEnd) flush()
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(end)
    } else {
      laneEnds[lane] = end
    }
    cluster.push({ item, lane, lanes: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }
  if (cluster.length > 0) flush()
  return result
}

/** La plage BLOQUÉE d'un rendez-vous, tampons compris — ce que la contrainte voit. */
export function blockedInterval(a: Pick<AgendaAppointment, 'starts_at' | 'ends_at' | 'buffer_before_minutes' | 'buffer_after_minutes'>): Interval {
  return {
    start: Date.parse(a.starts_at) - a.buffer_before_minutes * 60_000,
    end: Date.parse(a.ends_at) + a.buffer_after_minutes * 60_000,
  }
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/** Un rendez-vous retient son créneau tant qu'il n'est ni annulé ni absent. */
export function holdsSlot(status: AgendaStatus): boolean {
  return status !== 'cancelled' && status !== 'no_show'
}

export interface ConflictCandidate {
  excludeId?: string
  barberId: string
  starts: Date
  ends: Date
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
}

export interface ConflictReport<A extends AgendaAppointment, B extends AgendaTimeBlock> {
  appointments: A[]
  blocks: B[]
  /** true si au moins un conflit existe. */
  any: boolean
}

/**
 * Les conflits qu'un dépôt provoquerait — même règle que le serveur :
 * rendez-vous actifs du même barber dont la plage bloquée croise la nôtre
 * (tampons des deux côtés), blocages de temps du barber (SANS tampons :
 * un blocage est l'indisponibilité déclarée, pas un rendez-vous).
 */
export function findConflicts<A extends AgendaAppointment, B extends AgendaTimeBlock>(
  candidate: ConflictCandidate,
  appointments: readonly A[],
  blocks: readonly B[],
): ConflictReport<A, B> {
  const mine: Interval = {
    start: candidate.starts.getTime() - candidate.bufferBeforeMinutes * 60_000,
    end: candidate.ends.getTime() + candidate.bufferAfterMinutes * 60_000,
  }
  const raw: Interval = { start: candidate.starts.getTime(), end: candidate.ends.getTime() }
  const conflictingAppointments = appointments.filter(
    (a) =>
      a.id !== candidate.excludeId &&
      a.barber_id === candidate.barberId &&
      holdsSlot(a.status) &&
      intervalsOverlap(mine, blockedInterval(a)),
  )
  const conflictingBlocks = blocks.filter(
    (b) => b.barber_id === candidate.barberId && intervalsOverlap(raw, { start: Date.parse(b.starts_at), end: Date.parse(b.ends_at) }),
  )
  return {
    appointments: conflictingAppointments,
    blocks: conflictingBlocks,
    any: conflictingAppointments.length > 0 || conflictingBlocks.length > 0,
  }
}

/**
 * La fenêtre d'heures dessinée : 8 h–20 h par défaut (huit à douze heures
 * visibles), élargie à l'heure pleine pour englober tout objet qui déborde.
 */
export function visibleHourRange(
  intervals: readonly { startMinutes: number; endMinutes: number }[],
  defaults: { start: number; end: number } = { start: 8, end: 20 },
): { start: number; end: number } {
  let start = defaults.start
  let end = defaults.end
  for (const { startMinutes, endMinutes } of intervals) {
    start = Math.min(start, Math.floor(startMinutes / 60))
    end = Math.max(end, Math.ceil(endMinutes / 60))
  }
  return { start: Math.max(0, start), end: Math.min(24, Math.max(end, start + 1)) }
}

/** Durée en minutes entières d'une plage ISO. */
export function durationMinutes(startsAt: string, endsAt: string): number {
  return Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000)
}
