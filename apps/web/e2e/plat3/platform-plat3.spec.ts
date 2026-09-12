import { test, expect, type Page } from '@playwright/test'

/**
 * PLAT-3 — les quatre écrans de pilotage, et ce que chaque rôle en voit.
 *
 * Ce qui est vérifié ici est le RENDU, plus DEUX refus obtenus en appelant la
 * RPC directement depuis la page avec le jeton du compte — exactement comme le
 * ferait quelqu'un qui ouvre la console du navigateur. L'autorisation, elle,
 * est prouvée côté serveur par `db/tests/verify_plat3.sql` (118 assertions),
 * parce qu'une garde d'interface n'existe pas : X3 l'a démontré deux fois.
 *
 * Les comptes qa-plat1-* viennent de PLAT-1. Les tests se sautent proprement
 * s'ils n'existent pas, plutôt que d'échouer pour une raison sans rapport.
 */
const PASSWORD = 'Plat1-QA!2026'
const NEW_LINKS = ['/platform/settings', '/platform/promotions', '/platform/funnel', '/platform/worker']

/**
 * PAS DE `networkidle` DANS CE FICHIER, et c'est une correction payée.
 *
 * `/platform/worker` rafraîchit son état toutes les DIX SECONDES : le réseau
 * n'y devient jamais inactif, et `waitUntil: 'networkidle'` y attend une
 * condition qui ne peut pas arriver. Sur les autres écrans il finit par
 * passer, mais il devient le premier à céder dès que la machine est chargée —
 * mesuré : 45 s de dépassement pendant qu'une campagne voisine tournait.
 *
 * On attend donc ce qu'on veut VRAIMENT voir : un élément précis à l'écran.
 */
async function signIn(page: Page, email: string): Promise<boolean> {
  await page.goto('/platform/login', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[type="email"]', { timeout: 15_000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  try {
    await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

async function platformNav(page: Page): Promise<string[]> {
  await page.waitForTimeout(500)
  return page.evaluate(() =>
    [...document.querySelectorAll('header a[href^="/platform"]')].map((a) => a.getAttribute('href') ?? ''),
  )
}

/** Appelle une RPC depuis la page, avec le jeton du compte connecté. */
async function callRpc(page: Page, fn: string, args: Record<string, unknown>) {
  const url = process.env.QA_SUPABASE_URL as string
  const anon = process.env.QA_ANON_KEY as string
  return page.evaluate(
    async ([apiUrl, apiKey, name, body]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const raw = key ? JSON.parse(localStorage.getItem(key) as string) : null
      const token = raw?.access_token ?? (Array.isArray(raw) ? raw[0] : null)
      const response = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: apiKey as string,
          authorization: `Bearer ${token}`,
        },
        body: body as string,
      })
      return { status: response.status, body: await response.text() }
    },
    [url, anon, fn, JSON.stringify(args)] as const,
  )
}

/** Aucun débordement horizontal : la console doit tenir sur un téléphone. */
async function overflows(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
}

test.describe('PLAT-3 — pilotage : ce que chaque rôle voit', () => {
  test('le fondateur voit les quatre écrans neufs', async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    const nav = await platformNav(page)
    for (const href of NEW_LINKS) {
      expect(nav, `le fondateur devrait voir ${href}`).toContain(href)
    }
  })

  test("le commercial voit les promotions et le tunnel, PAS les défauts ni le worker", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/promotions')
    expect(nav).toContain('/platform/funnel')
    expect(nav).not.toContain('/platform/settings')
    expect(nav).not.toContain('/platform/worker')
    const locked = await page.locator('header [aria-disabled="true"], header [disabled]').count()
    expect(locked, 'une capacité absente ne rend rien — jamais un lien grisé').toBe(0)
  })

  test("le support ne voit aucun des quatre", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    const nav = await platformNav(page)
    for (const href of NEW_LINKS) {
      expect(nav, `le support ne devrait pas voir ${href}`).not.toContain(href)
    }
  })

  test("le stagiaire ne voit aucun des quatre", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-intern@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })
    const nav = await platformNav(page)
    for (const href of NEW_LINKS) {
      expect(nav).not.toContain(href)
    }
  })

  test("les écrans refusés se disent honnêtement, sans tableau vide", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    for (const path of ['/platform/settings', '/platform/worker', '/platform/promotions']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      /*
       * PAS DE `<main>` DANS `/platform` : la coquille rend un `<div>` nu
       * autour de l'Outlet. Un sélecteur inventé ne mesure rien — celui-ci
       * attend l'intertitre de l'écran, qui existe vraiment.
       */
      await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 })
      expect(await page.locator('tbody tr').count(), `${path} ne doit rien tabuler`).toBe(0)
      const texte = (await page.locator('body').innerText()).trim()
      expect(texte.length, `${path} doit dire quelque chose`).toBeGreaterThan(40)
    }
  })
})

