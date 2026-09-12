// FadeUp — B3 : entrées-sorties Stripe de la facturation.
//
// ============================================================================
// OÙ EST LA GARDE D'ACCÈS (RÉPONSE : PAS ICI)
// ============================================================================
//
//   Cette fonction ne décide RIEN. Chaque action commence par appeler une RPC
//   de la base avec le jeton DE L'APPELANT (l'en-tête Authorization est
//   transmis tel quel à PostgREST) :
//
//     checkout     -> public.prepare_billing_checkout
//                     puis public.resolve_checkout_discount (PLAT-3)
//     portal       -> public.prepare_billing_portal
//     change_plan  -> public.request_plan_change
//     cancel       -> public.request_billing_cancellation
//
//   C'est LÀ que vit la règle « le propriétaire uniquement », côté serveur,
//   dans du SQL SECURITY DEFINER que la suite VERIFY teste. Un manager qui
//   appelle cette fonction — ou PostgREST directement — reçoit le même refus
//   par le même code. Cette fonction ne fait ensuite que les allers-retours
//   HTTP vers Stripe que la base ne peut pas faire de façon synchrone.
//
// ============================================================================
// CHECKOUT PLUTÔT QUE PAYMENT ELEMENT — DÉCISION TRANCHÉE, VOIR LA MIGRATION
// ============================================================================
//
//   La session Checkout est créée avec :
//     - automatic_tax : Stripe Tax calcule la TVA selon le pays (prix HT) ;
//     - tax_id_collection : le numéro de TVA intracommunautaire est collecté
//       quand le client en a un — autoliquidation hors de France ;
//     - metadata.organization_id sur la session ET l'abonnement : c'est ce
//       qui permet aux webhooks de retrouver l'organisation.
//
// ============================================================================
// MODE TEST
// ============================================================================
//
//   La clé arrive par l'environnement (référence ${...} dans compose, valeur
//   dans .env non suivi). Tant que la base répond livemode=false, une clé qui
//   ne commence pas par sk_test_ est un refus immédiat : le passage en mode
//   réel est une décision du fondateur, pas un accident de configuration.

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const PUBLIC_URL = Deno.env.get('SUPABASE_PUBLIC_URL') ?? 'https://fade-up.com'

const STRIPE_API = 'https://api.stripe.com/v1'

type Json = Record<string, unknown>

function json(status: number, body: Json): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}

// Appel d'une RPC PostgREST AVEC LE JETON DE L'APPELANT. Le refus de la base
// (42501, P0001…) est renvoyé tel quel : le motif est fait pour l'interface.
async function rpc(auth: string, fn: string, args: Json): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: auth,
    },
    body: JSON.stringify(args),
  })
  const data = await res.json().catch(() => null)
  return { ok: res.ok, status: res.status, data }
}

