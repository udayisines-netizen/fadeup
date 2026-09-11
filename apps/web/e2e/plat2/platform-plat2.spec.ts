import { test, expect, type Page } from '@playwright/test'

/**
 * PLAT-2 — les quatre écrans par rôle, et les affiches QR.
 *
 * CE QUI EST VÉRIFIÉ ICI EST LE RENDU. L'autorisation est prouvée côté
 * serveur par `db/tests/verify_plat2.sql` (135 assertions, RPC appelées
 * directement), parce qu'une garde d'interface n'existe pas — X3 l'a démontré
 * deux fois. Les trois derniers tests de ce fichier appellent PostgREST
 * DEPUIS LA PAGE, avec le jeton du compte, exactement comme le ferait
 * quelqu'un qui ouvre la console du navigateur.
 *
 * Les comptes qa-plat1-* viennent de PLAT-1 ; les affiches `QAP*` du lot
 * « ZZ dead QA PLAT2 e2e ». Les tests se sautent proprement si l'un ou
 * l'autre manque, plutôt que d'échouer pour une raison sans rapport.
 */
const PASSWORD = 'Plat1-QA!2026'

/** Les trois affiches de fixture, une par état. */
const CODE_FREE = 'QAPFREE001'
const CODE_REVOKED = 'QAPREVKD02'
const CODE_ASSIGNED = 'QAPASGND03'

async function signIn(page: Page, email: string): Promise<boolean> {
  await page.goto('/platform/login', { waitUntil: 'networkidle' })
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
  await page.waitForTimeout(600)
  return page.evaluate(() =>
    [...document.querySelectorAll('header a[href^="/platform"]')].map((a) => a.getAttribute('href') ?? ''),
  )
}

