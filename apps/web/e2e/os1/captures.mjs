/**
 * OS-1 — les captures du rapport (hors suite Playwright test), en FRANÇAIS,
 * à 390 et 1440. Reconstruit chaque état RÉEL (RPC du comptoir en session
 * owner, SQL d'administration marqué qa-os1), prend la capture, puis
 * neutralise. À lancer APRÈS la campagne e2e — jamais en parallèle
 * (QA_DATA règle 2b).
 * Usage : node e2e/os1/captures.mjs [outdir]
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4610'
const OUT = process.argv[2] ?? 'docs-artifacts-os1'
mkdirSync(OUT, { recursive: true })

const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
const OWNER = 'qa-f1b-shared@fadeup.test'
const BARBER = 'qa-f1b-barber@fadeup.test'
const PASSWORD = 'QaF1b!passw0rd'
const MARK = 'qa-os1'

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

function neutralize() {
  sql(`delete from public.appointment_overlap_forces where appointment_id in (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${MARK}' or customer_email like '${MARK}-%'))`)
  sql(`delete from public.notifications where appointment_id in (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${MARK}' or customer_email like '${MARK}-%'))`)
  sql(`delete from public.service_duration_samples where source='appointment' and source_entry_id in (select id from public.appointments where organization_id='${ORG_ID}' and (notes='${MARK}' or customer_email like '${MARK}-%'))`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and (notes='${MARK}' or customer_email like '${MARK}-%')`)
  sql(`delete from public.time_blocks where organization_id='${ORG_ID}' and reason like '${MARK}%'`)
  sql(`update public.memberships set can_view_revenue=false where organization_id='${ORG_ID}'`)
}

// Fixture : horaires larges, tout le monde apte à tout, essai actif.
const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
sql(`update public.locations set is_active=true where id='${locationId}'`)
sql(`update public.staff_profiles set is_active=true, is_public=true, location_id='${locationId}' where organization_id='${ORG_ID}'`)
sql(`update public.barbers set is_bookable=true where organization_id='${ORG_ID}'`)
sql(`insert into public.barber_services (organization_id, barber_id, service_id) select '${ORG_ID}', b.id, s.id from public.barbers b cross join public.services s where b.organization_id='${ORG_ID}' and s.organization_id='${ORG_ID}' and s.is_active on conflict do nothing`)
sql(`delete from public.location_hours where location_id='${locationId}'`)
sql(`delete from public.barber_working_hours where barber_id in (select id from public.barbers where organization_id='${ORG_ID}')`)
for (let d = 0; d <= 6; d += 1) {
  sql(`insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time) values ('${ORG_ID}','${locationId}',${d},false,'00:00','23:59')`)
  sql(`insert into public.barber_working_hours (organization_id, barber_id, day_of_week, is_off, start_time, end_time) select '${ORG_ID}', b.id, ${d}, false, '00:00', '23:59' from public.barbers b where b.organization_id='${ORG_ID}'`)
}
sql(`update public.organization_trials set status='active', ends_at=greatest(ends_at, now() + interval '2 days'), expired_at=null where organization_id='${ORG_ID}'`)
neutralize()

const barbers = JSON.parse(sql(`select json_agg(json_build_object('id', b.id, 'name', sp.display_name) order by sp.display_name) from public.barbers b join public.staff_profiles sp on sp.id=b.staff_profile_id where b.organization_id='${ORG_ID}'`))
const services = JSON.parse(sql(`select json_agg(json_build_object('id', id, 'name', name) order by name) from public.services where organization_id='${ORG_ID}' and is_active`))
const svc = (n) => services.find((s) => s.name === n).id
const day = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10)
const at = (h, m = 0) => `${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
const ownerToken = await token(OWNER, PASSWORD)

async function create(bi, serviceName, iso, name, extra = {}) {
  const r = await rpc('create_appointment_as_business', {
    p_location_id: locationId, p_barber_id: barbers[bi].id, p_service_id: svc(serviceName), p_starts_at: iso,
    p_customer_name: name, p_customer_email: `${MARK}-${name.toLowerCase().replace(/[^a-z]/g, '')}@fadeup.test`, p_notes: MARK, ...extra,
  }, ownerToken)
  if (r.status !== 200) console.log('create', name, r.status, JSON.stringify(r.body).slice(0, 160))
  return r.body
}

// Une journée réaliste : Amine (0), Karim (1), Qa Owner (2).
const plan = [
  [0, 'Coupe', at(9, 0), 'Karim B.'], [0, 'Barbe', at(9, 45), 'Sami D.'], [0, 'Coupe + barbe', at(11, 0), 'Léo M.'], [0, 'Coupe', at(14, 0), 'Yanis T.'], [0, 'Coupe', at(16, 30), 'Idris K.'],
  [1, 'Coupe + barbe', at(9, 30), 'Nadia R.'], [1, 'Coupe', at(11, 30), 'Mehdi A.'], [1, 'Barbe', at(13, 0), 'Tom G.'], [1, 'Coupe', at(15, 0), 'Rayan B.'],
  [2, 'Coupe', at(10, 0), 'Ali S.'], [2, 'Coupe + barbe', at(14, 30), 'Hugo P.'], [2, 'Coupe', at(17, 0), 'Enzo L.'],
]
const rows = []
for (const [bi, s, iso, name] of plan) rows.push(await create(bi, s, iso, name))
// Un forçage réel (owner) : Amine 9:15, sur Karim B.
const forced = await create(0, 'Barbe', at(9, 15), 'Bilal F.', { p_force: true, p_force_reason: 'Client fidèle, l’apprenti fait la barbe' })
// Un temps bloqué ponctuel et une série hebdomadaire.
sql(`insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason) values ('${ORG_ID}','${locationId}','${barbers[1].id}','${at(12, 0)}','${at(13, 0)}','${MARK} Pause déjeuner')`)
const series = sql('select gen_random_uuid()')
for (let w = 0; w < 4; w += 1) {
  const d = new Date(Date.parse(day) + w * 7 * 86_400_000).toISOString().slice(0, 10)
  sql(`insert into public.time_blocks (organization_id, location_id, barber_id, starts_at, ends_at, reason, series_id) values ('${ORG_ID}','${locationId}','${barbers[2].id}','${d}T18:00:00Z','${d}T19:00:00Z','${MARK} Formation', '${series}')`)
}
// Une prestation terminée aujourd'hui (revenu calculé) — sur un rendez-vous d'aujourd'hui passé.
const todayDone = await create(2, 'Coupe', new Date(Date.now() + 90_000).toISOString(), 'Omar C.')
sql(`select set_config('fadeup.appointment_reschedule','on',false); update public.appointments set starts_at=now()-interval '50 minutes', ends_at=now()-interval '20 minutes' where id='${todayDone.id}'`)
await rpc('complete_appointment', { p_appointment_id: todayDone.id }, ownerToken)

const browser = await chromium.launch()
async function session(email, viewport) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' })
  const page = await context.newPage()
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(PASSWORD)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 60_000 })
  return { context, page }
}
async function agendaTomorrow(page) {
  await page.goto(`${BASE}/dashboard/agenda`)
  await page.getByTestId('pro-agenda').waitFor({ timeout: 60_000 })
  await page.getByTestId('agenda-next').click()
  await page.getByTestId('agenda-day-grid').waitFor({ timeout: 45_000 })
  await page.waitForTimeout(900)
}
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts })

for (const [label, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
  const { context, page } = await session(OWNER, viewport)
  await agendaTomorrow(page)
  await shot(page, `day-${label}`, { fullPage: label === '390' })
  // Vue jour, fenêtre : les 8 premières heures visibles d'un coup (desktop).
  if (label === '1440') await shot(page, `day-viewport-${label}`)

  // Semaine par ressource.
  await page.getByRole('radio', { name: /semaine/i }).click()
  await page.getByTestId('agenda-week-grid').waitFor()
  await page.waitForTimeout(600)
  await shot(page, `week-${label}`, { fullPage: true })
  await page.getByRole('radio', { name: /jour/i }).click()
  await page.getByTestId('agenda-day-grid').waitFor()

  // Glisser en cours : Yanis T. (Amine 14:00) saisi et suspendu vers 15:30.
  const grid = page.locator('[data-hour-start]')
  const startHour = Number(await grid.getAttribute('data-hour-start'))
  const source = page.locator(`[data-appointment-id="${rows[3].id}"]`)
  const column = page.getByTestId('agenda-column').first()
  const box = await source.boundingBox()
  const col = await column.boundingBox()
  const targetY = col.y + ((15.5 * 60 - startHour * 60) / 60) * 96
  await page.evaluate((delta) => window.scrollBy(0, delta), Math.min(box.y, targetY) - 120)
  await page.waitForTimeout(150)
  const box2 = await source.boundingBox()
  const col2 = await column.boundingBox()
  await page.mouse.move(box2.x + 24, box2.y + 6)
  await page.mouse.down()
  await page.mouse.move(box2.x + 30, box2.y + 12)
  await page.mouse.move(col2.x + col2.width / 2, col2.y + ((15.5 * 60 - startHour * 60) / 60) * 96 + 6, { steps: 10 })
  await page.waitForTimeout(200)
  await shot(page, `drag-${label}`)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // Avertissement de conflit : Yanis T. lâché sur Idris K. (16:30).
  const box3 = await source.boundingBox()
  const col3 = await column.boundingBox()
  await page.mouse.move(box3.x + 24, box3.y + 6)
  await page.mouse.down()
  await page.mouse.move(box3.x + 30, box3.y + 12)
  await page.mouse.move(col3.x + col3.width / 2, col3.y + ((16.5 * 60 - startHour * 60) / 60) * 96 + 6, { steps: 10 })
  await page.mouse.up()
  await page.getByTestId('agenda-conflict').waitFor({ timeout: 15_000 })
  await page.getByTestId('agenda-force-reason').fill('Client fidèle, l’apprenti prend le shampoing')
  await page.waitForTimeout(150)
  await shot(page, `conflict-${label}`)
  await page.getByTestId('agenda-conflict-other').click()

  // Blocage de temps : la feuille (récurrent) puis le blocage posé dans la grille.
  await page.getByTestId('agenda-block-button').click()
  const form = page.getByTestId('agenda-block-form')
  await form.waitFor()
  await form.getByLabel(/date/i).fill(day)
  await form.getByLabel(/début/i).fill('12:00')
  await form.getByLabel(/^fin/i).fill('13:00')
  await page.getByTestId('agenda-block-reason').fill('Pause déjeuner')
  await form.getByRole('checkbox').click()
  await page.waitForTimeout(150)
  await shot(page, `block-sheet-${label}`)
  await page.keyboard.press('Escape')

  // La fiche d'un rendez-vous (Terminé en un geste) et le forcé.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator(`[data-appointment-id="${forced.id}"]`).click()
  await page.getByTestId('agenda-appointment-sheet').waitFor()
  await page.waitForTimeout(300)
  await shot(page, `sheet-forced-${label}`)
  await page.keyboard.press('Escape')

  // Agenda vide : dans trois semaines.
  await page.getByRole('radio', { name: /semaine/i }).click()
  for (let i = 0; i < 4; i += 1) await page.getByTestId('agenda-next').click()
  await page.getByTestId('agenda-empty').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(400)
  await shot(page, `empty-${label}`)

  await context.close()

  // Le barber sans permission de revenu : aucun montant nulle part.
  const b = await session(BARBER, viewport)
  await agendaTomorrow(b.page)
  await shot(b.page, `barber-no-revenue-${label}`, { fullPage: label === '390' })
  await b.context.close()
}
await browser.close()
neutralize()
console.log('captures →', OUT)