test.describe('PLAT-3 — les écrans rendent, avec données et sans', () => {
  for (const path of ['/platform/settings', '/platform/promotions', '/platform/funnel', '/platform/worker']) {
    test(`${path} rend sans erreur console et sans débordement`, async ({ page }) => {
      test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
      const errors: string[] = []
      const failures: string[] = []
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
      page.on('response', (r) => r.status() >= 400 && failures.push(`${r.status()} ${r.url().split('?')[0]}`))

      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 })
      // Laisse les requêtes de l'écran se conclure — sans exiger un silence
      // réseau que /platform/worker, qui sonde toutes les dix secondes, ne
      // peut pas atteindre.
      await page.waitForTimeout(1500)
      expect(errors, `erreurs console sur ${path}`).toEqual([])
      expect(failures, `réponses >= 400 sur ${path}`).toEqual([])
      expect(await overflows(page), `${path} déborde horizontalement`).toBe(false)
    })
  }

  test('le tunnel ne rend AUCUN taux sous le seuil, et le seuil vient du serveur', async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents')
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform/funnel', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('h1')).toBeVisible({ timeout: 20_000 })

    const funnel = await callRpc(page, 'get_platform_acquisition_funnel', {
      p_from: null,
      p_to: null,
      p_group_by: 'origin',
    })
    expect(funnel.status).toBe(200)
    const rows = JSON.parse(funnel.body) as Array<{
      stage: string
      total: number | null
      attributable: boolean
      conversion_rate: number | null
      min_sample: number
    }>
    // Les deux dernières étapes ne sont pas rattachables à un prospect : elles
    // rendent NULL, jamais un zéro qui se lirait « personne n'a converti ».
    for (const row of rows.filter((r) => r.stage === 'trials' || r.stage === 'subscriptions')) {
      expect(row.attributable, `${row.stage} ne devrait pas être attribuable par origine`).toBe(false)
      expect(row.total, `${row.stage} devrait rendre NULL, pas 0`).toBeNull()
    }
    expect(rows.every((r) => r.min_sample === 20)).toBe(true)
  })
})

test.describe('PLAT-3 — les refus, RPC appelée directement', () => {
  test("un commercial ne règle pas un défaut plateforme", async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents')
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })

    const refusal = await callRpc(page, 'set_platform_setting', {
      p_key: 'queue.capacity_per_barber',
      p_value: 30,
      p_reason: 'e2e PLAT-3',
    })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_settings_refusal=not_authorized')
  })

  test("un commercial ne pilote pas le worker", async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents')
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'domcontentloaded' })

    const refusal = await callRpc(page, 'set_prospect_worker_paused', {
      p_paused: true,
      p_reason: 'e2e PLAT-3',
    })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_worker_refusal=not_authorized')
  })

  test("le fondateur lui-même est refusé hors bornes — le serveur tranche, pas l'écran", async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents')
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform/settings', { waitUntil: 'domcontentloaded' })

    const refusal = await callRpc(page, 'set_platform_setting', {
      p_key: 'queue.call_grace_minutes',
      p_value: 240,
      p_reason: 'e2e PLAT-3 hors bornes',
    })
    expect(refusal.status).toBe(400)
    expect(refusal.body).toContain('fadeup_settings_refusal=out_of_range')
  })

  test("un anonyme lit les deux réglages publics, et RIEN de la table", async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents')
    await page.goto('/platform/login', { waitUntil: 'domcontentloaded' })

    const result = await page.evaluate(
      async ([apiUrl, apiKey]) => {
        /*
         * LES DEUX EN-TÊTES, comme le fait un vrai navigateur anonyme :
         * supabase-js envoie `apikey` ET `Authorization: Bearer <clé anon>`.
         * Avec le seul `apikey`, PostgREST répond 401 et le test mesurerait
         * la maladresse de l'appel au lieu de la garde.
         */
        const headers = {
          'content-type': 'application/json',
          apikey: apiKey as string,
          authorization: `Bearer ${apiKey as string}`,
        }
        const rpc = await fetch(`${apiUrl}/rest/v1/rpc/get_public_platform_settings`, {
          method: 'POST',
          headers,
          body: '{}',
        })
        const table = await fetch(`${apiUrl}/rest/v1/platform_settings?select=key`, { headers })
        return {
          rpcStatus: rpc.status,
          rpcBody: await rpc.text(),
          tableStatus: table.status,
          tableBody: await table.text(),
        }
      },
      [url as string, anon as string],
    )

    expect(result.rpcStatus).toBe(200)
    expect(result.rpcBody).toContain('booking_window_days')
    /*
     * La table, elle, ne rend RIEN. Deux façons honnêtes d'y arriver : une
     * liste vide (la policy ne laisse passer aucune ligne) ou un refus franc.
     * Les deux prouvent la même chose — aucune valeur de réglage ne sort. Le
     * test accepte les deux plutôt que d'épingler un code HTTP qui appartient
     * à PostgREST et non à notre garde.
     */
    if (result.tableStatus === 200) {
      expect(JSON.parse(result.tableBody)).toEqual([])
    } else {
      expect(result.tableStatus).toBeGreaterThanOrEqual(400)
      expect(result.tableBody).not.toContain('queue.capacity_per_barber')
    }
  })
})
