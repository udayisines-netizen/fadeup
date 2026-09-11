/**
 * OS-1 — coup d'œil RÉEL sur l'agenda pendant la construction : connexion
 * owner par l'écran, données réelles créées par la RPC du comptoir (marquées
 * qa-os1), captures 1440 et 390, erreurs console et requêtes en échec.
 * Usage : node e2e/os1/smoke.mjs [outdir]
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = process.argv[2] ?? '/tmp/os1-smoke'
mkdirSync(OUT, { recursive: true })
const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
const OWNER = 'qa-f1b-shared@fadeup.test'
const PASSWORD = 'QaF1b!passw0rd'
const sql = (q) =>
  execFileSync('docker', ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', q], { encoding: 'utf8' }).trim()
const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
const anonKey = /^ANON_KEY=(.+)$/m.exec(env)[1].trim().replace(/"/g, '')
const kongPort = execFileSync('docker', ['port', 'fadeup-supabase-kong', '8000/tcp'], { encoding: 'utf8' }).split('\n')[0].trim().split(':').pop()
const KONG = `http://127.0.0.1:${kongPort}`

async function token(email, password) {
  const r = await fetch(`${KONG}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  return (await r.json()).access_token
}
async function rpc(name, payload, bearer) {
  const r = await fetch(`${KONG}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: anonKey, Authorization: `Bearer ${bearer ?? anonKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const text = await r.text()
  try { return { status: r.status, body: JSON.parse(text) } } catch { return { status: r.status, body: text } }
}

const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
const barbers = JSON.parse(sql(`select json_agg(json_build_object('id', b.id, 'name', sp.display_name) order by sp.display_name) from public.barbers b join public.staff_profiles sp on sp.id=b.staff_profile_id where b.organization_id='${ORG_ID}'`))
const services = JSON.parse(sql(`select json_agg(json_build_object('id', id, 'name', name, 'duration', duration_minutes) order by name) from public.services where organization_id='${ORG_ID}' and is_active`))
const day = new Date().toISOString().slice(0, 10)
const nowH = new Date().getUTCHours()
const t = await token(OWNER, PASSWORD)
const plan = [
  [0, 0, nowH + 1, 0, 'Karim B.'],
  [0, 1, nowH + 2, 0, 'Sami D.'],
  [1, 0, nowH + 1, 30, 'Léo M.'],
  [2, 2, nowH + 3, 0, 'Nadia R.'],
  [1, 1, nowH + 4, 15, 'Yanis T.'],
]
for (const [bi, si, h, m, name] of plan) {
  if (h > 22) continue
  const r = await rpc('create_appointment_as_business', {
    p_location_id: locationId, p_barber_id: barbers[bi].id, p_service_id: services[si].id,
    p_starts_at: `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
    p_customer_name: name, p_customer_email: `qa-os1-${name.toLowerCase().replace(/[^a-z]/g, '')}@fadeup.test`, p_notes: 'qa-os1',
  }, t)
  console.log('create', name, r.status, r.status !== 200 ? JSON.stringify(r.body).slice(0, 160) : '')
}
sql(`insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason) values ('${ORG_ID}','${locationId}','${barbers[2].id}','${day}T${String(Math.min(nowH + 5, 22)).padStart(2, '0')}:00:00Z','${day}T${String(Math.min(nowH + 6, 23)).padStart(2, '0')}:00:00Z','qa-os1 Pause')`)

const browser = await chromium.launch()
for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
  page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`))
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill(OWNER)
  await page.getByLabel(/mot de passe|password/i).first().fill(PASSWORD)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 20_000 })
  await page.goto(`${BASE}/dashboard/agenda`)
  await page.getByTestId('agenda-day-grid').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${OUT}/day-${label}.png`, fullPage: true })
  await page.getByRole('radio', { name: /semaine|week/i }).click()
  await page.getByTestId('agenda-week-grid').waitFor()
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/week-${label}.png`, fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  console.log(label, 'overflowX', overflow, 'errors', errors)
  await context.close()
}
await browser.close()
