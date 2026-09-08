/**
 * P1PRO — les captures du rapport (hors suite Playwright test), en FRANÇAIS,
 * à 390 et 1440. Reconstruit chaque état RÉEL (tunnel anonyme, RPC en
 * session par mot de passe, SQL d'administration marqué qa-p1pro-*), prend
 * la capture, puis neutralise. À lancer APRÈS la campagne e2e — jamais en
 * parallèle (QA_DATA règle 2b).
 * Usage : node e2e/p1pro/captures.mjs [outdir]
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = process.argv[2] ?? 'docs-artifacts-p1pro'
mkdirSync(OUT, { recursive: true })

const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
const ORG_SLUG = 'qa-f1b-shared'
const OWNER = 'qa-f1b-shared@fadeup.test'
const CUSTOMER = 'qa-p1pro-client@fadeup.test'
const PASSWORD = 'QaF1b!passw0rd'
const CUSTOMER_PASSWORD = 'QaP1pro!passw0rd'

const sql = (q) =>
  execFileSync('docker', ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', q], {
    encoding: 'utf8',
  }).trim()

const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
const anonKey = /^ANON_KEY=(.+)$/m.exec(env)[1].trim().replace(/"/g, '')
const kongPort = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' })
  .split('\n')[0].trim().split(':').pop()
const KONG = `http://127.0.0.1:${kongPort}`

async function token(email, password) {
  const r = await fetch(`${KONG}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return (await r.json()).access_token
}

async function rpc(name, payload, bearer) {
  const r = await fetch(`${KONG}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${bearer ?? anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: text } }
}

const fixture = {
  locationId: sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`),
  barberId: sql(`select id from public.barbers where organization_id='${ORG_ID}' limit 1`),
  serviceId: sql(`select id from public.services where organization_id='${ORG_ID}' and is_active limit 1`),
}

function tomorrowAtUtc(h, m = 0) {
  const d = new Date(Date.now() + 24 * 3600 * 1000)
  d.setUTCHours(h, m, 0, 0)
  return d.toISOString()
}

async function book(startsAt, name, email, bearer) {
  const { status, body } = await rpc('book_public_appointment', {
    p_organization_slug: ORG_SLUG,
    p_location_id: fixture.locationId,
    p_barber_id: fixture.barberId,
    p_service_id: fixture.serviceId,
    p_starts_at: startsAt,
    p_customer_name: name,
    p_customer_email: email,
  }, bearer)
  if (status !== 200) throw new Error(`book ${status}: ${JSON.stringify(body).slice(0, 200)}`)
  return body[0]
}

function neutralize() {
  sql(`update public.appointments set status='cancelled', resolution='cancelled_by_business', decided_at=now()
       where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('pending','confirmed')`)
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status='completed')`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status='completed'`)
  // Les échantillons de durée nés des prestations QA fausseraient
  // l'estimation apprise de F1b (durée completed_at−starts_at aberrante,
  // plafonnée ±50 %) — retirés avec leurs rendez-vous.
  sql(`delete from public.service_duration_samples where organization_id='${ORG_ID}'
       and source_entry_id in (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%')`)
  sql(`delete from public.service_duration_samples where organization_id='${ORG_ID}'
       and source='appointment' and source_entry_id not in (select id from public.appointments)`)
  // Les lignes ANNULÉES de la campagne encombreraient le fil TODAY des
  // captures suivantes — données QA marquées, retirées avec leurs
  // notifications (les journaux append-only ne sont pas touchés).
  sql(`delete from public.notifications where appointment_id in
       (select id from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('cancelled','no_show'))`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and customer_email like 'qa-p1pro-%' and status in ('cancelled','no_show')`)
  sql(`update public.queue_entries set status='cancelled' where organization_id='${ORG_ID}' and status in ('waiting','called','in_service')`)
}

const trialBefore = sql(`select status||'|'||ends_at||'|'||coalesce(expired_at::text,'') from public.organization_trials where organization_id='${ORG_ID}'`).split('|')
const expireTrial = () =>
  sql(`update public.organization_trials set status='expired', ends_at=now()-interval '1 hour', expired_at=now() where organization_id='${ORG_ID}'`)
const restoreTrial = () =>
  sql(`update public.organization_trials set status='${trialBefore[0]}', ends_at='${trialBefore[1]}', expired_at=${trialBefore[2] ? `'${trialBefore[2]}'` : 'null'} where organization_id='${ORG_ID}'`)

const browser = await chromium.launch()

async function frContext(width, height) {
  return browser.newContext({ viewport: { width, height }, locale: 'fr-FR' })
}

async function signIn(page, email, password) {
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(password)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20000 })
}

async function shoot(page, name, width, opts = {}) {
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: opts.fullPage ?? true })
  console.log(`✓ ${name}-${width}`)
}

/* ---------- Phase A : monde Free — demandes + contre-proposition ---------- */
neutralize()
expireTrial()
await book(tomorrowAtUtc(8, 0), 'Karim B.', 'qa-p1pro-cap1@fadeup.test')
await book(tomorrowAtUtc(12, 30), 'Nassim T.', 'qa-p1pro-cap2@fadeup.test')
await book(tomorrowAtUtc(16, 0), 'Yanis M.', 'qa-p1pro-cap3@fadeup.test')
const ownerToken = await token(OWNER, PASSWORD)
const countered = await book(tomorrowAtUtc(9, 30), 'Sofiane L.', 'qa-p1pro-cap4@fadeup.test')
await rpc('counter_propose_booking_request', {
  p_appointment_id: countered.id, p_starts_at: tomorrowAtUtc(14, 0), p_note: 'Pas 9h30, mais 14h — même fauteuil.',
}, ownerToken)
const customerToken = await token(CUSTOMER, CUSTOMER_PASSWORD)
const clientCounter = await book(tomorrowAtUtc(11, 0), 'Client FadeUp', CUSTOMER, customerToken)
await rpc('counter_propose_booking_request', {
  p_appointment_id: clientCounter.id, p_starts_at: tomorrowAtUtc(15, 0), p_note: 'Pas 11h, mais 15h — même fauteuil.',
}, ownerToken)

