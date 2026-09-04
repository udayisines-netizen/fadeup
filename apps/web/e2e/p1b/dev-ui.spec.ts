import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test.describe('/dev/ui', () => {
  test('affiche la galerie complète (15 états FadeUp représentés)', async ({ page }) => {
    await page.goto('/dev/ui')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Les 14 états StateBadge + les 3 états ClaimBadge sont montés.
    for (const state of [
      'bookable',
      'not-bookable',
      'pending-request',
      'confirmed',
      'queue-open',
      'queue-full',
      'queue-closed',
      'called',
      'missed',
      'offline',
      'reconnecting',
      'partial-data',
      'available',
      'unavailable',
    ]) {
      await expect(page.locator(`[data-state="${state}"]`).first()).toBeAttached()
    }
    for (const claim of ['unclaimed', 'claimed', 'verified']) {
      await expect(page.locator(`[data-state="${claim}"]`).first()).toBeAttached()
    }
  })

  test('aucune violation axe sérieuse ou critique', async ({ page }) => {
    await page.goto('/dev/ui')
    await page.waitForLoadState('networkidle')
    const results = await new AxeBuilder({ page }).analyze()
    const blocking = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    )
    expect(
      blocking.map((violation) => `${violation.id}: ${violation.nodes.length} nœud(s)`),
    ).toEqual([])
  })

  test('bascule RTL : la page ne déborde pas horizontalement', async ({ page }) => {
    await page.goto('/dev/ui')
    await page.getByRole('radio', { name: 'RTL' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  test('bascule FR/EN : l’expansion française ne casse pas la page', async ({ page }) => {
    await page.goto('/dev/ui')
    await page.getByRole('radio', { name: 'FR', exact: true }).click()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
