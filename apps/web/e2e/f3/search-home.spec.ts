import AxeBuilder from '@axe-core/playwright'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

/**
 * F3 — la recherche (/search) et l'accueil (/), contre la base réelle (jeu
 * de démonstration B1/F2 : 8 établissements non gérés + side-agency géré,
 * demo-maison-kais à file ouverte, demo-sofian-cuts en zone de service).
 *
 * Assertions agnostiques de la langue (data-testid / data-state / motifs
 * FR|EN) — leçon F1b sur l'aléa de langue du premier rendu.
 */

const PARIS = { latitude: 48.8566, longitude: 2.3522 }
/** Melun : assez loin pour vider un rayon de 10 km, assez près pour que
 *  l'élargissement à 50 km retrouve Paris. */
const MELUN = { latitude: 48.5421, longitude: 2.655 }

function sql(query: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c', query],
    { encoding: 'utf8' },
  ).trim()
}

function kongRpcBase(): { base: string; anonKey: string } {
  const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
  const anonKey = /^ANON_KEY=(.+)$/m.exec(env)?.[1]?.trim().replace(/"/g, '') ?? ''
  const port = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' })
    .split('\n')[0]!.trim().split(':').pop()!
  return { base: `http://127.0.0.1:${port}/rest/v1/rpc`, anonKey }
}

async function anonRpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const { base, anonKey } = kongRpcBase()
  const response = await fetch(`${base}/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${name} -> ${response.status}: ${text}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function waitForResults(page: Page) {
  await expect(page.getByTestId('result-count')).toBeVisible({ timeout: 20_000 })
}

test.describe('F3 — /search', () => {
  test('une recherche s’exécute sans authentification et sans géolocalisation', async ({ page }) => {
    let entityTypeSeen: unknown = 'not-captured'
    page.on('request', (request) => {
      if (request.url().includes('search_public_professionals')) {
        entityTypeSeen = (request.postDataJSON() as Record<string, unknown>).p_entity_type
      }
    })
    await page.goto('/search?q=maison')
    await expect(page).not.toHaveURL(/\/auth\//)
    await waitForResults(page)
    await expect(page.getByTestId('result-link').first()).toBeVisible()
    // LOI PRODUIT §2 : la restriction marketplace part EXPLICITEMENT.
    expect(entityTypeSeen).toBe('shop')
  })

  test('l’état des filtres vit dans l’URL et survit à un rechargement', async ({ page }) => {
    await page.goto('/search')
    await waitForResults(page)
    // < 1024 px : la puce rapide ; ≥ 1024 px : l'interrupteur du rail.
    const chip = page.getByTestId('available-now-chip')
    if (await chip.isVisible()) {
      await chip.click()
    } else {
      await page.getByRole('switch', { name: /Disponible maintenant|Available now/ }).click()
    }
    await expect(page).toHaveURL(/avail=1/)
    await page.reload()
    await expect(page).toHaveURL(/avail=1/)
    // isVisible ne patiente pas : attendre le rendu avant de brancher.
    await waitForResults(page)
    if (await chip.isVisible()) {
      await expect(chip).toHaveAttribute('aria-pressed', 'true')
    } else {
      await expect(page.getByRole('switch', { name: /Disponible maintenant|Available now/ })).toHaveAttribute(
        'data-state',
        'checked',
      )
    }
    // Le retour arrière du navigateur défait le filtre — l'état est l'URL.
    await page.goBack()
    await expect(page).not.toHaveURL(/avail=1/)
  })

  test('aucun barber salarié n’apparaît comme résultat autonome', async ({ page }) => {
    // « Kaïs » est à la fois le nom d'un salon ET d'un barber salarié : seule
    // la ligne établissement a le droit d'exister.
    await page.goto('/search?q=kais')
    await waitForResults(page)
    const links = page.getByTestId('result-link')
    const count = await links.count()
    expect(count).toBeGreaterThan(0)
    for (let i = 0; i < count; i += 1) {
      // Chaque résultat est un ÉTABLISSEMENT : son chemin est /shop/…,
      // jamais un profil de salarié.
      await expect(links.nth(i)).toHaveAttribute('href', /^\/shop\//)
    }
  })

  test('zéro résultat : l’élargissement étiqueté, jamais un résultat hors sujet glissé dans la liste', async ({ page }) => {
    await page.goto(`/search?q=maison&lat=${MELUN.latitude}&lng=${MELUN.longitude}`)
    await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 20_000 })
    // L'élargissement arrive dans une section SÉPARÉE et nommée, avec la
    // distance réelle affichée sur la rangée.
    const widened = page.getByTestId('widened-results')
    await expect(widened).toBeVisible({ timeout: 20_000 })
    await expect(widened.getByTestId('result-link').first()).toBeVisible()
    await expect(widened.getByTestId('result-distance').first()).toBeVisible()
  })

  test('un texte de style sans homonyme passe par les services réels, dans une section déclarée', async ({ page }) => {
    // « taper » est un nom de SERVICE réel du jeu démo et ne matche aucun nom
    // d'organisation ni de ville : la liste principale est vide, le repli
    // par service est étiqueté — assertion INCONDITIONNELLE.
    await page.goto('/search?q=taper')
    await waitForResults(page)
    await expect(page.getByTestId('result-count')).toHaveText(/^0/)
    const fallback = page.getByTestId('service-fallback')
    await expect(fallback).toBeVisible({ timeout: 20_000 })
    await expect(fallback.getByTestId('result-link').first()).toBeVisible()
  })

  test('une ligne sans coordonnées ne compte pas comme « dans la zone » : le zéro se dit, la ligne s’affiche à part', async ({ page }) => {
    // Marseille : rien dans un rayon de 10 km. side-agency (lieu sans
    // coordonnées) est conservée par la RPC — elle ne doit NI remplir la
    // liste principale NI empêcher l'état vide (revue F3, M3).
    await page.goto('/search?lat=43.2965&lng=5.3698')
    await expect(page.getByTestId('search-empty')).toBeVisible({ timeout: 20_000 })
    const unlocated = page.getByTestId('unlocated-results')
    await expect(unlocated).toBeVisible()
    await expect(unlocated.locator('[data-org="side-agency"]')).toHaveCount(1)
  })

  test('un professionnel mobile n’affiche aucune adresse — la zone se dit', async ({ page }) => {
    await page.goto('/search?q=sofian')
    await waitForResults(page)
    const location = page.getByTestId('result-location').first()
    await expect(location).toHaveText(/Se déplace|Mobile/)
    // L'adresse du jeu démo n'existe pas pour une zone : rien à vérifier de
    // plus côté données (contrainte locations_service_area_has_no_address),
    // mais la rangée ne rend jamais address_line1, seulement la ville.
  })

  test('un résultat non revendiqué porte son badge neutre ; un établissement géré n’en porte pas', async ({ page }) => {
    await page.goto('/search')
    await waitForResults(page)
    // demo-barber-corner : ni membre ni identité revendiquée — badge neutre
    // présent (contrat is_managed v2, F3).
    const unmanagedRow = page.locator('[data-org="demo-barber-corner"]')
    await expect(unmanagedRow).toHaveCount(1)
    await expect(unmanagedRow.locator('[data-state="unclaimed"]')).toBeVisible()
    // side-agency (membre) et demo-maison-kais (identité revendiquée
    // rattachée — la cohérence avec /pro/demo.kais.bellamine « Revendiqué »,
    // revue F3 B1) : AUCUN badge de revendication.
    for (const slug of ['side-agency', 'demo-maison-kais']) {
      const managedRow = page.locator(`[data-org="${slug}"]`)
      await expect(managedRow).toHaveCount(1)
      await expect(managedRow.locator('[data-state="unclaimed"]')).toHaveCount(0)
    }
  })

  test('la géolocalisation n’est demandée qu’au geste qui en dépend, et la position active la distance', async ({ page, context }) => {
    await context.grantPermissions(['geolocation'])
    await context.setGeolocation({ latitude: PARIS.latitude, longitude: PARIS.longitude })
    await page.addInitScript(() => {
      const w = window as unknown as { __geoCalls: number }
      w.__geoCalls = 0
      const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation)
      navigator.geolocation.getCurrentPosition = (...args) => {
        w.__geoCalls += 1
        return original(...args)
      }
    })
    await page.goto('/search')
    await waitForResults(page)
    // À l'OUVERTURE : zéro appel.
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0)
    await page.getByTestId('near-me-chip').click()
    await expect(page).toHaveURL(/lat=48\.85/, { timeout: 15_000 })
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(1)
    // La distance réelle apparaît sur les rangées.
    await expect(page.getByTestId('result-distance').first()).toBeVisible({ timeout: 20_000 })
  })

  test('refuser la géolocalisation laisse la recherche par ville pleinement utilisable', async ({ page }) => {
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_success, error) => {
        error?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError)
      }
    })
    await page.goto('/search')
    await waitForResults(page)
    await page.getByTestId('near-me-chip').click()
    await expect(page.getByTestId('geo-denied-note')).toBeVisible()
    // Le chemin manuel, complet : ville tapée -> résultats réels.
    // data-testid est étalé sur l'<input> lui-même par la primitive Input.
    await page.getByTestId('city-input').fill('Paris')
    await page.getByTestId('city-input').press('Enter')
    await expect(page).toHaveURL(/city=Paris/)
    await waitForResults(page)
    await expect(page.getByTestId('result-link').first()).toBeVisible()
  })

  test('un résultat mène au bon profil', async ({ page }) => {
    await page.goto('/search?q=maison')
    await waitForResults(page)
    await page.getByTestId('result-link').filter({ hasText: 'Maison Kaïs' }).click()
    await expect(page).toHaveURL(/\/shop\/demo-maison-kais/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maison Kaïs', { timeout: 20_000 })
  })

  test('la carte est un onglet — la liste reste le défaut, la carte se charge à la demande', async ({ page }) => {
    await page.goto('/search')
    await waitForResults(page)
    await expect(page.getByTestId('search-map')).toHaveCount(0)
    await page.getByRole('tab').last().click()
    await expect(page).toHaveURL(/view=map/)
    await expect(page.getByTestId('search-map')).toBeVisible({ timeout: 30_000 })
  })

  test('axe : /search sans violation sérieuse ou critique', async ({ page }) => {
    await page.goto('/search')
    await waitForResults(page)
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})

test.describe('F3 — accueil', () => {
  test('visiteur sans historique : recherche + découverte réelle, aucune section vide', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-search')).toBeVisible()
    await expect(page.getByTestId('home-discover')).toBeVisible({ timeout: 20_000 })
    // Les sections authentifiées n'existent PAS pour un visiteur.
    await expect(page.getByTestId('home-next-appointment')).toHaveCount(0)
    await expect(page.getByTestId('home-rebook')).toHaveCount(0)
    await expect(page.getByTestId('home-followed')).toHaveCount(0)
    // La recherche de l'accueil route vers /search avec le texte.
    await page.getByTestId('home-search-input').fill('fade')
    await page.getByTestId('home-search-input').press('Enter')
    await expect(page).toHaveURL(/\/search\?q=fade/)
  })

  test('client avec file active : sa position en haut, le chemin vers le suivi', async ({ page }) => {
    // Une VRAIE entrée anonyme (jeton lu en base, position au salon), suivie
    // par la mémoire locale F1b — puis quittée proprement en fin de test.
    const token = sql(`select queue_check_in_token from locations where id = 'de300101-0000-4000-8000-000000000001'`)
    const joined = (await anonRpc('join_public_queue', {
      p_organization_slug: 'demo-maison-kais',
      p_location_id: 'de300101-0000-4000-8000-000000000001',
      p_customer_name: 'QA F3',
      p_check_in_token: token,
      p_latitude: 48.8712,
      p_longitude: 2.3557,
    })) as Array<{ id: string }>
    const entryId = joined[0]?.id
    expect(entryId).toBeTruthy()
    try {
      await page.addInitScript((entry) => {
        window.localStorage.setItem('fadeup.queueEntry', JSON.stringify(entry))
      }, {
        entryId,
        slug: 'demo-maison-kais',
        locationId: 'de300101-0000-4000-8000-000000000001',
        joinedAt: new Date().toISOString(),
      })
      await page.goto('/')
      const card = page.getByTestId('home-active-queue-anonymous')
      await expect(card).toBeVisible({ timeout: 20_000 })
      // La carte de file est AVANT la recherche dans le document.
      const order = await page.evaluate(() => {
        const queue = document.querySelector('[data-testid="home-active-queue-anonymous"]')
        const search = document.querySelector('[data-testid="home-search"]')
        if (!queue || !search) return 'missing'
        return queue.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING ? 'queue-first' : 'search-first'
      })
      expect(order).toBe('queue-first')
      // Le chemin vers le suivi mène à l'écran F1b réel.
      await card.getByRole('button').click()
      await expect(page).toHaveURL(/\/q\/demo-maison-kais/)
    } finally {
      await anonRpc('leave_public_queue', { p_entry_id: entryId })
    }
  })

  test('axe : accueil sans violation sérieuse ou critique', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('home-discover')).toBeVisible({ timeout: 20_000 })
    const results = await new AxeBuilder({ page }).analyze()
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([])
  })
})
