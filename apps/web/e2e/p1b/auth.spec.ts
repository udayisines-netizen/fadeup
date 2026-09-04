import { expect, test, type Page } from '@playwright/test'

/**
 * Auth de bout en bout contre le VRAI GoTrue local (autoconfirm actif : la
 * session s'ouvre sans e-mail). L'envoi d'e-mail réel (magic link, reset)
 * est cassé côté infra (SMTP_HOST=supabase-mail inexistant) — ce que ces
 * tests vérifient alors, c'est que l'échec remonte TRADUIT, jamais brut.
 */

const PASSWORD = 'p1b-e2e-Passw0rd!'

function uniqueEmail(): string {
  return `e2e-p1b-${Date.now()}-${Math.floor(Math.random() * 1e6)}@fade-up.com`
}

async function fillByLabel(page: Page, label: RegExp, value: string) {
  await page.getByLabel(label).fill(value)
}

test.describe('authentification', () => {
  test('inscription → session ouverte → déconnexion', async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) < 768, 'le bouton de déconnexion P1b vit dans la barre desktop')
    const email = uniqueEmail()

    await page.goto('/auth/signup')
    await fillByLabel(page, /e-mail|email/i, email)
    await fillByLabel(page, /mot de passe|password/i, PASSWORD)
    await page.getByRole('button', { name: /créer|create/i }).click()

    // Autoconfirm : retour sur l'accueil, connecté.
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
    const signOut = page.getByRole('button', { name: /déconnecter|sign out/i })
    await expect(signOut).toBeVisible()

    await signOut.click()
    await expect(signOut).toBeHidden({ timeout: 10_000 })
  })

  test('connexion avec un mauvais mot de passe : message traduit, jamais le texte brut', async ({ page }) => {
    await page.goto('/auth/login')
    await fillByLabel(page, /e-mail|email/i, 'p1b-test@fade-up.com')
    await fillByLabel(page, /mot de passe|password/i, 'mauvais-mot-de-passe')
    await page.getByRole('button', { name: /se connecter|sign in/i }).click()

    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible({ timeout: 15_000 })
    await expect(alert).not.toContainText('Invalid login credentials')
  })

  test('mot de passe oublié : la soumission aboutit à un état explicite (envoyé ou erreur traduite)', async ({ page }) => {
    await page.goto('/auth/forgot')
    await fillByLabel(page, /e-mail|email/i, 'p1b-test@fade-up.com')
    await page.getByRole('button', { name: /envoyer|send/i }).click()

    // Infra SMTP cassée : l'erreur doit être la nôtre, traduite. Si l'infra
    // est réparée, l'état « envoyé » est le succès attendu.
    const sent = page.getByText(/e-mail envoyé|email sent/i)
    const failed = page.getByRole('alert')
    await expect(sent.or(failed)).toBeVisible({ timeout: 15_000 })
    if (await failed.isVisible().catch(() => false)) {
      await expect(failed).not.toContainText(/error sending|smtp|dial tcp/i)
    }
  })

  test('le sélecteur de langue n’expose que fr et en', async ({ page }) => {
    await page.goto('/auth/login')
    const group = page.getByRole('radiogroup', { name: /langue|language/i })
    await expect(group.getByRole('radio')).toHaveCount(2)
  })
})
