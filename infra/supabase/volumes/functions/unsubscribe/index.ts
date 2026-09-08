// FadeUp — X2 : le désabonnement en un clic (RFC 8058) et la porte humaine.
//
// L'en-tête List-Unsubscribe des e-mails de prospection et d'information
// pointe ici : https://fade-up.com/functions/v1/unsubscribe/<token>.
//
//   GET  → redirection 303 vers la page humaine /unsubscribe/<token>
//          (confirmation explicite — les scanners d'e-mails suivent les
//          liens, un GET ne change JAMAIS d'état) ;
//   POST → le One-Click machine des clients mail (List-Unsubscribe-Post) :
//          désabonnement immédiat via la RPC B2, qui répond toujours vrai
//          (anti-énumération) — un jeton inconnu est un non-événement.
//
// Sans cette fonction, un client mail honorant One-Click POSTait sur la SPA,
// recevait l'index HTML, et rien n'était enregistré (revue X2, BLOCKERS
// §14.1). Le jeton est une capacité (32 hex, généré par B2) : pas d'autre
// authentification, comme la RPC elle-même.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000'
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

function tokenFromPath(pathname: string): string | null {
  // /unsubscribe/<token> une fois le préfixe /functions/v1 retiré par Kong.
  const match = /^\/unsubscribe\/([A-Za-z0-9_-]{1,128})\/?$/.exec(pathname)
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
      headers: { Location: `https://fade-up.com/unsubscribe/${token}` },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', Allow: 'GET, POST' },
    })
  }

  // La RPC anon B2 : do_not_contact + suppression durable, toujours « vrai ».
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/unsubscribe_prospect_outreach`, {
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
    console.error('unsubscribe: rpc failed', res.status, detail.slice(0, 300))
    return new Response(JSON.stringify({ error: 'unsubscribe failed' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ unsubscribed: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
