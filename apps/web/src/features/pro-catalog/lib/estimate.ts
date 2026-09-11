/**
 * OS-2 — dire au professionnel ce que sa durée ANNONCÉE change réellement.
 *
 * `private.estimated_service_duration_minutes` mélange déclaré et observé :
 * 100 % de déclaré tant qu'il y a moins de 5 mesures, puis un poids
 * décroissant (n-4)/16 jusqu'à 0 % de déclaré à 20 mesures. La RPC de liste
 * rend déjà `declared_weight_percent` calculé par la base — on ne le
 * recalcule PAS ici, on le TRADUIT en une phrase honnête.
 *
 * Fonction pure : aucune donnée inventée, `observed_minutes` à null veut
 * dire « rien de mesuré », jamais zéro.
 */

/** Seuil de la base : en dessous, l'observé ne pèse rien dans l'estimation. */
export const ESTIMATE_MIN_SAMPLES = 5
/** Au-delà de cet écart relatif, l'estimation est bornée côté serveur. */
export const ESTIMATE_CAP_RATIO = 0.5

export interface EstimateInput {
  /** Nombre de prestations mesurées (`sample_count`). */
  sampleCount: number
  /** Part du déclaré dans l'estimation, en % (`declared_weight_percent`). */
  declaredWeightPercent: number
  /** La durée annoncée, telle qu'elle est SAISIE dans la feuille. */
  declaredMinutes: number
  /** La moyenne observée, ou null quand rien n'a été mesuré. */
  observedMinutes: number | null
}

export type EstimateKey =
  | 'pro.catalog.estimate.declaredOnly'
  | 'pro.catalog.estimate.tooFewSamples'
  | 'pro.catalog.estimate.blended'
  | 'pro.catalog.estimate.observedOnly'

export interface EstimateNotice {
  /** La clé i18n à rendre. */
  key: EstimateKey
  /** Ses interpolations (vide pour `declaredOnly`, qui ne compte rien). */
  params: { count?: number; percent?: number }
  /**
   * Vrai quand l'écart annoncé/observé dépasse 50 % du déclaré avec assez de
   * mesures : la base borne l'estimation, et le professionnel doit le savoir.
   */
  capped: boolean
}

export function estimateNotice(input: EstimateInput): EstimateNotice {
  const { sampleCount, declaredWeightPercent, declaredMinutes, observedMinutes } = input

  const measured = observedMinutes !== null && sampleCount >= ESTIMATE_MIN_SAMPLES

  // Le bornage ne dépend pas de la clé retenue : il se lit dès qu'il y a
  // assez de mesures ET une durée déclarée à comparer.
  const capped =
    measured &&
    declaredMinutes > 0 &&
    Math.abs((observedMinutes as number) - declaredMinutes) > ESTIMATE_CAP_RATIO * declaredMinutes

  if (!measured) {
    // Le client voit exactement la durée annoncée — mais on ne dit pas
    // « aucune prestation mesurée » quand il y en a une à quatre : ce serait
    // faux, et le professionnel a le droit de savoir que le compteur a
    // commencé.
    if (sampleCount > 0) {
      return { key: 'pro.catalog.estimate.tooFewSamples', params: { count: sampleCount }, capped }
    }
    return { key: 'pro.catalog.estimate.declaredOnly', params: {}, capped }
  }

  if (declaredWeightPercent <= 0) {
    return { key: 'pro.catalog.estimate.observedOnly', params: { count: sampleCount }, capped }
  }

  if (declaredWeightPercent < 100) {
    return {
      key: 'pro.catalog.estimate.blended',
      params: { count: sampleCount, percent: declaredWeightPercent },
      capped,
    }
  }

  // Poids de 100 % malgré les mesures : la durée annoncée gouverne encore,
  // et le compteur a bien commencé.
  return { key: 'pro.catalog.estimate.tooFewSamples', params: { count: sampleCount }, capped }
}
