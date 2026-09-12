import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  ensureActiveTrial,
  ensureFixture,
  neutralize,
  ORG_ID,
  QA_BARBER_EMAIL,
  QA_OWNER_EMAIL,
  QA_PASSWORD,
  signIn,
  sql,
  type Fixture,
} from './helpers'

/**
 * OS-3 — les trois surfaces dans un vrai navigateur, à 390 et 1440 (les deux
 * projets de `playwright.config.ts`). Données RÉELLES sur l'organisation
 * partagée `qa-f1b-shared`, marquées avant création et neutralisées à la fin.
 *
 * Toutes les adresses de clients de test sont en `@fadeup.test` :
 * `ensureFixture` refuse de démarrer s'il trouve une adresse joignable dans
 * l'organisation (voir helpers.ts).
 */

test.describe.configure({ mode: 'serial' })

/* La langue de l'interface suit celle du navigateur : sans ce réglage, le
   contexte Playwright est en `en-US` et l'écran pro s'affiche en anglais. */
test.use({ locale: 'fr-FR' })

let fixture: Fixture
let width = ''

test.beforeAll(({}, testInfo) => {
  width = testInfo.project.name === 'chromium-mobile' ? '390' : '1440'
  fixture = ensureFixture()
})

test.afterAll(() => {
  neutralize()
})

const noSeriousViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
}

/** Les erreurs de console d'une page — aucune n'est tolérée sur une surface pro. */
function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))
  return errors
}

/** Le sélecteur d'organisation est une PRÉFÉRENCE en localStorage (P1PRO). */
async function preferOrganization(page: Page, organizationId: string): Promise<void> {
  await page.addInitScript((id) => {
    window.localStorage.setItem('fadeup.currentOrganizationId', id as string)
  }, organizationId)
}

test('insights — un chiffre domine, le revenu est là pour le patron, et la console est muette', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/insights')
  await page.getByTestId('pro-insights').waitFor({ timeout: 30_000 })
  await page.getByTestId('pro-insights-hero').waitFor({ timeout: 30_000 })

  // UN chiffre dominant, en Geist Mono et tabulaire.
  const dominant = page.getByTestId('pro-insights-dominant')
  await expect(dominant).toBeVisible()
  const fonts = await dominant.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(fonts).toMatch(/Geist Mono/i)
  const dominantSize = await dominant.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  // 32 px en mobile, 44 px en desktop (tokens text-fu-3xl / text-fu-4xl).
  expect(dominantSize).toBeGreaterThanOrEqual(30)

  // Le revenu est rendu au propriétaire, et il est SECONDAIRE : plus petit
  // que le chiffre dominant (P1PRO §4 — un seul chiffre domine).
  const revenue = page.getByTestId('pro-insights-revenue')
  await expect(revenue).toBeVisible()
  const revenueSize = await revenue
    .locator('p')
    .nth(1)
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
  expect(revenueSize).toBeLessThan(dominantSize)

  // PAS de grille de douze cartes identiques : les blocs de premier niveau
  // se comptent sur les doigts d'une main.
  const panels = await page.locator('[data-testid^="pro-insights-"][data-testid$=""]').count()
  expect(panels).toBeLessThan(12)

  // Aucun débordement horizontal.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  await page.screenshot({ path: `e2e/os3/captures/insights-owner-${width}.png`, fullPage: true })
  await noSeriousViolations(page)
  expect(errors, errors.join('\n')).toEqual([])
})

test('insights — un barber SANS permission de revenu n’a AUCUN montant dans son DOM', async ({ page }) => {
  const errors = watchConsole(page)
  sql(`update public.memberships set can_view_revenue=false where id='${fixture.barberMembershipId}'`)
  await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/insights')
  await page.getByTestId('pro-insights').waitFor({ timeout: 30_000 })
  await page.getByTestId('pro-insights-hero').waitFor({ timeout: 30_000 })

  // Le BLOC de revenu n'existe pas — pas grisé, pas vide : absent.
  await expect(page.getByTestId('pro-insights-revenue')).toHaveCount(0)
  await expect(page.getByTestId('pro-insights-absences')).toHaveCount(0)

  // Et AUCUN montant nulle part dans le DOM rendu.
  const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
  expect(body).not.toMatch(/\d[\d\s,.]*\s*€/)
  expect(body).not.toMatch(/EUR/)

  // L'écran reste utile : le chiffre dominant est là.
  await expect(page.getByTestId('pro-insights-dominant')).toBeVisible()

  await page.screenshot({ path: `e2e/os3/captures/insights-barber-${width}.png`, fullPage: true })
  await noSeriousViolations(page)
  expect(errors, errors.join('\n')).toEqual([])
})