/** Appelle une RPC PostgREST avec le jeton de la session ouverte dans la page. */
async function callRpc(page: Page, name: string, body: Record<string, unknown>) {
  const url = process.env.QA_SUPABASE_URL as string
  const anon = process.env.QA_ANON_KEY as string
  return page.evaluate(
    async ([apiUrl, apiKey, rpc, payload]) => {
      const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
      const raw = key ? JSON.parse(localStorage.getItem(key) as string) : null
      const token = raw?.access_token ?? (Array.isArray(raw) ? raw[0] : null)
      const response = await fetch(`${apiUrl}/rest/v1/rpc/${rpc}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: apiKey as string,
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      return { status: response.status, body: await response.text() }
    },
    [url, anon, name, body] as const,
  )
}

test.describe('PLAT-2 — la navigation par rôle', () => {
  test('le fondateur voit les cinq écrans neufs', async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    for (const href of ['/platform/support', '/platform/moderation', '/platform/sales', '/platform/field', '/platform/posters']) {
      expect(nav, `le fondateur devrait voir ${href}`).toContain(href)
    }
  })

  test("le support a sa file, et NI le CRM NI la modération NI les affiches", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/support')
    for (const href of ['/platform/sales', '/platform/moderation', '/platform/field', '/platform/posters']) {
      expect(nav, `le support ne devrait pas voir ${href}`).not.toContain(href)
    }
    // Une capacité absente ne rend RIEN : jamais un lien grisé ni cadenassé.
    expect(await page.locator('header [aria-disabled="true"], header [disabled]').count()).toBe(0)
  })

  test("le modérateur a la modération, et PAS le CRM ni la file de support", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-moderator@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/moderation')
    for (const href of ['/platform/sales', '/platform/support', '/platform/posters']) {
      expect(nav, `le modérateur ne devrait pas voir ${href}`).not.toContain(href)
    }
  })

  test("le commercial a le CRM et la modération PARTAGÉE, et pas la file de support", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/sales')
    // Les onglets onboarding et revendication sont partagés : la décision du
    // fondateur, pas une commodité.
    expect(nav).toContain('/platform/moderation')
    for (const href of ['/platform/support', '/platform/posters']) {
      expect(nav, `le commercial ne devrait pas voir ${href}`).not.toContain(href)
    }
  })

  test("le stagiaire n'a que le terrain — ni CRM d'ensemble, ni affiches, ni support", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-intern@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/field')
    for (const href of ['/platform/sales', '/platform/support', '/platform/moderation', '/platform/posters']) {
      expect(nav, `le stagiaire ne devrait pas voir ${href}`).not.toContain(href)
    }
  })
})

test.describe('PLAT-2 — un écran interdit se refuse honnêtement', () => {
  test('le commercial ouvre /platform/support et lit une phrase, pas un tableau vide', async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform/support', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    expect(await page.locator('tbody tr').count()).toBe(0)
    const text = (await page.locator('main').innerText()).trim()
    expect(text.length, "un écran refusé dit POURQUOI, il ne rend pas le vide").toBeGreaterThan(20)
  })

  test('le commercial ouvre /platform/posters et lit une phrase', async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform/posters', { waitUntil: 'networkidle' })
    await page.waitForTimeout(600)
    const text = (await page.locator('main').innerText()).trim()
    expect(text.length).toBeGreaterThan(20)
    // Aucun formulaire de génération n'est rendu à qui ne peut pas générer.
    expect(await page.locator('main form').count()).toBe(0)
  })
})

test.describe("PLAT-2 — le scan d'une affiche, sans compte", () => {
  test("un code LIBRE dit honnêtement qu'il n'est pas encore actif, et ne propose rien", async ({ page }) => {
    await page.goto(`/a/${CODE_FREE}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const text = await page.locator('main').innerText()
    expect(text).toContain(CODE_FREE)
    // Aucune proposition d'attribution à un visiteur sans droit.
    expect(await page.getByRole('button', { name: /activ/i }).count()).toBe(0)
  })

  test('un code RÉVOQUÉ le dit clairement', async ({ page }) => {
    await page.goto(`/a/${CODE_REVOKED}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    expect(await page.locator('main').innerText()).toMatch(/plus active|no longer active/i)
  })

  test("un code ATTRIBUÉ mène à la file du salon, sans écran intermédiaire", async ({ page }) => {
    await page.goto(`/a/${CODE_ASSIGNED}`, { waitUntil: 'networkidle' })
    await page.waitForURL(/\/q\//, { timeout: 10_000 })
    expect(page.url()).toContain('/q/qa-f1b-shared')
  })

  test("un code INCONNU ne dit rien de plus qu'« inconnu »", async ({ page }) => {
    await page.goto('/a/ZZZZZZZZZZ', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    const text = await page.locator('main').innerText()
    expect(text).toMatch(/n'existe pas|does not exist/i)
    expect(await page.getByRole('button', { name: /activ/i }).count()).toBe(0)
  })

  test("un code MAL FORMÉ est traité comme inconnu, sans erreur technique", async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.goto('/a/pas-un-code', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    expect(await page.locator('main').innerText()).toMatch(/n'existe pas|does not exist/i)
    expect(errors, 'aucune erreur console sur un code mal formé').toHaveLength(0)
  })
})

test.describe('PLAT-2 — les refus, RPC appelées DIRECTEMENT', () => {
  test.skip(
    !process.env.QA_SUPABASE_URL || !process.env.QA_ANON_KEY,
    'QA_SUPABASE_URL / QA_ANON_KEY absents — la preuve directe exige la vraie API',
  )

  test("un commercial n'ouvre pas de ticket de support", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const refusal = await callRpc(page, 'open_support_ticket', { p_origin: 'phone', p_subject: 'e2e interdit' })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_support_refusal=not_authorized')
  })

  test("un commercial ne lit aucun dossier client", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const refusal = await callRpc(page, 'get_platform_customer_dossier', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
    })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_support_refusal=dossier_not_authorized')
  })

  test("un modérateur ne remet PAS en ligne ce qu'il a masqué", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-moderator@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const refusal = await callRpc(page, 'moderate_post', {
      p_post_id: '00000000-0000-0000-0000-000000000000',
      p_visibility: 'public',
    })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_moderation_refusal=revert_requires_admin')
  })

  test("un stagiaire ne génère aucun lot d'affiches", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-intern@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const refusal = await callRpc(page, 'generate_poster_batch', { p_count: 1, p_label: 'e2e interdit' })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_poster_refusal=not_authorized')
  })

  test("une affiche ATTRIBUÉE n'est pas détournable, même par un fondateur", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const locations = await callRpc(page, 'list_my_poster_locations', {})
    const first = (JSON.parse(locations.body) as { location_id: string }[])[0]
    test.skip(!first, 'aucun établissement attribuable pour ce compte')
    const refusal = await callRpc(page, 'assign_poster', {
      p_code: CODE_ASSIGNED,
      p_location_id: first.location_id,
    })
    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_poster_refusal=already_assigned')
  })

  test("un rôle sans droit d'affiche n'obtient AUCUN établissement attribuable", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const result = await callRpc(page, 'list_my_poster_locations', {})
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toHaveLength(0)
  })
})
