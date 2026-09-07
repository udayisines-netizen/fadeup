/**
 * F2 — horaires d'ouverture publics d'un lieu.
 *
 * Les lignes de `list_public_location_hours` sont des heures MURALES du lieu
 * (time without time zone, convention de la table : day_of_week 0 = dimanche).
 * « Ouvert maintenant » se calcule donc dans le FUSEAU DU LIEU
 * (`locations.timezone`), jamais dans celui de l'appareil — un client
 * parisien qui regarde un salon de Londres voit l'état de Londres.
 */

export interface PublicLocationHoursRow {
  day_of_week: number
  is_closed: boolean
  open_time: string | null
  close_time: string | null
  second_open_time: string | null
  second_close_time: string | null
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

/** « 10:00:00 » -> minutes depuis minuit. null/malformé -> null. */
function wallMinutes(time: string | null): number | null {
  if (!time) return null
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  return hours * 60 + minutes
}

/** Jour (0 = dimanche) et minutes murales de `now` DANS le fuseau donné. */
export function wallClockIn(timezone: string, now: Date): { day: number; minutes: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
    const hour = Number(parts.find((p) => p.type === 'hour')?.value)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value)
    const day = WEEKDAY_INDEX[weekday]
    if (day === undefined || Number.isNaN(hour) || Number.isNaN(minute)) return null
    // Intl rend parfois « 24 » pour minuit en hour12:false — normalisé.
    return { day, minutes: (hour % 24) * 60 + minute }
  } catch {
    // Fuseau inconnu de l'environnement : on ne DEVINE pas un état d'ouverture.
    return null
  }
}

/**
 * true / false = état réel calculé ; null = indéterminable (aucune ligne pour
 * ce jour, fuseau invalide…) — l'interface n'affiche alors AUCUN état
 * ouvert/fermé, jamais un état inventé.
 */
export function isOpenNow(
  rows: readonly PublicLocationHoursRow[],
  timezone: string,
  now: Date = new Date(),
): boolean | null {
  if (rows.length === 0) return null
  const wall = wallClockIn(timezone, now)
  if (!wall) return null
  const row = rows.find((r) => r.day_of_week === wall.day)
  if (!row) return null
  if (row.is_closed) return false

  const inInterval = (open: string | null, close: string | null): boolean => {
    const openMin = wallMinutes(open)
    const closeMin = wallMinutes(close)
    if (openMin === null || closeMin === null) return false
    return wall.minutes >= openMin && wall.minutes < closeMin
  }

  return (
    inInterval(row.open_time, row.close_time) ||
    inInterval(row.second_open_time, row.second_close_time)
  )
}

/** « 10:00:00 » -> libellé localisé (« 10:00 » / « 10:00 AM »). */
export function formatWallTime(time: string, locale: string): string {
  const minutes = wallMinutes(time)
  if (minutes === null) return time
  // Date arbitraire en UTC portant l'heure murale : seul le rendu compte.
  const date = new Date(Date.UTC(2026, 0, 1, Math.floor(minutes / 60), minutes % 60))
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(date)
}

/** Une entrée de semaine : la ligne réelle, ou `null` = jour NON RENSEIGNÉ
 *  (distinct de « fermé » — on n'invente pas la fermeture d'un jour absent). */
export interface WeekEntry {
  day: number
  row: PublicLocationHoursRow | null
}

/** Les 7 jours dans l'ordre local (lundi d'abord en fr/en — convention produit). */
export function orderedWeek(rows: readonly PublicLocationHoursRow[]): WeekEntry[] {
  const byDay = new Map(rows.map((row) => [row.day_of_week, row]))
  return [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, row: byDay.get(day) ?? null }))
}
