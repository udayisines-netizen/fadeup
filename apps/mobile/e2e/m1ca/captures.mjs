/**
 * FadeUp — M1c-a : campagne de captures du rendu WEB de l'application mobile.
 *
 * CE QUE CETTE CAMPAGNE PROUVE, ET CE QU'ELLE NE PROUVE PAS
 *
 * Elle prouve que les écrans du lot rendent, en français et en anglais, sans
 * erreur de console ni requête en échec, contre la BASE DE PRODUCTION réelle :
 * les préférences de notification lues par les RPC de M1c-a, et le hors-ligne
 * des réservations avec sa mention d'âge.
 *
 * Elle NE prouve PAS l'arrivée d'une notification : le rendu web n'a pas
 * d'APNs, Expo Go n'a plus le push distant depuis le SDK 53, et un build de
 * développement exige la licence Apple. C'est écrit au rapport, pas maquillé.
 *
 * Prérequis :
 *   npx expo export --platform web --output-dir dist
 *   npx serve -s dist -l 4176        (le -s est OBLIGATOIRE : sans lui, 404
 *                                     sur toute route profonde — piège M1b)
 *   psql -f e2e/m1ca/fixtures.sql    (et cleanup.sql après)
 *
 * Usage : node e2e/m1ca/captures.mjs [baseUrl] [outDir]
 */
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Playwright n'est PAS une dépendance du mobile : le paquet vit dans
 * `apps/web/node_modules` et les navigateurs dans le cache de l'utilisateur.
 * On le résout à l'exécution plutôt que de charger un outil de QA dans le
 * graphe de l'application livrée.
 */
const require = createRequire(import.meta.url)
const PLAYWRIGHT_CANDIDATES = [
  'playwright',
  '/opt/fadeup/apps/web/node_modules/playwright',
  resolve(here, '../../../web/node_modules/playwright'),
]
let chromium = null
for (const candidate of PLAYWRIGHT_CANDIDATES) {
  try {
    chromium = require(candidate).chromium
    break
  } catch {
    /* candidat suivant */
  }
}
if (!chromium) {
  throw new Error(`playwright introuvable (essayé : ${PLAYWRIGHT_CANDIDATES.join(', ')})`)
}

const BASE = process.argv[2] ?? 'http://localhost:4176'
const OUT = process.argv[3] ?? resolve(here, '../../../../docs/reports/artifacts/m1ca')

const QA_EMAIL = 'qa_m1ca_captures@fadeup.test'
const QA_PASSWORD = 'm1ca-captures-2026'

async function readEnv() {
  const raw = await readFile(resolve(here, '../..', '.env' + '.local'), 'utf8')
  const out = {}
  for (const line of raw.split('\n')) {
    const index = line.indexOf('=')
    if (index > 0) out[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return { url: out.EXPO_PUBLIC_SUPABASE_URL, anon: out.EXPO_PUBLIC_SUPABASE_ANON_KEY }
}

/**
 * Une session GoTrue réelle, sans passer par un e-mail : le quota Resend est
 * épuisé en production (défaut relevé en M1b), donc l'OTP ne boucle pas. Le
 * mot de passe de la fixture est le seul chemin qui ne dépend d'aucun envoi.
 */
async function signIn(env) {
  const response = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: env.anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: QA_EMAIL, password: QA_PASSWORD }),
  })
  if (!response.ok) {
    throw new Error(`connexion QA refusée : ${response.status} ${await response.text()}`)
  }
  const session = await response.json()
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600),
    user: session.user,
  }
}

/** Le nom de la clé de stockage que supabase-js dérive de l'URL du projet. */
function storageKey(url) {
  const host = new URL(url).hostname
  return `sb-${host.split('.')[0]}-auth-token`
}

const problems = []

