/**
 * OS-1 — la récurrence d'un blocage de temps, MATÉRIALISÉE : une ligne par
 * occurrence (hebdomadaire, jusqu'à une date, 52 occurrences au plus), liées
 * par `series_id`. Les occurrences se calculent sur la clé de jour LOCALE et
 * les minutes locales — un blocage « tous les lundis 12 h–13 h » reste à
 * 12 h après un changement d'heure.
 */

import { addDays, dayKeyInZone, instantAt, minutesOfDayInZone, type DayKey } from '@/features/pro-agenda/lib/time'

export const MAX_SERIES_OCCURRENCES = 52

export interface Occurrence {
  starts_at: string
  ends_at: string
}

export interface WeeklySeriesInput {
  starts: Date
  ends: Date
  timezone: string
  /** Dernier jour local inclus (clé `YYYY-MM-DD`). */
  untilDay: DayKey
}

/**
 * Toutes les occurrences hebdomadaires de [starts, ends) jusqu'à `untilDay`
 * inclus, la première étant la plage donnée elle-même. Vide si la plage est
 * invalide. Plafonnée à MAX_SERIES_OCCURRENCES.
 */
export function expandWeekly({ starts, ends, timezone, untilDay }: WeeklySeriesInput): Occurrence[] {
  if (!(ends.getTime() > starts.getTime())) return []
  const firstDay = dayKeyInZone(starts, timezone)
  const startMinutes = minutesOfDayInZone(starts, timezone)
  const durationMs = ends.getTime() - starts.getTime()
  const occurrences: Occurrence[] = []
  let day = firstDay
  while (day <= untilDay && occurrences.length < MAX_SERIES_OCCURRENCES) {
    const s = instantAt(day, startMinutes, timezone)
    occurrences.push({ starts_at: s.toISOString(), ends_at: new Date(s.getTime() + durationMs).toISOString() })
    day = addDays(day, 7)
  }
  return occurrences
}