test('insights — une organisation sans historique affiche un état vide, pas des zéros', async ({ page }) => {
  const errors = watchConsole(page)
  // Une organisation QA RÉELLEMENT vide (zéro rendez-vous, zéro file), à
  // laquelle on donne un membership propriétaire TEMPORAIRE — retiré à la
  // fin du test. Aucune organisation n'est créée.
  const emptyOrg = sql(`select o.id from public.organizations o
    where o.slug like 'qa-f1-%'
      and not exists (select 1 from public.appointments a where a.organization_id=o.id)
      and not exists (select 1 from public.queue_entries q where q.organization_id=o.id)
    order by o.slug limit 1`)
  expect(emptyOrg).not.toBe('')
  const ownerUser = sql(`select u.id from auth.users u where u.email='${QA_OWNER_EMAIL}'`)
  sql(`insert into public.memberships (organization_id, user_id, role)
       values ('${emptyOrg}','${ownerUser}','owner') on conflict do nothing`)
  try {
    await preferOrganization(page, emptyOrg)
    await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/insights')
    await page.getByTestId('pro-insights').waitFor({ timeout: 30_000 })
    await page.getByTestId('pro-insights-empty').waitFor({ timeout: 30_000 })

    // Un état vide HONNÊTE : une phrase, une action — et aucun chiffre.
    await expect(page.getByTestId('pro-insights-hero')).toHaveCount(0)
    await expect(page.getByTestId('pro-insights-dominant')).toHaveCount(0)
    const emptyText = await page.getByTestId('pro-insights-empty').innerText()
    expect(emptyText).not.toMatch(/(^|\s)0(\s|$)/)

    await page.screenshot({ path: `e2e/os3/captures/insights-empty-${width}.png`, fullPage: true })
    await noSeriousViolations(page)
    expect(errors, errors.join('\n')).toEqual([])
  } finally {
    sql(`delete from public.memberships where organization_id='${emptyOrg}' and user_id='${ownerUser}'`)
  }
})

test('sollicitations — les quatre modèles, l’aperçu réel, l’envoi et le compteur', async ({ page }) => {
  const errors = watchConsole(page)
  sql(`update public.customers set do_not_contact=false where organization_id='${ORG_ID}' and name like 'QA OS3 %' and name <> 'QA OS3 Desabonne'`)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/campaigns')
  await page.getByTestId('pro-campaigns').waitFor({ timeout: 30_000 })
  await page.getByTestId('pro-campaigns-quota').waitFor({ timeout: 30_000 })

  // Les QUATRE modèles, et rien d'autre.
  for (const kind of ['lapsed_customers', 'free_slots_tomorrow', 'promotion', 'loyalty_reminder']) {
    await expect(page.getByTestId(`pro-campaigns-template-${kind}`)).toBeVisible()
  }

  const before = Number((await page.getByTestId('pro-campaigns-remaining').innerText()).trim())
  expect(Number.isFinite(before)).toBe(true)

  // Ouvrir « clients non revenus » : un seuil, une accroche, un aperçu réel.
  await page.getByTestId('pro-campaigns-open-lapsed_customers').click()
  await page.getByTestId('campaign-sheet-lapsed_customers').waitFor({ timeout: 15_000 })
  await page.getByTestId('campaign-preview').waitFor({ timeout: 15_000 })

  /* `data-testid` est posé sur le CONTRÔLE lui-même : le composant `Input`
     étale ses props restantes sur l'`<input>`, pas sur son enveloppe (piège
     relevé par OS-1). */
  const headline = page.getByTestId('campaign-headline')
  await headline.fill('venez voir https://ailleurs.example')
  await expect(page.getByText(/pas de lien|no links/i)).toBeVisible()
  // Et l'envoi reste impossible tant que le refus tient.
  await expect(page.getByTestId('campaign-send')).toBeDisabled()

  await headline.fill(`Ça fait un moment, on vous remet en forme (${width})`)
  const sendButton = page.getByTestId('campaign-send')
  await expect(sendButton).toBeEnabled({ timeout: 15_000 })
  await sendButton.click()

  // Le compteur s'incrémente, et l'historique porte le résultat.
  await page.getByTestId('pro-campaigns-history').waitFor()
  await expect
    .poll(async () => Number((await page.getByTestId('pro-campaigns-remaining').innerText()).trim()), {
      timeout: 20_000,
    })
    .toBe(before - 1)
  // L'historique porte le RÉSULTAT : destinataires, ouvertures, réservations
  // consécutives — et les trois tiennent à 390 px sans troncature.
  const history = await page.getByTestId('pro-campaigns-history').innerText()
  expect(history).toMatch(/destinataires/i)
  expect(history).toMatch(/ouvertures/i)
  expect(history).toMatch(/ont réservé ensuite/i)
  expect(history).not.toContain('…')

  await page.screenshot({ path: `e2e/os3/captures/campaigns-owner-${width}.png`, fullPage: true })
  await noSeriousViolations(page)
  expect(errors, errors.join('\n')).toEqual([])
})

