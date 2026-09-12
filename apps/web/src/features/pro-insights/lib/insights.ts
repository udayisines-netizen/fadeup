/**
 * OS-3 — la logique PURE des insights, testée à part de l'écran.
 *
 * Elle porte une seule règle, et c'est la plus importante du lot :
 * **on n'affiche une variation que quand elle existe.** Le serveur dit
 * (`comparison_available`) si la fenêtre de comparaison est légitime ; cette
 * couche ajoute les cas que seul le couple de valeurs révèle — une base de
 * comparaison à zéro ne produit pas un pourcentage, elle produit une phrase.
 */

/** Le seuil à partir duquel une durée observée vaut d'être annoncée. */
export const DURATION_SAMPLE_FLOOR = 5

export type TrendDirection = 'up' | 'down' | 'flat'

export interface Trend {
  direction: TrendDirection
  /** Entier, en points de pourcentage. Absent quand la base est nulle. */
  percent: number | null
  previous: number
}

/**
 * La variation d'un chiffre contre la période précédente.
 *
 * `null` — donc RIEN à l'écran — dans trois cas distincts, qui sont trois
 * mensonges différents évités :
 *   - `available` faux : la période de comparaison n'existe pas (fenêtre trop
 *     courte, ou organisation plus jeune que la fenêtre) ;
 *   - une des deux valeurs est nulle (donnée absente ≠ zéro) ;
 *   - les deux valeurs sont à zéro : « 0 contre 0 » n'est pas une tendance.
 *
 * Une base à zéro avec un présent non nul est une VRAIE information (« 4, et
 * rien le mois d'avant ») : la direction est rendue, le pourcentage non — une
 * division par zéro ne devient pas « +100 % ».
 */
export function trendFor(current: number | null, previous: number | null, available: boolean): Trend | null {
  if (!available) return null
  if (current === null || previous === null) return null
  if (current === 0 && previous === 0) return null
  if (previous === 0) return { direction: 'up', percent: null, previous }
  if (current === previous) return { direction: 'flat', percent: 0, previous }
  const percent = Math.round(((current - previous) / previous) * 100)
  return { direction: current > previous ? 'up' : 'down', percent: Math.abs(percent), previous }
}

/**
 * Le taux de conversion d'une demande en réservation. `null` quand aucune
 * demande n'est arrivée : un taux sur zéro demande n'existe pas.
 */
export function conversionRate(converted: number | null, received: number | null): number | null {
  if (converted === null || received === null || received <= 0) return null
  return Math.round((converted / received) * 100)
}

/**
 * Le panier moyen calculé côté écran est INTERDIT : le serveur le rend déjà
 * (et à NULL pour qui ne voit pas le revenu). Cette fonction ne fait que
 * décider s'il y a quelque chose à montrer.
 */
export function hasMoney(value: number | null | undefined): value is number {
  return typeof value === 'number'
}

export type DurationVerdict =
  | { kind: 'not-enough'; samples: number }
  | { kind: 'aligned'; declared: number; observed: number; samples: number }
  | { kind: 'gap'; declared: number; observed: number; samples: number; deltaMinutes: number; over: boolean }

/**
 * Ce qu'on peut honnêtement dire d'une durée observée.
 *
 * Sous cinq mesures : rien d'autre que « pas encore assez de mesures » — c'est
 * exactement le seuil auquel l'estimateur de F1b commence lui-même à mélanger
 * l'observé au déclaré, et l'annoncer plus tôt serait annoncer du bruit.
 * Au-delà, un écart de moins d'une minute n'est pas un écart : arrondi à la
 * minute, « 30 contre 30,4 » se dit « conforme ».
 */
export function durationVerdict(
  declaredMinutes: number | null,
  observedMinutes: number | null,
  sampleCount: number,
): DurationVerdict {
  if (sampleCount < DURATION_SAMPLE_FLOOR || observedMinutes === null || declaredMinutes === null) {
    return { kind: 'not-enough', samples: sampleCount }
  }
  const observed = Math.round(observedMinutes)
  const delta = observed - declaredMinutes
  if (Math.abs(delta) < 1) {
    return { kind: 'aligned', declared: declaredMinutes, observed, samples: sampleCount }
  }
  return {
    kind: 'gap',
    declared: declaredMinutes,
    observed,
    samples: sampleCount,
    deltaMinutes: Math.abs(delta),
    over: delta > 0,
  }
}

export type InsightWindowKey = '30d' | '90d' | '12m'

/**
 * Les bornes d'une fenêtre, en ISO. La borne haute est décalée d'une minute
 * dans le futur : le serveur exclut la borne (`< window_to`), et une
 * réservation créée à la seconde même de l'appel appartient bien à la
 * période qu'on regarde.
 */
export function windowBounds(key: InsightWindowKey, now: Date): { from: string; to: string } {
  const to = new Date(now.getTime() + 60_000)
  const from = new Date(to)
  if (key === '30d') from.setUTCDate(from.getUTCDate() - 30)
  else if (key === '90d') from.setUTCDate(from.getUTCDate() - 90)
  else from.setUTCMonth(from.getUTCMonth() - 12)
  return { from: from.toISOString(), to: to.toISOString() }
}

/**
 * Une organisation n'a RIEN à montrer quand elle n'a aucune activité connue —
 * pas quand ses chiffres valent zéro. Un salon ouvert qui n'a eu personne ce
 * mois-ci a de vrais zéros, et les mérite.
 */
export function hasNoHistory(firstActivityAt: string | null): boolean {
  return firstActivityAt === null
}

/**
 * Les vues de profil ne sont mesurées que depuis l'instrumentation R3. Si la
 * fenêtre demandée commence AVANT, le nombre est un sous-compte et l'écran
 * doit le dire au lieu de le présenter comme un total.
 */
export function viewsArePartial(windowFrom: string, analyticsSince: string | null): boolean {
  if (analyticsSince === null) return false
  return Date.parse(analyticsSince) > Date.parse(windowFrom)
}
