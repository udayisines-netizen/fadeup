import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { proKeys } from '@/shared/data/keys'
import type { BillingInterval, BillingRow, CatalogPlan, TrialRow } from '@/features/pro-billing/lib/billing'

/**
 * OS-3 — la couche de données de l'abonnement.
 *
 * B3 n'a PAS de RPC de lecture d'état : `organization_billing` et
 * `organization_trials` sont lisibles directement, sous une RLS
 * `owner`-seulement (`organization_billing_select_owner`). Lire les tables est
 * donc le contrat, pas un contournement — et c'est la garde la plus solide
 * possible : un manager ne lit ZÉRO ligne, quel que soit le chemin.
 *
 * Les ÉCRITURES passent toutes par la fonction Edge `stripe-billing`, qui
 * transmet le jeton de l'appelant aux RPC de B3. Chacune commence par
 * `private.assert_not_in_support_view` puis `private.assert_billing_owner` :
 * aucune décision n'est prise dans l'Edge, et aucun geste de paiement n'est
 * possible en vue empruntée.
 *
 * MOYEN DE PAIEMENT ET FACTURES : ils n'existent PAS en base, et ce lot n'en
 * fabrique pas. Ils vivent chez Stripe et le portail client (configuré par
 * B3) est le seul endroit où les lire. L'écran le dit plutôt que d'afficher
 * une carte inventée.
 */

const BILLING_COLUMNS =
  'subscription_status, plan_key, billing_interval, current_period_start, current_period_end, cancel_at_period_end, grace_until, scheduled_plan_key, scheduled_interval, scheduled_effective_at, stripe_customer_id, stripe_subscription_id'

export interface BillingState {
  billing: BillingRow | null
  trial: TrialRow | null
  openQuote: { id: string; establishments_requested: number; created_at: string } | null
}

/**
 * Un seul hook pour l'état : trois lectures qui ne valent que ensemble, et
 * qui échouent ensemble pour un rôle non propriétaire.
 */
export function useBillingState(organizationId: string | null, enabled = true) {
  return useQuery({
    queryKey: proKeys.billingState(organizationId ?? ''),
    queryFn: async (): Promise<BillingState> => {
      const supabase = getSupabase()
      const [billing, trial, quote] = await Promise.all([
        supabase.from('organization_billing').select(BILLING_COLUMNS).eq('organization_id', organizationId ?? '').maybeSingle(),
        supabase
          .from('organization_trials')
          .select('plan_key, started_at, ends_at, status')
          .eq('organization_id', organizationId ?? '')
          .maybeSingle(),
        supabase
          .from('billing_quote_requests')
          .select('id, establishments_requested, created_at')
          .eq('organization_id', organizationId ?? '')
          .eq('status', 'open')
          .maybeSingle(),
      ])
      if (billing.error) throw billing.error
      if (trial.error) throw trial.error
      if (quote.error) throw quote.error
      return {
        billing: (billing.data as unknown as BillingRow | null) ?? null,
        trial: (trial.data as unknown as TrialRow | null) ?? null,
        openQuote: (quote.data as unknown as BillingState['openQuote']) ?? null,
      }
    },
    enabled: Boolean(organizationId) && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

/** La grille tarifaire RÉELLE, lue en base — jamais un prix codé en dur. */
export function useBillingCatalog() {
  return useQuery({
    queryKey: proKeys.billingCatalog(),
    queryFn: async (): Promise<CatalogPlan[]> => {
      const { data, error } = await getSupabase().rpc('get_billing_catalog')
      if (error) throw error
      return (data ?? []) as unknown as CatalogPlan[]
    },
    staleTime: 10 * 60_000,
  })
}

interface EdgeError extends Error {
  detail?: string
}

/**
 * L'appel de la fonction Edge. `functions.invoke` attache le jeton de session
 * de l'appelant ; l'Edge le transmet tel quel à PostgREST, donc la garde
 * propriétaire de B3 s'applique au même titre qu'en appel direct.
 *
 * Les refus de la base remontent avec LEUR statut (42501 → 403, P0001 → 400)
 * et leur `detail` : on le relaie pour que l'écran puisse nommer le motif.
 */
async function callStripeBilling<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T & { error?: string; detail?: string }>(
    'stripe-billing',
    { body },
  )
  if (error) {
    const response = (error as { context?: Response }).context
    let detail: string | undefined
    let message = error.message
    if (response) {
      try {
        const parsed = (await response.clone().json()) as { error?: string; detail?: string }
        if (parsed.error) message = parsed.error
        if (parsed.detail) detail = parsed.detail
      } catch {
        /* Corps illisible : on garde le message d'origine. */
      }
    }
    const enriched: EdgeError = new Error(message)
    enriched.detail = detail
    throw enriched
  }
  if (!data) throw new Error('stripe-billing returned no body')
  return data
}

function useBillingInvalidation(organizationId: string | null) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: proKeys.billing(organizationId ?? '') })
    // Un changement de plan change le plafond de sollicitations : le quota
    // vit sur le plan effectif.
    void queryClient.invalidateQueries({ queryKey: proKeys.campaigns(organizationId ?? '') })
  }
}