test('sollicitations — au plafond, l’écran explique et propose, il ne mure pas', async ({ page }) => {
  const errors = watchConsole(page)
  const used = sql(`select count(*) from public.notification_campaigns
    where organization_id='${ORG_ID}' and period_month=date_trunc('month', now())::date`)
  const original = sql(`select monthly_campaign_allowance from public.commercial_plans where plan_key='salon_pro'`)
  // Le plafond vit en BASE : on l'abaisse à ce qui est déjà consommé.
  sql(`update public.commercial_plans set monthly_campaign_allowance=${Math.max(1, Number(used))} where plan_key='salon_pro'`)
  try {
    await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/campaigns')
    await page.getByTestId('pro-campaigns-capped').waitFor({ timeout: 30_000 })

    // L'explication, et ce qu'un plan supérieur apporterait.
    const capped = await page.getByTestId('pro-campaigns-capped').innerText()
    expect(capped).toMatch(/plafond|cap/i)
    expect(capped).toMatch(/\d+/)
    await expect(page.getByTestId('pro-campaigns-upgrade-link')).toBeVisible()

    // NON BLOQUANT : les quatre modèles restent là, et la feuille s'ouvre.
    await expect(page.getByTestId('pro-campaigns-template-promotion')).toBeVisible()
    await page.getByTestId('pro-campaigns-open-promotion').click()
    await page.getByTestId('campaign-capped').waitFor({ timeout: 15_000 })
    // …mais l'envoi est désactivé, avec son motif écrit.
    await expect(page.getByTestId('campaign-send')).toBeDisabled()

    await page.screenshot({ path: `e2e/os3/captures/campaigns-capped-${width}.png`, fullPage: true })
    await noSeriousViolations(page)
    expect(errors, errors.join('\n')).toEqual([])
  } finally {
    sql(`update public.commercial_plans set monthly_campaign_allowance=${original} where plan_key='salon_pro'`)
  }
})

test('sollicitations — un barber n’a ni l’entrée de nav, ni l’écran', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, QA_BARBER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard')
  await page.getByTestId('pro-home').waitFor({ timeout: 30_000 })

  // L'entrée de navigation n'existe pas dans le DOM — pas grisée, absente.
  const navHtml = await page.locator('body').innerHTML()
  expect(navHtml).not.toContain('/dashboard/campaigns')
  expect(navHtml).not.toContain('/dashboard/billing')

  // Et par URL directe, l'écran dit non sans squelette éternel.
  await page.goto('/dashboard/campaigns')
  await page.getByTestId('pro-campaigns-forbidden').waitFor({ timeout: 30_000 })
  expect(errors, errors.join('\n')).toEqual([])
})

test('abonnement — l’état, la grille réelle, l’annuel, et la grâce dite clairement', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/dashboard/billing')
  await page.getByTestId('pro-billing').waitFor({ timeout: 30_000 })
  await page.getByTestId('pro-billing-state').waitFor({ timeout: 30_000 })

  // La grille vient de la base : le plan Pro à 49,00 € mensuel.
  await page.getByTestId('pro-billing-plan-salon_pro').waitFor({ timeout: 30_000 })
  const proCard = page.getByTestId('pro-billing-plan-salon_pro')
  await expect(proCard).toContainText('49,00')

  // L'annuel : dix mois payés, douze servis — 490,00 €, LU en base.
  const yearly = page.getByRole('radio', { name: /annuel|yearly/i })
  if (await yearly.count()) {
    await yearly.first().click()
  } else {
    await page.getByRole('combobox', { name: /facturation|billing/i }).click()
    await page.getByRole('option', { name: /annuel|yearly/i }).click()
  }
  await expect(proCard).toContainText('490,00', { timeout: 15_000 })

  await page.screenshot({ path: `e2e/os3/captures/billing-owner-${width}.png`, fullPage: true })
  await noSeriousViolations(page)
  expect(errors, errors.join('\n')).toEqual([])
})

