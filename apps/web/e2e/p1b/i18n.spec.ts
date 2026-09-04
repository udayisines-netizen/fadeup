import { expect, test } from '@playwright/test'

test.describe('i18n', () => {
  test('la bascule FR/EN persiste après rechargement', async ({ page }) => {
    await page.goto('/auth/login')
    // Défaut navigateur en-US → EN.
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible()

    await page.getByRole('radio', { name: 'Français' }).click()
    await expect(page.getByRole('heading', { name: /connexion/i })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')

    await page.reload()
    await expect(page.getByRole('heading', { name: /connexion/i })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
  })

  test('aucune chaîne non traduite sur les surfaces P1b en FR', async ({ page }) => {
    await page.goto('/auth/login')
    await page.getByRole('radio', { name: 'Français' }).click()
    await page.goto('/')
    const body = (await page.locator('body').innerText()).toLowerCase()
    // Sentinelles de non-traduction : les libellés EN des onglets.
    expect(body).not.toMatch(/\bbookings\b|\baccount\b|\bhome\b/)
  })
})
