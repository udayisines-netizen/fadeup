/**
 * PLAT-1 — la vue en tant que, dans le navigateur.
 *
 * 1. Un modérateur entre en vue empruntée depuis la fiche d'une organisation ;
 *    on capture le bandeau et on vérifie qu'il n'offre aucune fermeture.
 * 2. Un support et un commercial appellent la RPC DIRECTEMENT (fetch vers
 *    PostgREST avec leur propre jeton) : la réponse doit être un refus.
 * 3. En vue empruntée, une RPC de paiement appelée directement est refusée.
 *
 * Usage : QA_BASE=http://127.0.0.1:4630 node e2e/plat1/platform-support-view.mjs <outdir>
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4630'
const PASSWORD = 'Plat1-QA!2026'
const OUT = process.argv[2] ?? '/tmp/plat1-support-view'
const SUPABASE_URL = process.env.QA_SUPABASE_URL ?? 'http://127.0.0.1:18100'
const ANON_KEY = process.env.QA_ANON_KEY ?? ''
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const result = {}

async function signIn(email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.goto(`${BASE}/platform/login`, { waitUntil: 'networkidle' })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await Promise.all([
    page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 25_000 }),
    page.click('button[type="submit"]'),
  ])
  return { context, page }
}

/**
 * Appelle une RPC comme l'appellerait un attaquant : directement sur
 * PostgREST, avec le jeton du compte connecté, sans passer par l'interface.
 * C'est la seule preuve qui compte — une garde d'interface n'existe pas.
 */
async function callRpc(page, fn, body) {
  return page.evaluate(
    async ([name, payload, url, anon]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const raw = key ? JSON.parse(localStorage.getItem(key)) : null
      const token = raw?.access_token ?? (Array.isArray(raw) ? raw[0] : null)
      const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: anon,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      return { status: response.status, body: (await response.text()).slice(0, 300) }
    },
    [fn, body, SUPABASE_URL, ANON_KEY],
  )
}

// --- 0. Aucune session ouverte au départ -----------------------------------
// La campagne doit partir d'un état connu : une session laissée ouverte par un
// passage précédent désactive le bouton d'entrée et fausse la preuve.
execSync(
  `docker exec fadeup-supabase-db psql -U supabase_admin -d postgres -c "update public.platform_support_sessions set ended_at = now() where ended_at is null;"`,
  { stdio: 'ignore' },
)

