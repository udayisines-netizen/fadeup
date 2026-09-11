/**
 * OS-1 — le temps de l'agenda, dans le FUSEAU DU LIEU (MASTER_SPEC §19 :
 * « affichage pro dans le fuseau du lieu »). Tout instant est UTC en base ;
 * la grille raisonne en « jour local » (clé `YYYY-MM-DD`) et en « minutes
 * depuis minuit local ». Aucune bibliothèque : `Intl` suffit, et il n'y a
 * qu'une conversion à faire correctement.
 *
 * Pur, sans DOM — testé en Vitest.
 */

export type DayKey = string // 'YYYY-MM-DD'


interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatter(timezone: string): Intl.DateTimeFormat {
  let dtf = partsCache.get(timezone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    partsCache.set(timezone, dtf)
  }
  return dtf
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = formatter(timezone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour') % 24, minute: read('minute') }
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Clé de jour local (`YYYY-MM-DD`) d'un instant dans un fuseau. */
export function dayKeyInZone(date: Date, timezone: string): DayKey {
  const p = zonedParts(date, timezone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Minutes écoulées depuis minuit LOCAL pour un instant (0..1439). */
export function minutesOfDayInZone(date: Date, timezone: string): number {
  const p = zonedParts(date, timezone)
  return p.hour * 60 + p.minute
}

export function parseDayKey(key: DayKey): { year: number; month: number; day: number } {
  const [y, m, d] = key.split('-').map(Number)
  return { year: y ?? 1970, month: m ?? 1, day: d ?? 1 }
}

/**
 * L'instant de minuit LOCAL d'un jour dans un fuseau. Deux passes : on part
 * de minuit UTC, on mesure l'écart local, on corrige — une seconde passe
 * absorbe un changement d'heure survenu entre les deux.
 */
export function zonedDayStart(key: DayKey, timezone: string): Date {
  return instantAt(key, 0, timezone)
}

/**
 * L'instant « ce jour local à N minutes après minuit ». La cible (jour +
 * minutes) est écrite comme si elle était UTC ; on cherche l'instant dont
 * la lecture locale vaut exactement cette cible — deux passes absorbent un
 * changement d'heure. Une heure locale inexistante (le trou du passage à
 * l'heure d'été) tombe sur l'heure qui la suit.
 */
export function instantAt(key: DayKey, minutes: number, timezone: string): Date {
  const { year, month, day } = parseDayKey(key)
  const target = Date.UTC(year, month - 1, day, 0, minutes, 0, 0)
  let guess = target
  for (let pass = 0; pass < 2; pass += 1) {
    const p = zonedParts(new Date(guess), timezone)
    const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, 0, 0)
    const delta = localAsUtc - target
    if (delta === 0) break
    guess -= delta
  }
  return new Date(guess)
}

/** Ajoute des jours CIVILS à une clé (sans passer par un fuseau). */
export function addDays(key: DayKey, days: number): DayKey {
  const { year, month, day } = parseDayKey(key)
  const d = new Date(Date.UTC(year, month - 1, day + days))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** 0 = dimanche … 6 = samedi, pour une clé de jour. */
export function weekdayOf(key: DayKey): number {
  const { year, month, day } = parseDayKey(key)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Les 7 clés de la semaine contenant `key`, lundi en tête. */
export function weekOf(key: DayKey): DayKey[] {
  const offset = (weekdayOf(key) + 6) % 7 // lundi = 0
  const monday = addDays(key, -offset)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** Arrondi d'une position en minutes au pas donné (5 min par défaut). */
export function snapMinutes(minutes: number, step = 5): number {
  return Math.round(minutes / step) * step
}

/** Clamp d'une valeur de minutes dans une plage [min, max]. */
export function clampMinutes(minutes: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, minutes))
}