function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    // Le rendu web n'a ni module natif de notifications ni APNs : l'absence
    // est ATTENDUE ici, et déclarée au rapport plutôt que masquée.
    if (/expo-notifications|Notification|not supported in Expo Go/i.test(text)) return
    problems.push(`[console ${label}] ${text}`)
  })
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? ''
    // Les requêtes coupées EXPRÈS pendant la passe hors ligne.
    if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/.test(failure)) return
    // La navigation côté client d'expo-router annule la requête de document du
    // serveur statique : artefact du harnais, pas de l'application.
    if (failure === 'net::ERR_ABORTED' && request.url() === `${BASE}/`) return
    problems.push(`[requête ${label}] ${request.url()} — ${failure}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`[HTTP ${label}] ${response.status()} ${response.url()}`)
  })
}

/** Coupe le réseau ET réveille NetInfo, qui ne bascule pas seul en Chromium. */
async function goOffline(context, page) {
  await context.setOffline(true)
  await page.evaluate(() => {
    // eslint-disable-next-line no-undef
    window.dispatchEvent(new Event('offline'))
    // eslint-disable-next-line no-undef
    const connection = navigator.connection
    if (connection?.dispatchEvent) connection.dispatchEvent(new Event('change'))
  })
  await page.waitForTimeout(1200)
}

async function shot(page, name) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: resolve(OUT, `${name}.png`), fullPage: false })
  console.log(`  capture ${name}`)
}

async function run() {
  await mkdir(OUT, { recursive: true })
  const env = await readEnv()
  const session = await signIn(env)
  const key = storageKey(env.url)
  const browser = await chromium.launch()

  for (const [tag, locale] of [
    ['fr', 'fr-FR'],
    ['en', 'en-GB'],
  ]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      locale,
      isMobile: true,
      hasTouch: true,
      /*
       * AUCUN grant de notifications, et c'est une CONSTATATION, pas un oubli :
       * permission accordée, le chemin push du rendu web (service worker, clé
       * VAPID) ne rend jamais la main et la passe se bloque — mesuré deux fois.
       * Artefact de react-native-web ; la cible du lot est iOS, où le chemin
       * est natif et borné à dix secondes (usePushDevice, TOKEN_TIMEOUT_MS).
       *
       * Chromium refuse donc les notifications, et la section du compte rend
       * son état « refusé par le système » : un état RÉEL du produit — celui
       * d'un client qui a dit non une fois, ce qu'iOS ne redemande jamais.
       */
      permissions: [],
    })

    // La session AVANT tout chargement : AsyncStorage est adossé à
    // localStorage dans le rendu web.
    await context.addInitScript(
      ([storage, value, onboarding]) => {
        // eslint-disable-next-line no-undef
        window.localStorage.setItem(storage, value)
        // eslint-disable-next-line no-undef
        window.localStorage.setItem('fu.onboarding.v1', onboarding)
      },
      [
        key,
        JSON.stringify(session),
        /* La forme EXACTE qu'attend readOnboarding : sans `completedAt`, la
           porte renvoie sur l'onboarding et la capture montre l'écran de
           bienvenue (constaté à la première passe). */
        JSON.stringify({
          firstName: 'QA',
          gender: 'man',
          frequency: 'every_2_weeks',
          completedAt: new Date().toISOString(),
        }),
      ],
    )

    const page = await context.newPage()
    watch(page, tag)

    // ---- Compte : les préférences de notification, lues en base.
    await page.goto(`${BASE}/account`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)
    /* La section vit en bas d'un ScrollView : on cible le TITRE et on le fait
       venir. Un `scrollIntoView` sur un nœud deviné ne suffisait pas. */
    await page
      .getByText('Notifications', { exact: true })
      .first()
      .scrollIntoViewIfNeeded({ timeout: 15_000 })
    await page.waitForTimeout(600)
    await shot(page, `50-account-notifications-${tag}-390`)

    // ---- Réservations en ligne, puis hors ligne : la mention d'âge.
    await page.goto(`${BASE}/bookings`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await shot(page, `51-bookings-online-${tag}-390`)

    await goOffline(context, page)
    await shot(page, `52-bookings-offline-${tag}-390`)

    await context.setOffline(false)
    await context.close()
  }

  await browser.close()

  if (problems.length > 0) {
    console.error('\nPROBLÈMES :')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exitCode = 1
  } else {
    console.log('\nAucune erreur de console, aucune requête en échec.')
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
