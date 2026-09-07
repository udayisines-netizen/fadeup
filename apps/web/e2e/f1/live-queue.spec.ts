import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { FAR_COORDS, SHOP_COORDS, sql } from './helpers'

/**
 * F1 — Live Queue de bout en bout, contre la base réelle.
 *
 * La suite est SÉRIELLE et autonome : le premier test EST le parcours
 * d'installation (§6) — il crée le compte, le salon, l'essai, ouvre la file
 * — et les suivants exploitent ce salon QA (le seul détenteur de la
 * capacité `liveQueue` reproductible à volonté). Fin de suite : convention
 * « ZZ dead », lieu désactivé, file fermée.
 */

const STAMP = Date.now().toString(36)
const QA_EMAIL = `qa-f1-${STAMP}@fadeup.test`
const QA_PASSWORD = 'QaF1!passw0rd'
const ORG_NAME = `QA F1 ${STAMP}`
const ORG_SLUG = `qa-f1-${STAMP}`

let locationId = ''
let checkInToken = ''

function queueUrl(withToken: boolean): string {
  const base = `/q/${ORG_SLUG}?l=${locationId}`
  return withToken ? `${base}&t=${checkInToken}` : base
}

async function newClientContext(
  browser: Browser,
  options: { geolocation?: { latitude: number; longitude: number } } = {},
): Promise<BrowserContext> {
  return browser.newContext({
    locale: 'fr-FR',
    ...(options.geolocation
      ? { geolocation: options.geolocation, permissions: ['geolocation'] }
      : {}),
  })
}

async function joinAs(page: Page, name: string): Promise<void> {
  await page.goto(queueUrl(true))
  await page.getByTestId('queue-join-cta').click()
  await page.getByLabel('Votre prénom').fill(name)
  await page.getByRole('button', { name: /Rejoindre — ma position/ }).click()
}

