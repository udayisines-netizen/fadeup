// FadeUp — X2 : point d'entrée des webhooks Resend (délivrabilité e-mail).
//
// ============================================================================
// LE PARTAGE DES RÔLES — le même que stripe-webhook (B3)
// ============================================================================
//
//   Cette fonction fait EXACTEMENT trois choses, en quelques millisecondes :
//
//     1. vérifier la signature Svix de Resend — et rejeter sans rien écrire ;
//     2. valider la forme minimale de l'événement ;
//     3. insérer l'événement brut dans public.resend_webhook_events et
//        répondre 200.
//
//   Tout le TRAITEMENT (delivered_at sur email_outbox, rebond dur et plainte
//   → prospect_suppressions + do_not_contact) vit dans la base
//   (private.apply_resend_webhook_feedback), exécuté par le scheduler
//   (run_email_feedback_maintenance), testé par verify_x2.sql.
//
// ============================================================================
// LA SIGNATURE SVIX
// ============================================================================
//
//   Resend signe via Svix : trois en-têtes (svix-id, svix-timestamp,
//   svix-signature), un secret `whsec_<base64>`, et une signature
//   HMAC-SHA256 en base64 sur `${svix-id}.${svix-timestamp}.${corps brut}`.
//   L'en-tête svix-signature peut porter PLUSIEURS signatures séparées par
//   des espaces, chacune préfixée par sa version (`v1,<base64>`) — le cas
//   normal après une rotation de secret.
//
//   svix-id est unique par événement : c'est la clé primaire de la table,
//   donc l'idempotence — un rejeu Resend est un non-événement. Comme pour
//   Stripe : un événement forgé stocké occuperait la ligne du vrai, donc la
//   signature se vérifie AVANT toute écriture, en temps constant, avec une
//   tolérance de cinq minutes sur l'horodatage contre le rejeu.
//
// ============================================================================
// FAIL CLOSED
// ============================================================================
//
//   Sans RESEND_WEBHOOK_SECRET dans l'environnement du conteneur (le point
//   de terminaison n'a pas encore été créé côté Resend — action fondateur,
//   voir docs/frontend/EMAIL_DELIVERABILITY.md), TOUT est rejeté 401. La
//   fonction peut donc être déployée inerte sans ouvrir de porte.

const WEBHOOK_SECRET = Deno.env.get('RESEND_WEBHOOK_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const TOLERANCE_SECONDS = 300

const encoder = new TextEncoder()

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

// Comparaison à temps constant : une comparaison qui court-circuite au
// premier octet différent laisse mesurer combien d'octets sont bons.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifySvixSignature(
  body: string,
  id: string | null,
  timestamp: string | null,
  signatureHeader: string | null,
): Promise<boolean> {
  if (!WEBHOOK_SECRET || !id || !timestamp || !signatureHeader) return false

  const age = Math.abs(Date.now() / 1000 - Number(timestamp))
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false

  // Le secret Svix est `whsec_` + base64 ; la clé HMAC est le DÉCODÉ.
  const rawSecret = WEBHOOK_SECRET.startsWith('whsec_')
    ? WEBHOOK_SECRET.slice('whsec_'.length)
    : WEBHOOK_SECRET
  const keyBytes = base64ToBytes(rawSecret)
  if (!keyBytes || keyBytes.length === 0) return false

  const key = await crypto.subtle.importKey(
    'raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const signed = await crypto.subtle.sign(
    'HMAC', key, encoder.encode(`${id}.${timestamp}.${body}`),
  )
  const expected = bytesToBase64(new Uint8Array(signed))

  // « v1,<base64> v1,<base64> … » — au moins une doit correspondre.
  for (const part of signatureHeader.split(' ')) {
    const [version, sig] = part.split(',', 2)
    if (version === 'v1' && sig && timingSafeEqual(sig, expected)) return true
  }
  return false
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

  const svixId = req.headers.get('svix-id')
  const valid = await verifySvixSignature(
    body, svixId, req.headers.get('svix-timestamp'), req.headers.get('svix-signature'),
  )
  if (!valid) {
    // Rejet, jamais avertissement. Et rien n'est écrit : voir l'en-tête.
    // 401 plutôt que 400 : la distinction que Svix documente pour ses rejets.
    return new Response(JSON.stringify({ error: 'invalid signature' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  let event: { type?: unknown }
  try {
    event = JSON.parse(body)
  } catch {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (typeof event.type !== 'string' || event.type.length === 0 || event.type.length > 100
    || !svixId || svixId.length > 200) {
    return new Response(JSON.stringify({ error: 'invalid payload' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // L'insertion, idempotente : la clé primaire est l'identifiant Svix, et
  // ignore-duplicates fait du rejeu Resend un non-événement.
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/resend_webhook_events?on_conflict=event_id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify({
        event_id: svixId,
        event_type: event.type,
        payload: JSON.parse(body),
      }),
    },
  )

  if (!res.ok) {
    // 500 => Resend re-livrera. C'est le comportement voulu quand la base est
    // indisponible : mieux vaut un rejeu que la perte d'un rebond dur.
    const detail = await res.text()
    console.error('resend-webhook: insert failed', res.status, detail.slice(0, 300))
    return new Response(JSON.stringify({ error: 'storage failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
