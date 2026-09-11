import { test, expect, type Page } from '@playwright/test'

/**
 * PLAT-1 — la console interne rend à chaque rôle ce qu'il peut faire, et rien
 * d'autre. Ce qui est vérifié ici est le RENDU ; l'autorisation est prouvée
 * côté serveur par `db/tests/verify_plat1.sql`, parce qu'une garde d'interface
 * n'existe pas.
 *
 * Les comptes qa-plat1-* sont créés par la campagne PLAT-1 (voir le rapport,
 * §« Données de test »). Les tests se sautent proprement s'ils n'existent pas,
 * plutôt que d'échouer pour une raison sans rapport.
 */
const PASSWORD = 'Plat1-QA!2026'

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
  await page.waitForTimeout(500)
  return page.evaluate(() =>
    [...document.querySelectorAll('header a[href^="/platform"]')].map((a) => a.getAttribute('href') ?? ''),
  )
}

test.describe('PLAT-1 — la console interne selon le rôle', () => {
  test("la garde renvoie un visiteur non connecté vers la connexion, en gardant sa destination", async ({ page }) => {
    await page.goto('/platform/organizations', { waitUntil: 'networkidle' })
    await expect(page).toHaveURL(/\/platform\/login\?redirect=%2Fplatform%2Forganizations/)
  })

  test('le fondateur voit toute la console', async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-founder@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    for (const href of [
      '/platform/applications',
      '/platform/organizations',
      '/platform/acquisition',
      '/platform/outreach',
      '/platform/data-science',
      '/platform/team',
      '/platform/audit',
    ]) {
      expect(nav, `le fondateur devrait voir ${href}`).toContain(href)
    }
  })

  test("le support n'a ni CRM, ni équipe, ni journal — et rien n'est grisé à la place", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/organizations')
    for (const href of ['/platform/acquisition', '/platform/outreach', '/platform/data-science', '/platform/team', '/platform/audit']) {
      expect(nav, `le support ne devrait pas voir ${href}`).not.toContain(href)
    }
    const locked = await page.locator('header [aria-disabled="true"], header [disabled]').count()
    expect(locked, 'une capacité absente ne rend rien — jamais un lien grisé').toBe(0)
  })

  test("le stagiaire n'a que l'acquisition", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-intern@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })
    const nav = await platformNav(page)
    expect(nav).toContain('/platform/acquisition')
    for (const href of ['/platform/outreach', '/platform/data-science', '/platform/organizations', '/platform/team', '/platform/audit']) {
      expect(nav).not.toContain(href)
    }
  })

  test("le journal d'audit se refuse honnêtement à qui n'y a pas droit", async ({ page }) => {
    test.skip(!(await signIn(page, 'qa-plat1-sales@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform/audit', { waitUntil: 'networkidle' })
    await expect(page.getByText(/founder and admins only|fondateur et les admins/i)).toBeVisible()
    expect(await page.locator('tbody tr').count()).toBe(0)
  })

  test("la vue en tant que est refusée au support, RPC appelée directement", async ({ page }) => {
    const url = process.env.QA_SUPABASE_URL
    const anon = process.env.QA_ANON_KEY
    test.skip(!url || !anon, 'QA_SUPABASE_URL / QA_ANON_KEY absents — la preuve directe exige la vraie API')
    test.skip(!(await signIn(page, 'qa-plat1-support@fadeup.test')), 'compte QA PLAT-1 absent')
    await page.goto('/platform', { waitUntil: 'networkidle' })

    const refusal = await page.evaluate(
      async ([apiUrl, apiKey]) => {
        const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))
        const raw = key ? JSON.parse(localStorage.getItem(key) as string) : null
        const token = raw?.access_token ?? (Array.isArray(raw) ? raw[0] : null)
        const response = await fetch(`${apiUrl}/rest/v1/rpc/start_platform_support_session`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            apikey: apiKey as string,
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            p_organization_id: '00000000-0000-0000-0000-000000000000',
            p_target_type: 'organization',
          }),
        })
        return { status: response.status, body: await response.text() }
      },
      [url as string, anon as string],
    )

    expect(refusal.status).toBe(403)
    expect(refusal.body).toContain('fadeup_support_view_refusal=not_authorized')
  })
})