async function loginPro(page: Page): Promise<void> {
  await page.goto('/auth/login')
  await page.getByLabel('Adresse e-mail').fill(QA_EMAIL)
  await page.getByLabel('Mot de passe', { exact: true }).fill(QA_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  // La session doit être ÉTABLIE avant de naviguer : sinon RequireAuth
  // renvoie vers /auth/login et le test regarde un écran vide.
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
}

test.describe.serial('F1 — Live Queue', () => {
  test.describe.configure({ timeout: 120_000 })

  test('installation : de zéro à une file ouverte et un QR imprimable, chronométré', async ({ browser }) => {
    const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const page = await context.newPage()
    const startedAt = Date.now()

    // Compte.
    await page.goto('/auth/signup?redirect=%2Fsetup')
    await page.getByLabel('Adresse e-mail').fill(QA_EMAIL)
    await page.getByLabel('Mot de passe', { exact: true }).fill(QA_PASSWORD)
    await page.getByRole('button', { name: 'Créer mon compte' }).click()
    await expect(page).toHaveURL(/\/setup/, { timeout: 20_000 })

    // Étape salon.
    await page.getByLabel('Nom du salon').fill(ORG_NAME)
    await expect(page.getByLabel('Adresse FadeUp')).toHaveValue(ORG_SLUG)
    await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()

    // Étape barber.
    await page.getByLabel('Nom affiché').fill('Qa Barber')
    await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()

    // Étape adresse + position (la géolocalisation du navigateur est celle
    // du « salon » : le stagiaire est sur place).
    await page.getByLabel('Adresse', { exact: true }).fill('10 rue de la Clipper')
    await page.getByLabel('Code postal').fill('93400')
    await page.getByLabel('Ville').fill('Saint-Ouen')
    await page.getByRole('button', { name: 'Utiliser ma position' }).click()
    await expect(page.getByText('Position enregistrée')).toBeVisible()
    await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()

    // Étape services — gabarits préremplis, gardés tels quels.
    await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()

    // Étape horaires — semaine type préremplie.
    await page.getByRole('button', { name: 'Enregistrer et continuer' }).click()

    // Essai 14 jours sans carte → la capacité liveQueue devient réelle.
    await page.getByRole('button', { name: /Terminer l’installation|Terminer l'installation/ }).click()

    // Ouvrir la file — sauf si le réglage de compatibilité du lieu neuf l'a
    // déjà ouverte (hybrid + queue_open par défaut) : l'étape s'auto-valide
    // alors sur l'état RÉEL et le wizard passe au QR.
    const openButton = page.getByRole('button', { name: 'Ouvrir la file maintenant' })
    const poster = page.locator('#fu-qr-poster')
    await expect(poster.or(openButton)).toBeVisible({ timeout: 30_000 })
    if (await openButton.isVisible()) {
      await openButton.click()
    }

    // Le QR imprimable est là.
    await expect(poster).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('#fu-qr-poster img[alt*="QR"]')).toBeVisible({ timeout: 15_000 })

    const elapsedMs = Date.now() - startedAt
    console.log(`[F1] installation chronométrée : ${(elapsedMs / 1000).toFixed(1)} s`)
    expect(elapsedMs).toBeLessThan(20 * 60 * 1000)

    // Récupère les faits pour la suite de la suite.
    locationId = sql(
      `select l.id from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='${ORG_SLUG}'`,
    )
    checkInToken = sql(
      `select l.queue_check_in_token from public.locations l join public.organizations o on o.id=l.organization_id where o.slug='${ORG_SLUG}'`,
    )
    expect(locationId).not.toBe('')
    expect(checkInToken).toMatch(/^[0-9a-f]{32}$/)

    await context.close()
  })

  test('un client consulte la file sans être authentifié ni géolocalisé', async ({ browser }) => {
    // Contexte SANS permission de géolocalisation : consulter ne la demande pas.
    const context = await newClientContext(browser)
    const page = await context.newPage()
    await page.goto(queueUrl(false))
    await expect(page.getByTestId('queue-waiting-count')).toHaveText('0')
    // Aucune minute d'attente affichée : la base ne fournit pas d'estimation.
    await expect(page.getByTestId('queue-estimated-wait')).toHaveCount(0)
    await expect(page.getByTestId('queue-join-cta')).toBeVisible()
    await context.close()
  })

  test('rejoindre depuis trop loin est refusé avec le bon message', async ({ browser }) => {
    const context = await newClientContext(browser, { geolocation: FAR_COORDS })
    const page = await context.newPage()
    await joinAs(page, 'Trop Loin')
    await expect(page.getByTestId('queue-join-feedback')).toContainText('trop loin', { timeout: 15_000 })
    await context.close()
  })

  test('rejoindre sans QR valide est refusé avec un message différent', async ({ browser }) => {
    const context = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const page = await context.newPage()
    const badToken = '0'.repeat(32)
    await page.goto(`/q/${ORG_SLUG}?l=${locationId}&t=${badToken}`)
    await page.getByTestId('queue-join-cta').click()
    await page.getByLabel('Votre prénom').fill('Faux Jeton')
    await page.getByRole('button', { name: /Rejoindre — ma position/ }).click()
    const feedback = page.getByTestId('queue-join-feedback')
    await expect(feedback).toContainText('QR', { timeout: 15_000 })
    await expect(feedback).not.toContainText('trop loin')
    await context.close()
  })

  test('positions en temps réel sur deux navigateurs ; le barber appelle, le client le voit sans rafraîchir', async ({
    browser,
  }) => {
    // Client A rejoint (position 1), client B rejoint (1 personne devant).
    const contextA = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const clientA = await contextA.newPage()
    await joinAs(clientA, 'Amine Premier')
    await expect(clientA.getByTestId('queue-track-position')).toHaveText('1', { timeout: 15_000 })

    const contextB = await newClientContext(browser, { geolocation: SHOP_COORDS })
    const clientB = await contextB.newPage()
    await joinAs(clientB, 'Bilal Second')
    await expect(clientB.getByTestId('queue-track-position')).toHaveText('2', { timeout: 15_000 })
    await expect(clientB.getByText(/1 personne devant/)).toBeVisible()

    // La face pro : le patron ouvre son écran file.
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await loginPro(pro)
    await pro.goto('/dashboard/queue')
    await expect(pro.getByTestId('pro-queue-waiting-count')).toHaveText('2', { timeout: 20_000 })

    // Minimisation : prénom + initiale, jamais le nom complet.
    await expect(pro.getByTestId('pro-queue-list')).toContainText('Amine P.')
    await expect(pro.getByTestId('pro-queue-list')).not.toContainText('Amine Premier')

    // Le barber appelle le suivant — SANS que les clients ne rafraîchissent.
    await pro.getByTestId('pro-queue-call-next').click()

    // Client A voit l'appel (poll public ≤ 6 s), impossible à manquer.
    await expect(clientA.getByTestId('queue-track-called')).toBeVisible({ timeout: 15_000 })
    // Client B remonte : plus personne devant lui.
    await expect(clientB.getByText(/Vous êtes le prochain/)).toBeVisible({ timeout: 15_000 })

    // Écran pro : l'entrée appelée est passée en tête, realtime (écriture cache).
    await expect(pro.getByTestId('pro-queue-list')).toContainText(/C[’']est votre tour/, { timeout: 15_000 })

    // Arrivé → au fauteuil ; terminé → appelle implicitement le suivant.
    await pro.getByRole('button', { name: 'Arrivé' }).click()
    await pro.getByRole('button', { name: 'Terminé' }).click()
    await expect(clientB.getByTestId('queue-track-called')).toBeVisible({ timeout: 15_000 })

    // Fermer proprement : B ne doit pas rester appelé dans un salon QA mort.
    await pro.getByRole('button', { name: 'Absent' }).click()

    await contextA.close()
    await contextB.close()
    await proContext.close()
  })

  test('bascule de mode de service, répercutée côté client sans rafraîchir', async ({ browser }) => {
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await loginPro(pro)
    await pro.goto('/dashboard/queue')

    const clientContext = await newClientContext(browser)
    const client = await clientContext.newPage()
    await client.goto(queueUrl(false))
    await expect(client.getByTestId('queue-join-cta')).toBeVisible({ timeout: 15_000 })

    // Le pro coupe la file : « RDV seuls ».
    await pro.getByRole('radio', { name: 'RDV seuls' }).click()

    // Côté client, sans rafraîchir : l'état bascule et le CTA disparaît
    // (poll d'état de service, 30 s — voir publicQueue.ts).
    await test.step('le client voit la fermeture sans recharger', async () => {
      test.setTimeout(150_000)
      await expect(client.getByTestId('queue-join-cta')).toHaveCount(0, { timeout: 60_000 })
      await expect(client.getByText(/fermée/i).first()).toBeVisible({ timeout: 10_000 })
    })

    // Retour au mode hybride pour laisser la suite dans un état connu.
    await pro.getByRole('radio', { name: 'RDV + file' }).click()

    await clientContext.close()
    await proContext.close()
  })

  test('aucun canal realtime orphelin après navigation', async ({ browser }) => {
    const proContext = await newClientContext(browser)
    const pro = await proContext.newPage()
    await loginPro(pro)

    const queueTopics = () =>
      pro.evaluate(() =>
        ((window as { __fuSupabase?: { getChannels(): Array<{ topic: string }> } }).__fuSupabase?.getChannels() ?? [])
          .map((channel) => channel.topic)
          .filter((topic) => topic.includes('queue:')),
      )

    await pro.goto('/dashboard/queue')
    await expect(pro.getByTestId('pro-queue-call-next')).toBeVisible({ timeout: 20_000 })
    await expect.poll(async () => (await queueTopics()).length, { timeout: 15_000 }).toBeGreaterThan(0)

    // Quitter l'écran : le canal `queue:<location_id>` doit disparaître.
    // (Le canal de notifications du compte, monté par le shell, est
    // LÉGITIME sur l'accueil — l'orphelin serait un canal de file.)
    await pro.goto('/')
    await expect.poll(async () => (await queueTopics()).length, { timeout: 15_000 }).toBe(0)

    await proContext.close()
  })

  test.afterAll(() => {
    if (!ORG_SLUG) return
    // Convention post-B1 : les fixtures ne se suppriment pas (journaux
    // append-only) — elles se neutralisent, nommées « ZZ dead ».
    sql(`
      update public.queue_entries qe set status='cancelled'
        from public.organizations o
        where qe.organization_id=o.id and o.slug='${ORG_SLUG}'
          and qe.status in ('waiting','called','in_service');
      update public.location_service_settings s set queue_open=false
        from public.locations l join public.organizations o on o.id=l.organization_id
        where s.location_id=l.id and o.slug='${ORG_SLUG}';
      update public.locations l set is_active=false
        from public.organizations o
        where l.organization_id=o.id and o.slug='${ORG_SLUG}';
      update public.organizations set name='ZZ dead ${ORG_NAME}', marketplace_visible=false
        where slug='${ORG_SLUG}';
    `)
  })
})