for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await frContext(w, h)
  const page = await ctx.newPage()
  await signIn(page, OWNER, PASSWORD)
  await page.goto(`${BASE}/dashboard/requests`)
  await page.getByTestId('request-card').first().waitFor({ timeout: 20000 })
  await shoot(page, 'requests', w)
  // La feuille de contre-proposition, ouverte sur une vraie demande.
  await page.getByTestId('request-counter').first().click()
  await page.getByTestId('counter-slots').waitFor({ timeout: 20000 })
  await shoot(page, 'counter-sheet-pro', w, { fullPage: false })
  await ctx.close()

  const cctx = await frContext(w, h)
  const cpage = await cctx.newPage()
  await signIn(cpage, CUSTOMER, CUSTOMER_PASSWORD)
  await cpage.goto(`${BASE}/bookings`)
  await cpage.getByTestId('counter-proposal-card').waitFor({ timeout: 20000 })
  await shoot(cpage, 'counter-client', w)
  await cctx.close()
}

/* ---------- Phase B : capacités restaurées — l'accueil avec données ---------- */
restoreTrial()
sql(`update public.location_service_settings set queue_open=true where location_id='${fixture.locationId}'`)
sql(`insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_email, starts_at, ends_at, status)
     values ('${ORG_ID}','${fixture.locationId}','${fixture.barberId}','${fixture.serviceId}','Adam S.','qa-p1pro-capdone@fadeup.test', now()-interval '2 hours', now()-interval '90 minutes','confirmed')`)
sql(`update public.appointments set status='completed' where organization_id='${ORG_ID}' and customer_email='qa-p1pro-capdone@fadeup.test' and status='confirmed'`)
sql(`insert into public.appointments (organization_id, location_id, barber_id, service_id, customer_name, customer_email, starts_at, ends_at, status)
     values ('${ORG_ID}','${fixture.locationId}','${fixture.barberId}','${fixture.serviceId}','Ibrahim K.','qa-p1pro-capnow@fadeup.test', now()-interval '10 minutes', now()+interval '20 minutes','confirmed')`)
await book(new Date(Date.now() + 3 * 3600 * 1000).toISOString(), 'Mehdi R.', 'qa-p1pro-capnext@fadeup.test', ownerToken)
sql(`insert into public.queue_entries (organization_id, location_id, customer_name, status) values
     ('${ORG_ID}','${fixture.locationId}','Rayan','waiting'),
     ('${ORG_ID}','${fixture.locationId}','Théo','waiting'),
     ('${ORG_ID}','${fixture.locationId}','Sami','waiting')`)

for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await frContext(w, h)
  const page = await ctx.newPage()
  await signIn(page, OWNER, PASSWORD)
  await page.goto(`${BASE}/dashboard`)
  await page.getByTestId('pro-home-hero').waitFor({ timeout: 20000 })
  await shoot(page, 'home-data', w)
  await ctx.close()
}

/* ---------- Phase C : journée vide — l'état honnête ---------- */
neutralize()
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await frContext(w, h)
  const page = await ctx.newPage()
  await signIn(page, OWNER, PASSWORD)
  await page.goto(`${BASE}/dashboard`)
  await page.getByTestId('pro-home-empty').waitFor({ timeout: 20000 })
  await shoot(page, 'home-empty', w)
  await ctx.close()
}

/* ---------- Phase D : la découverte — « Sur demande » vs « Réservable » ---------- */
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const ctx = await frContext(w, h)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/search?q=atelier`)
  await page.locator('[data-state="on-request"]').first().waitFor({ timeout: 20000 })
  await shoot(page, 'search-onrequest', w)
  await page.getByTestId('result-open').first().click()
  await page.getByTestId('sheet-book-cta').waitFor({ timeout: 20000 })
  await shoot(page, 'sheet-onrequest', w, { fullPage: false })
  await page.keyboard.press('Escape')
  await page.goto(`${BASE}/search?q=kais`)
  await page.getByTestId('result-card').first().waitFor({ timeout: 20000 })
  await shoot(page, 'search-bookable', w)
  await page.goto(`${BASE}/shop/demo-atelier-fadel`)
  await page.getByTestId('profile-book-cta').first().waitFor({ timeout: 20000 })
  await shoot(page, 'shop-onrequest', w)
  await ctx.close()
}

/* ---------- Fin : restaurer et neutraliser ---------- */
restoreTrial()
neutralize()
sql(`update public.location_service_settings set queue_open=false where location_id='${fixture.locationId}'`)
await browser.close()
console.log(`captures dans ${OUT}`)
