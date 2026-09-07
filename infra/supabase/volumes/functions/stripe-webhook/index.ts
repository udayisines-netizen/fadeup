// FadeUp — B3 : point d'entrée des webhooks Stripe.
//
// ============================================================================
// LE PARTAGE DES RÔLES
// ============================================================================
//
//   Cette fonction fait EXACTEMENT trois choses, en quelques millisecondes :
//
//     1. vérifier la signature Stripe — et rejeter en 400 sans rien écrire ;
//     2. refuser tout événement de mode réel tant que FadeUp est en mode test ;
//     3. insérer l'événement brut dans public.stripe_webhook_events et
//        répondre 200.
//
//   Tout le TRAITEMENT (traduire un abonnement en plan, ouvrir une grâce,
//   revenir au Free) vit dans la base, exécuté par le scheduler
//   (run_billing_maintenance) — même partage que l'envoi d'e-mails de B2 :
//   l'entrée est mince, la logique est en SQL où la suite VERIFY la teste.
//
//   Un webhook qui met huit secondes à répondre finit désactivé par Stripe ;
//   celui-ci ne fait qu'une vérification HMAC et un INSERT.
//
// ============================================================================
// POURQUOI LA SIGNATURE SE VÉRIFIE ICI, AVANT TOUTE ÉCRITURE
// ============================================================================
//
//   La clé primaire de stripe_webhook_events est l'identifiant d'événement
//   Stripe : c'est elle qui donne l'idempotence. Si un événement FORGÉ était
//   stocké puis rejeté au traitement, son identifiant occuperait la ligne, et
//   le VRAI événement portant le même identifiant serait pris pour un rejeu
//   et perdu. Un événement non signé n'atteint donc jamais la base.
//
//   Le point d'entrée est joignable publiquement et n'accepte que Stripe :
//   la signature est la seule barrière, et elle suffit si elle est vérifiée
//   correctement — HMAC-SHA256 sur `t.corps`, comparaison à temps constant,
//   tolérance de cinq minutes sur l'horodatage contre le rejeu.
//
// ============================================================================
// SECRETS
// ============================================================================
//
//   STRIPE_WEBHOOK_SECRET arrive par l'environnement du conteneur (déclaré
//   dans docker-compose.yml comme référence ${...}, valeur dans .env non
//   suivi). Il n'est jamais journalisé, jamais renvoyé, jamais dans une
//   variable VITE_*.

const WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const TOLERANCE_SECONDS = 300

const encoder = new TextEncoder()

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Comparaison à temps constant : une comparaison qui court-circuite au
// premier octet différent laisse mesurer combien d'octets sont bons.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyStripeSignature(body: string, header: string | null): Promise<boolean> {
  if (!header || !WEBHOOK_SECRET) return false

  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2)
    if (k === 't') timestamp = v
    if (k === 'v1' && v) signatures.push(v)
  }
  if (!timestamp || signatures.length === 0) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

  const expected = await hmacSha256Hex(WEBHOOK_SECRET, `${timestamp}.${body}`)
  return signatures.some((s) => timingSafeEqual(s, expected))
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST' },
    })
  }

  // Le corps BRUT : la signature couvre les octets exacts, pas un JSON
  // re-sérialisé.
  const body = await req.text()

  const valid = await verifyStripeSignature(body, req.headers.get('stripe-signature'))
  if (!valid) {
    // Rejet, jamais avertissement. Et rien n'est écrit : voir l'en-tête.
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  let event: { id?: unknown; type?: unknown; livemode?: unknown }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(event.id)
    || typeof event.type !== 'string' || typeof event.livemode !== 'boolean') {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // MODE TEST UNIQUEMENT. Un événement de mode réel signé avec le même secret
  // n'existe pas (les secrets diffèrent par mode), mais la barrière est
  // explicite quand même — et la base la re-vérifie de son côté.
  if (event.livemode !== false) {
    return new Response(JSON.stringify({ error: 'live mode not enabled' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // L'insertion, idempotente : la clé primaire est event_id, et
  // ignore-duplicates fait du rejeu Stripe un non-événement.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/stripe_webhook_events?on_conflict=event_id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
        payload: JSON.parse(body),
      }),
    },
  )

  if (!res.ok) {
    // 500 => Stripe re-livrera. C'est le comportement voulu quand la base est
    // indisponible : mieux vaut un rejeu que la perte d'un événement.
    const detail = await res.text()
    console.error('stripe-webhook: insert failed', res.status, detail.slice(0, 300))
    return new Response(JSON.stringify({ error: 'storage failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