test('abonnement — la grâce de sept jours est affichée clairement, sans dramatiser', async ({ page }) => {
  const errors = watchConsole(page)
  // Un échec de paiement RÉEL en base : `past_due` + la grâce ouverte par
  // `run_billing_maintenance` (mêmes colonnes, même sens).
  const existed = sql(`select count(*) from public.organization_billing where organization_id='${ORG_ID}'`)
  if (existed === '0') {
    sql(`insert into public.organization_billing (organization_id, subscription_status, plan_key, grace_until, livemode)
         values ('${ORG_ID}', 'past_due', 'salon_pro', now() + interval '5 days', false)`)
  } else {
    sql(`update public.organization_billing set subscription_status='past_due', grace_until=now()+interval '5 days'
         where organization_id='${ORG_ID}'`)
  }
  try {
    await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/billing')
    await page.getByTestId('pro-billing-grace').waitFor({ timeout: 30_000 })
    const grace = await page.getByTestId('pro-billing-grace').innerText()
    // La date, le nombre de jours, et ce qui n'est PAS coupé.
    expect(grace).toMatch(/\d+\s*jour|\d+\s*day/i)
    expect(grace).toMatch(/rien n'est coupé|nothing is cut/i)
    // Le chemin de correction est là.
    await expect(page.getByTestId('pro-billing-grace-fix')).toBeVisible()

    await page.screenshot({ path: `e2e/os3/captures/billing-grace-${width}.png`, fullPage: true })
    await noSeriousViolations(page)
    expect(errors, errors.join('\n')).toEqual([])
  } finally {
    if (existed === '0') {
      sql(`delete from public.organization_billing where organization_id='${ORG_ID}'`)
    } else {
      sql(`update public.organization_billing set subscription_status='canceled', grace_until=null
           where organization_id='${ORG_ID}'`)
    }
  }
})

test('abonnement — un essai de 14 jours se démarre depuis l’écran, sans carte', async ({ page }) => {
  const errors = watchConsole(page)
  // L'essai n'est jamais relançable : on retire la LIGNE d'essai de la
  // fixture pour rejouer le tout premier démarrage, et on la remet après.
  /* L'essai exige un plan EFFECTIF `free` (B3). L'organisation partagée est
     ASSIGNÉE au plan `free` : il suffit donc de retirer sa ligne d'essai
     pour rejouer le tout premier démarrage. Rien d'autre ne bouge — et
     `ensureActiveTrial()` la remet, quoi qu'il arrive. */
  sql(`delete from public.organization_trials where organization_id='${ORG_ID}'`)
  sql(`delete from public.organization_billing where organization_id='${ORG_ID}'`)
  try {
    await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
    await page.goto('/dashboard/billing')
    await page.getByTestId('pro-billing-start-trial').waitFor({ timeout: 30_000 })
    await page.getByTestId('pro-billing-start-trial').click()
    await expect
      .poll(
        () =>
          sql(`select coalesce(status,'none') from public.organization_trials where organization_id='${ORG_ID}'`),
        { timeout: 20_000 },
      )
      .toBe('active')
    // 14 jours, et AUCUN objet Stripe créé.
    const days = sql(`select round(extract(epoch from (ends_at - started_at)) / 86400.0)::integer
                      from public.organization_trials where organization_id='${ORG_ID}'`)
    expect(days).toBe('14')
    expect(sql(`select count(*) from public.organization_billing where organization_id='${ORG_ID}'`)).toBe('0')

    // Et il n'est pas relançable : le bouton disparaît.
    await page.reload()
    await page.getByTestId('pro-billing-state').waitFor({ timeout: 30_000 })
    await expect(page.getByTestId('pro-billing-start-trial')).toHaveCount(0)

    await page.screenshot({ path: `e2e/os3/captures/billing-trial-${width}.png`, fullPage: true })
    expect(errors, errors.join('\n')).toEqual([])
  } finally {
    sql(`delete from public.organization_trials where organization_id='${ORG_ID}'`)
    ensureActiveTrial()
  }
})

test('abonnement — /pro/billing redirige en gardant sa chaîne de requête', async ({ page }) => {
  const errors = watchConsole(page)
  await signIn(page, QA_OWNER_EMAIL, QA_PASSWORD)
  await page.goto('/pro/billing?checkout=cancelled')
  await page.getByTestId('pro-billing').waitFor({ timeout: 30_000 })
  expect(page.url()).toContain('/dashboard/billing')
  expect(errors, errors.join('\n')).toEqual([])
})

test('désabonnement — la page publique confirme, sans session', async ({ page }) => {
  const errors = watchConsole(page)
  const token = sql(`select marketing_unsubscribe_token from public.customers
    where organization_id='${ORG_ID}' and name='QA OS3 Regulier' limit 1`)
  expect(token).toMatch(/^[0-9a-f]{32}$/)
  await page.goto(`/unsubscribe/salon/${token}`)
  await page.getByTestId('unsubscribe-done').waitFor({ timeout: 30_000 })
  const text = await page.getByTestId('unsubscribe-done').innerText()
  // Ce qui CONTINUE d'arriver est dit : le transactionnel n'est pas du marketing.
  expect(text).toMatch(/confirmations de réservation|booking confirmations/i)
  expect(sql(`select do_not_contact::text from public.customers
    where organization_id='${ORG_ID}' and name='QA OS3 Regulier'`)).toBe('true')

  await page.screenshot({ path: `e2e/os3/captures/unsubscribe-${width}.png`, fullPage: true })
  await noSeriousViolations(page)
  expect(errors, errors.join('\n')).toEqual([])
})