// --- 1. Le modérateur entre en vue empruntée --------------------------------
{
  const { context, page } = await signIn('qa-plat1-moderator@fadeup.test')
  await page.goto(`${BASE}/platform/organizations`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const firstOrg = await page.evaluate(
    () => document.querySelector('tbody a[href^="/platform/organizations/"]')?.getAttribute('href') ?? null,
  )
  result.orgHref = firstOrg
  if (firstOrg) {
    await page.goto(`${BASE}${firstOrg}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.screenshot({ path: `${OUT}/moderateur-fiche-org-avant.png`, fullPage: false })
    // Le bandeau porte lui aussi un bouton dont le nom contient « support » et
// il précède le contenu dans le DOM : viser /support/i tombait sur « Exit
// Support View » et refermait la session au lieu de l'ouvrir.
await page.getByRole('button', { name: /enter support view/i }).click()
    await page.waitForTimeout(2000)
    const banner = await page.evaluate(() => {
      const el = document.querySelector('[data-plat1-support-banner]')
      if (!el) return null
      return {
        text: el.innerText.replace(/\s+/g, ' ').trim(),
        buttons: [...el.querySelectorAll('button')].map((b) => b.innerText.trim()),
        position: getComputedStyle(el).position,
        background: getComputedStyle(el).backgroundColor,
      }
    })
    result.banner = banner
    await page.screenshot({ path: `${OUT}/moderateur-vue-empruntee-1440.png`, fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/moderateur-vue-empruntee-390.png`, fullPage: false })
    await page.setViewportSize({ width: 1440, height: 900 })

    // Le bandeau reste en changeant de page : c'est ce qui le rend permanent.
    await page.goto(`${BASE}/platform/applications`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    result.bannerStillThere = await page.evaluate(() => Boolean(document.querySelector('[data-plat1-support-banner]')))
    await page.screenshot({ path: `${OUT}/moderateur-bandeau-persiste.png`, fullPage: false })
  }
  await context.close()
}

// --- 2. Les rôles non habilités appellent la RPC directement ----------------
for (const [label, email] of [
  ['support', 'qa-plat1-support@fadeup.test'],
  ['commercial', 'qa-plat1-sales@fadeup.test'],
  ['stagiaire', 'qa-plat1-intern@fadeup.test'],
]) {
  const { context, page } = await signIn(email)
  await page.goto(`${BASE}/platform`, { waitUntil: 'networkidle' })
  const refusal = await callRpc(page, 'start_platform_support_session', {
    p_organization_id: (result.orgHref ?? '').split('/').pop(),
    p_target_type: 'organization',
  })
  result[`rpcRefusal_${label}`] = refusal
  console.log(`${label} → start_platform_support_session : HTTP ${refusal.status} ${refusal.body.slice(0, 120)}`)
  if (label === 'support') {
    await page.screenshot({ path: `${OUT}/support-console.png`, fullPage: false })
  }
  await context.close()
}

// --- 3. En vue empruntée, le paiement est refusé côté serveur --------------
{
  const { context, page } = await signIn('qa-plat1-founder@fadeup.test')
  const orgId = (result.orgHref ?? '').split('/').pop()
  await page.goto(`${BASE}/platform`, { waitUntil: 'networkidle' })

  // Hors vue empruntée, le fondateur assigne un plan : c'est le point de
  // comparaison. (prepare_billing_portal ne convient pas : elle exige d'être
  // propriétaire de l'organisation, et refuserait pour une autre raison.)
  result.paymentBeforeSupportView = await callRpc(page, 'assign_commercial_plan', {
    p_organization_id: orgId,
    p_plan_key: 'solo',
    p_status: 'active',
    p_note: 'QA PLAT-1 (hors vue empruntée)',
  })
  await callRpc(page, 'start_platform_support_session', { p_organization_id: orgId, p_target_type: 'organization' })
  result.paymentDuringSupportView = await callRpc(page, 'prepare_billing_portal', { p_organization_id: orgId })
  result.planDuringSupportView = await callRpc(page, 'assign_commercial_plan', {
    p_organization_id: orgId,
    p_plan_key: 'solo',
    p_status: 'active',
    p_note: 'QA PLAT-1',
  })

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT}/fondateur-vue-empruntee.png`, fullPage: false })

  // On referme : une session QA ne doit pas rester ouverte.
  const mine = await callRpc(page, 'get_my_platform_permissions', {})
  result.founderPermissions = mine
  await page.evaluate(async ([url, anon]) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
    const raw = key ? JSON.parse(localStorage.getItem(key)) : null
    const token = raw?.access_token ?? (Array.isArray(raw) ? raw[0] : null)
    const sessions = await fetch(`${url}/rest/v1/platform_support_sessions?ended_at=is.null&select=id`, {
      headers: { apikey: anon, authorization: `Bearer ${token}` },
    }).then((r) => r.json())
    for (const s of sessions) {
      await fetch(`${url}/rest/v1/rpc/end_platform_support_session`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: anon, authorization: `Bearer ${token}` },
        body: JSON.stringify({ p_id: s.id }),
      })
    }
  }, [SUPABASE_URL, ANON_KEY])
  console.log('paiement hors vue empruntée  :', result.paymentBeforeSupportView.status)
  console.log('paiement EN vue empruntée    :', result.paymentDuringSupportView.status, result.paymentDuringSupportView.body.slice(0, 130))
  console.log('plan     EN vue empruntée    :', result.planDuringSupportView.status, result.planDuringSupportView.body.slice(0, 130))
  await context.close()
}

await browser.close()
writeFileSync(`${OUT}/support-view.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result.banner, null, 2))
console.log('bandeau encore présent après navigation :', result.bannerStillThere)