/** Souscrire : une session Stripe Checkout hébergée, TVA et SCA comprises. */
export function useStartCheckout(organizationId: string | null) {
  return useMutation({
    mutationFn: (input: { planKey: string; interval: BillingInterval }) =>
      callStripeBilling<{ url: string }>({
        action: 'checkout',
        organization_id: organizationId,
        plan_key: input.planKey,
        interval: input.interval,
        // On impose les URL de retour : les défauts de l'Edge pointent sur
        // /pro/billing, qui n'est qu'une redirection vers cet écran.
        success_url: `${window.location.origin}/dashboard/billing?checkout=success`,
        cancel_url: `${window.location.origin}/dashboard/billing?checkout=cancelled`,
      }),
  })
}

/** Le portail client Stripe : moyen de paiement, factures, adresse, TVA. */
export function useOpenPortal(organizationId: string | null) {
  return useMutation({
    mutationFn: () =>
      callStripeBilling<{ url: string }>({
        action: 'portal',
        organization_id: organizationId,
        return_url: `${window.location.origin}/dashboard/billing`,
      }),
  })
}

/**
 * Changer de plan. La base décide : montée IMMÉDIATE proratisée, descente à
 * la fin de la période — l'écran ne choisit pas, il affiche `decision`.
 */
export function useChangePlan(organizationId: string | null) {
  const invalidate = useBillingInvalidation(organizationId)
  return useMutation({
    mutationFn: (input: { planKey: string; interval: BillingInterval }) =>
      callStripeBilling<{ decision: 'immediate' | 'scheduled'; effective_at: string }>({
        action: 'change_plan',
        organization_id: organizationId,
        plan_key: input.planKey,
        interval: input.interval,
      }),
    onSuccess: invalidate,
  })
}

export function useCancelSubscription(organizationId: string | null) {
  const invalidate = useBillingInvalidation(organizationId)
  return useMutation({
    mutationFn: () =>
      callStripeBilling<{ cancelled_at_period_end: boolean; effective_at: string }>({
        action: 'cancel',
        organization_id: organizationId,
      }),
    onSuccess: invalidate,
  })
}

/** L'essai de 14 jours, sans carte. RPC directe : aucun objet Stripe. */
export function useStartTrial(organizationId: string | null) {
  const invalidate = useBillingInvalidation(organizationId)
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabase().rpc('start_organization_trial', {
        p_organization_id: organizationId ?? '',
      })
      if (error) throw error
      return (data ?? []) as unknown as Array<{ plan_key: string; started_at: string; ends_at: string }>
    },
    onSuccess: invalidate,
  })
}

/** Au-delà du dernier palier : un devis, jamais un blocage. */
export function useRequestQuote(organizationId: string | null) {
  const invalidate = useBillingInvalidation(organizationId)
  return useMutation({
    mutationFn: async (input: { establishments: number; note?: string }) => {
      const { data, error } = await getSupabase().rpc('request_billing_quote', {
        p_organization_id: organizationId ?? '',
        p_establishments: input.establishments,
        ...(input.note ? { p_note: input.note } : {}),
      })
      if (error) throw error
      return data as unknown as string
    },
    onSuccess: invalidate,
  })
}
