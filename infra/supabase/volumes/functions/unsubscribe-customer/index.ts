// FadeUp — OS-3 : le désabonnement marketing d'un CLIENT de salon.
//
// Jumelle de `unsubscribe/` (X2), qui traite les PROSPECTS — des
// professionnels démarchés par FadeUp. Ici, la population est autre : les
// clients d'un salon qui reçoivent les sollicitations du §4 d'OS-3. Deux
// fonctions plutôt qu'un aiguillage dans une seule, parce qu'un jeton de
// prospect et un jeton de client n'ont pas le même espace de noms et qu'un
// jeton inconnu ne doit JAMAIS être essayé sur les deux tables : ce serait
// exactement l'oracle d'existence que les deux RPC évitent.
//
// L'en-tête List-Unsubscribe des sollicitations pointe ici :
// https://fade-up.com/functions/v1/unsubscribe-customer/<token>
//
//   GET  → redirection 303 vers la page humaine /unsubscribe/salon/<token>
//          (les scanners d'e-mails suivent les liens : un GET ne change
//          JAMAIS d'état ici) ;
//   POST → le One-Click machine de RFC 8058 (List-Unsubscribe-Post) →
//          `unsubscribe_customer_marketing`, qui répond toujours vrai.
//
// Le jeton EST la capacité (32 hexadécimaux, posé à la première
// sollicitation) : pas d'autre authentification, comme la RPC elle-même.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function tokenFromPath(pathname: string): string | null {
  // /unsubscribe-customer/<token> une fois le préfixe /functions/v1 retiré
  // par Kong.
  const match = /^\/unsubscribe-customer\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname)
  return match?.[1] ?? null
}

Deno.serve(async (req: Request) => {
  const token = tokenFromPath(new URL(req.url).pathname)
  if (!token) {
    return new Response(JSON.stringify({ error: 'missing token' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return new Response(null, {
      status: 303,
      headers: { Location: `https://fade-up.com/unsubscribe/salon/${token}` },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', Allow: 'GET, POST' },
    })
  }

  // La RPC anon d'OS-3 : do_not_contact sur toutes les fiches de l'adresse,
  // et retrait des sollicitations déjà en file. Toujours « vrai ».
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unsubscribe_customer_marketing`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ p_token: token }),
  })

  if (!res.ok) {
    // 500 => le client mail pourra réessayer ; le lien humain reste valable.
    const detail = await res.text()
    console.error('unsubscribe-customer: rpc failed', res.status, detail.slice(0, 300))
    return new Response(JSON.stringify({ error: 'unsubscribe failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ unsubscribed: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