async function stripe(method: string, path: string, params?: URLSearchParams): Promise<{ ok: boolean; data: Json }> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${STRIPE_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params?.toString(),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, data: data as Json }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method not allowed' })
  }

  const auth = req.headers.get('authorization')
  if (!auth) {
    return json(401, { error: 'missing authorization' })
  }

  let body: Json
  try {
    body = await req.json()
  } catch {
    return json(400, { error: 'invalid json body' })
  }

  const action = String(body.action ?? '')
  const organizationId = String(body.organization_id ?? '')
  if (!organizationId) {
    return json(400, { error: 'organization_id is required' })
  }

  try {
    switch (action) {
      // ----------------------------------------------------------- checkout --
      case 'checkout': {
        const prep = await rpc(auth, 'prepare_billing_checkout', {
          p_organization_id: organizationId,
          p_plan_key: String(body.plan_key ?? ''),
          p_interval: String(body.interval ?? 'month'),
        })
        if (!prep.ok) return json(prep.status, { error: (prep.data as Json)?.message ?? 'refused', detail: prep.data })
        const row = Array.isArray(prep.data) ? (prep.data[0] as Json) : (prep.data as Json)
        if (!row) return json(500, { error: 'empty authorization result' })

        // Mode test : la base dit son mode, la clé doit dire le même.
        if (row.livemode === false && !STRIPE_KEY.startsWith('sk_test_')) {
          return json(500, { error: 'refusing non-test Stripe key while billing is in test mode' })
        }

        // Le client Stripe : réutilisé s'il existe, créé sinon — et alors
        // enregistré tout de suite, par une RPC qui reporte la même garde
        // propriétaire.
        let customer = row.stripe_customer_id as string | null
        if (!customer) {
          const created = await stripe('POST', '/customers', new URLSearchParams({
            name: String(row.organization_name ?? ''),
            ...(row.owner_email ? { email: String(row.owner_email) } : {}),
            'metadata[organization_id]': organizationId,
          }))
          if (!created.ok) return json(502, { error: 'stripe customer creation failed', detail: created.data?.error })
          customer = String(created.data.id)
          const rec = await rpc(auth, 'record_billing_customer', {
            p_organization_id: organizationId,
            p_stripe_customer_id: customer,
          })
          if (!rec.ok) return json(rec.status, { error: 'failed to record customer', detail: rec.data })
        }

        const params = new URLSearchParams({
          mode: 'subscription',
          customer,
          'line_items[0][price]': String(row.stripe_price_id),
          'line_items[0][quantity]': '1',
          'automatic_tax[enabled]': 'true',
          'tax_id_collection[enabled]': 'true',
          'customer_update[address]': 'auto',
          'customer_update[name]': 'auto',
          billing_address_collection: 'required',
          'metadata[organization_id]': organizationId,
          'subscription_data[metadata][organization_id]': organizationId,
          success_url: String(body.success_url ?? `${PUBLIC_URL}/pro/billing?checkout=success`),
          cancel_url: String(body.cancel_url ?? `${PUBLIC_URL}/pro/billing?checkout=cancelled`),
        })
        // PLAT-3 — LA REMISE, si le salon en a une.
        //
        // Cette fonction ne DÉCIDE de rien, ici comme ailleurs : elle demande à
        // `resolve_checkout_discount`, qui porte la même garde que
        // `prepare_billing_checkout` (propriétaire, hors vue empruntée) et ne
        // rend un coupon que s'il est confirmé par Stripe et dans le bon mode.
        // Zéro ligne = pas de remise ; on n'ajoute alors AUCUN paramètre, ce
        // qui laisse le comportement d'avant PLAT-3 strictement inchangé.
        //
        // Un échec de cette RPC ne doit pas empêcher un abonnement : mieux vaut
        // encaisser au plein tarif et corriger que refuser la souscription.
        const discount = await rpc(auth, 'resolve_checkout_discount', {
          p_organization_id: organizationId,
        })
        if (discount.ok) {
          const coupon = (discount.data as Array<{ stripe_coupon_id?: string }> | null)?.[0]?.stripe_coupon_id
          if (coupon) params.set('discounts[0][coupon]', String(coupon))
        }

        const session = await stripe('POST', '/checkout/sessions', params)
        if (!session.ok) return json(502, { error: 'stripe checkout session failed', detail: session.data?.error })
        return json(200, { url: session.data.url })
      }

      // ------------------------------------------------------------- portal --
      case 'portal': {
        const prep = await rpc(auth, 'prepare_billing_portal', { p_organization_id: organizationId })
        if (!prep.ok) return json(prep.status, { error: (prep.data as Json)?.message ?? 'refused', detail: prep.data })
        const row = Array.isArray(prep.data) ? (prep.data[0] as Json) : (prep.data as Json)

        const session = await stripe('POST', '/billing_portal/sessions', new URLSearchParams({
          customer: String(row.stripe_customer_id),
          return_url: String(body.return_url ?? `${PUBLIC_URL}/pro/billing`),
        }))
        if (!session.ok) return json(502, { error: 'stripe portal session failed', detail: session.data?.error })
        return json(200, { url: session.data.url })
      }

      // -------------------------------------------------------- change_plan --
      case 'change_plan': {
        const decision = await rpc(auth, 'request_plan_change', {
          p_organization_id: organizationId,
          p_new_plan_key: String(body.plan_key ?? ''),
          p_new_interval: String(body.interval ?? 'month'),
        })
        // Un refus de faisabilité (huit barbers vers solo…) sort ici, avec le
        // motif exploitable écrit par la RPC. Rien n'a été modifié.
        if (!decision.ok) return json(decision.status, { error: (decision.data as Json)?.message ?? 'refused', detail: decision.data })
        const row = Array.isArray(decision.data) ? (decision.data[0] as Json) : (decision.data as Json)

        if (row.decision === 'immediate') {
          // Montée en gamme : appliquée TOUT DE SUITE, proratisée par Stripe.
          // Le webhook subscription.updated mettra la base à jour.
          const updated = await stripe('POST', `/subscriptions/${row.stripe_subscription_id}`, new URLSearchParams({
            'items[0][id]': String(row.stripe_subscription_item_id),
            'items[0][price]': String(row.stripe_price_id),
            proration_behavior: 'create_prorations',
          }))
          if (!updated.ok) return json(502, { error: 'stripe subscription update failed', detail: updated.data?.error })
        }
        // 'scheduled' : la base a tout noté ; le balayage transmettra à la fin
        // de la période payée. Aucune action Stripe maintenant.

        return json(200, { decision: row.decision, effective_at: row.effective_at })
      }

      // ------------------------------------------------------------- cancel --
      case 'cancel': {
        const decision = await rpc(auth, 'request_billing_cancellation', { p_organization_id: organizationId })
        if (!decision.ok) return json(decision.status, { error: (decision.data as Json)?.message ?? 'refused', detail: decision.data })
        const row = Array.isArray(decision.data) ? (decision.data[0] as Json) : (decision.data as Json)

        const updated = await stripe('POST', `/subscriptions/${row.stripe_subscription_id}`, new URLSearchParams({
          cancel_at_period_end: 'true',
        }))
        if (!updated.ok) return json(502, { error: 'stripe cancellation failed', detail: updated.data?.error })
        return json(200, { cancelled_at_period_end: true, effective_at: row.effective_at })
      }

      default:
        return json(400, { error: `unknown action: ${action}` })
    }
  } catch (e) {
    console.error('stripe-billing error', e)
    return json(500, { error: 'internal error' })
  }
})
