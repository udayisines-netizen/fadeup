/**
 * OS-3 §5 — la logique PURE du billing.
 *
 * B3 a tout construit en base ; il manquait un écran. Cette couche traduit
 * l'état brut de `organization_billing` / `organization_trials` en ce que le
 * professionnel doit LIRE, sans jamais inventer une date ni dramatiser un
 * échec de paiement.
 */

export type BillingInterval = 'month' | 'year'

export interface BillingRow {
  subscription_status: string | null
  plan_key: string | null
  billing_interval: BillingInterval | null
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  /** Fin des sept jours de grâce ouverts par un échec de paiement. */
  grace_until: string | null
  scheduled_plan_key: string | null
  scheduled_interval: BillingInterval | null
  scheduled_effective_at: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
}

export interface TrialRow {
  plan_key: string
  started_at: string
  ends_at: string
  status: 'active' | 'converted' | 'expired'
}

export type BillingSituation =
  /** Aucun abonnement, aucun essai : le salon est au Free. */
  | { kind: 'free' }
  /** Un essai court, jamais relançable. */
  | { kind: 'trial'; endsAt: string; daysLeft: number; planKey: string }
  /** Un essai échu sans souscription : retour au Free, rien perdu. */
  | { kind: 'trial-expired'; endsAt: string }
  /** Abonnement sain. */
  | { kind: 'active'; planKey: string; interval: BillingInterval | null; renewsAt: string | null }
  /** Paiement échoué : grâce de sept jours, capacités CONSERVÉES. */
  | { kind: 'grace'; planKey: string; graceUntil: string; daysLeft: number }
  /** Résiliation programmée en fin de période. */
  | { kind: 'cancelling'; planKey: string; endsAt: string | null }
  /** Abonnement clos. */
  | { kind: 'canceled'; planKey: string | null }

const DAY_MS = 86_400_000

/** Jours ENTIERS restants, jamais négatifs. Zéro = « aujourd'hui ». */
export function daysUntil(iso: string | null, now: Date): number {
  if (iso === null) return 0
  return Math.max(0, Math.ceil((Date.parse(iso) - now.getTime()) / DAY_MS))
}

/**
 * LA situation, dans l'ordre de priorité d'affichage.
 *
 * La grâce passe AVANT l'état « active » parce qu'un abonnement `past_due`
 * garde ses capacités (B3 : `effective_plan_key` ne dégrade que sur
 * `canceled`) — dire « actif » serait vrai mais tairait la seule chose que le
 * professionnel doit faire.
 */
export function billingSituation(
  billing: BillingRow | null,
  trial: TrialRow | null,
  now: Date,
): BillingSituation {
  if (billing && billing.grace_until !== null && Date.parse(billing.grace_until) > now.getTime()) {
    return {
      kind: 'grace',
      planKey: billing.plan_key ?? '',
      graceUntil: billing.grace_until,
      daysLeft: daysUntil(billing.grace_until, now),
    }
  }
  if (billing && billing.cancel_at_period_end && billing.subscription_status !== 'canceled') {
    return { kind: 'cancelling', planKey: billing.plan_key ?? '', endsAt: billing.current_period_end }
  }
  if (billing && (billing.subscription_status === 'active' || billing.subscription_status === 'trialing')) {
    return {
      kind: 'active',
      planKey: billing.plan_key ?? '',
      interval: billing.billing_interval,
      renewsAt: billing.current_period_end,
    }
  }
  if (billing && billing.subscription_status === 'past_due') {
    // `past_due` sans `grace_until` : la passe de facturation n'a pas encore
    // ouvert la grâce. On ne fabrique pas sa date — on montre l'état.
    return { kind: 'grace', planKey: billing.plan_key ?? '', graceUntil: '', daysLeft: 0 }
  }
  if (trial && trial.status === 'active' && Date.parse(trial.ends_at) > now.getTime()) {
    return {
      kind: 'trial',
      endsAt: trial.ends_at,
      daysLeft: daysUntil(trial.ends_at, now),
      planKey: trial.plan_key,
    }
  }
  if (trial && trial.status === 'expired') {
    return { kind: 'trial-expired', endsAt: trial.ends_at }
  }
  if (billing && billing.subscription_status === 'canceled') {
    return { kind: 'canceled', planKey: billing.plan_key }
  }
  return { kind: 'free' }
}

/** L'essai n'est JAMAIS relançable : une seule ligne par organisation (B3). */
export function canStartTrial(trial: TrialRow | null, situation: BillingSituation): boolean {
  if (trial !== null) return false
  return situation.kind === 'free'
}

export interface CatalogPlan {
  plan_key: string
  commercial_family: string
  display_name: string
  tier: number
  is_recommended: boolean
  is_available: boolean
  price_minor: number
  annual_price_minor: number | null
  annual_months_charged: number
  price_currency: string
  min_establishments: number
  max_establishments: number
  max_operational_professionals: number | null
  monthly_stripe_price_id: string | null
  annual_stripe_price_id: string | null
  live_capabilities: string[]
}

/**
 * Les plans à PROPOSER, et dans quel ordre.
 *
 * Un salon à un établissement voit les plans mono-établissement ; dès qu'il en
 * a deux, il voit la famille multi. On ne cache jamais le palier courant, même
 * dépassé — B3 ne bloque JAMAIS la croissance : au-delà de quinze
 * établissements le devis remplace le tarif, il ne ferme rien.
 */
export function plansFor(catalog: CatalogPlan[], establishments: number): CatalogPlan[] {
  const wantsMulti = establishments >= 2
  return catalog
    .filter((plan) => plan.is_available && plan.price_minor > 0)
    .filter((plan) => (wantsMulti ? plan.commercial_family === 'multi_salon' : plan.commercial_family !== 'multi_salon'))
    .sort((a, b) => a.price_minor - b.price_minor)
}

/** Au-delà du dernier palier, c'est un devis — jamais un refus. */
export function needsQuote(catalog: CatalogPlan[], establishments: number): boolean {
  if (establishments < 2) return false
  const ceiling = catalog
    .filter((plan) => plan.commercial_family === 'multi_salon' && plan.is_available)
    .reduce((max, plan) => Math.max(max, plan.max_establishments), 0)
  return ceiling > 0 && establishments > ceiling
}

/** Le palier qui couvre N établissements, ou `null` si N sort de la grille. */
export function tierFor(catalog: CatalogPlan[], establishments: number): CatalogPlan | null {
  return (
    catalog.find(
      (plan) =>
        plan.commercial_family === 'multi_salon' &&
        plan.is_available &&
        establishments >= plan.min_establishments &&
        establishments <= plan.max_establishments,
    ) ?? null
  )
}

/**
 * Le prix affiché d'un plan pour l'intervalle choisi. L'annuel est une colonne
 * GÉNÉRÉE en base (`price_minor × annual_months_charged`) : on ne le calcule
 * jamais ici, on le lit — deux mois offerts ne doivent pas dépendre d'un
 * arrondi d'écran.
 */
export function priceFor(plan: CatalogPlan, interval: BillingInterval): number | null {
  return interval === 'year' ? plan.annual_price_minor : plan.price_minor
}

/** Combien de mois sont offerts sur l'annuel, d'après la base seule. */
export function annualMonthsFree(plan: CatalogPlan): number {
  return Math.max(0, 12 - plan.annual_months_charged)
}

/**
 * L'intervalle est-il proposable ? Un plan sans prix Stripe pour cet
 * intervalle ne peut pas être souscrit : on ne rend pas un bouton qui
 * échouerait.
 */
export function intervalAvailable(plan: CatalogPlan, interval: BillingInterval): boolean {
  return interval === 'year' ? plan.annual_stripe_price_id !== null : plan.monthly_stripe_price_id !== null
}

/** Le motif de refus NOMMÉ que la fonction Edge relaie depuis la base. */
export function parseBillingRefusal(error: unknown): string | null {
  const candidate = error as { message?: unknown; detail?: unknown; details?: unknown } | null
  for (const field of [candidate?.detail, candidate?.details, candidate?.message]) {
    if (typeof field === 'string') {
      const match = /fadeup_(?:support_view|billing)_refusal=([a-z_]+)/.exec(field)
      if (match?.[1]) return match[1]
    }
  }
  return null
}
