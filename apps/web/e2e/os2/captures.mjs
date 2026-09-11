/**
 * OS-2 — les captures du rapport (hors suite Playwright test), en FRANÇAIS,
 * à 390 et 1440. Reconstruit chaque état RÉEL sur l'organisation partagée
 * `qa-f1b-shared` (SQL d'administration marqué « QA OS2 »), prend la
 * capture, puis neutralise. À lancer APRÈS la campagne e2e — jamais en
 * parallèle (QA_DATA règle 2b).
 *
 * Usage : QA_BASE=http://127.0.0.1:4640 node e2e/os2/captures.mjs <outdir>
 */
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:4640'
const OUT = process.argv[2] ?? 'docs-artifacts-os2'
mkdirSync(OUT, { recursive: true })

const ORG_ID = '1542ea38-5585-4f84-99ba-195ff407b719'
const OWNER = 'qa-f1b-shared@fadeup.test'
const BARBER = 'qa-f1b-barber@fadeup.test'
const PASSWORD = 'QaF1b!passw0rd'

const sql = (q) =>
  execFileSync('docker', ['exec', '-i', 'fadeup-supabase-db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-At', '-c', q], {
    encoding: 'utf8',
  }).trim()
const env = readFileSync('/opt/fadeup/infra/supabase/.env', 'utf8')
const anonKey = /^ANON_KEY=(.+)$/m.exec(env)[1].trim().replace(/"/g, '')

function neutralize() {
  sql(`update public.organizations set business_type='barbershop' where id='${ORG_ID}'`)
  sql(`delete from public.service_duration_samples where service_id in (select id from public.services where organization_id='${ORG_ID}')`)
  sql(`delete from public.appointments where organization_id='${ORG_ID}' and notes='qa-os2-cap'`)
  sql(`delete from public.customer_notes where organization_id='${ORG_ID}'`)
  sql(`delete from public.customers where organization_id='${ORG_ID}' and name like 'QA OS2%'`)
  sql(`delete from public.barber_services where service_id in (select id from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%')`)
  sql(`delete from public.service_locations where service_id in (select id from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%')`)
  sql(`delete from public.services where organization_id='${ORG_ID}' and name like 'QA OS2%'`)
  sql(`delete from public.email_outbox where to_email like 'qa-os2-%@fadeup.test'`)
  sql(`delete from public.invitations where organization_id='${ORG_ID}' and email like 'qa-os2-%@fadeup.test'`)
  sql(`update public.services set is_active=true, archived_at=null, price_pending=false where organization_id='${ORG_ID}'`)
  sql(`update public.barbers set is_bookable=true, queue_enabled=true where organization_id='${ORG_ID}'`)
  sql(`update public.location_service_settings set queue_capacity_per_barber=20, queue_call_grace_minutes=5, queue_geofence_meters=150, queue_grace_sweep_enabled=false where organization_id='${ORG_ID}'`)
}

// ---------------------------------------------------------------------------
// Fixture : une organisation qui a RÉELLEMENT vécu.
// ---------------------------------------------------------------------------
neutralize()
const locationId = sql(`select id from public.locations where organization_id='${ORG_ID}' limit 1`)
sql(`update public.locations set is_active=true where id='${locationId}'`)
sql(`select private.ensure_location_service_settings('${locationId}')`)
sql(`update public.location_service_settings set default_service_mode='hybrid', queue_open=true where location_id='${locationId}'`)
sql(`update public.staff_profiles set is_active=true, is_public=true, location_id='${locationId}' where organization_id='${ORG_ID}'`)
sql(`update public.barbers set is_bookable=true, queue_enabled=true where organization_id='${ORG_ID}'`)
sql(`update public.organization_trials set status='active', ends_at=greatest(ends_at, now() + interval '2 days'), expired_at=null where organization_id='${ORG_ID}'`)
for (let d = 0; d <= 6; d += 1) {
  sql(`insert into public.location_hours (organization_id, location_id, day_of_week, is_closed, open_time, close_time)
       select '${ORG_ID}','${locationId}',${d},false,'00:00','23:59'
       where not exists (select 1 from public.location_hours where location_id='${locationId}' and day_of_week=${d})`)
}

const barbers = JSON.parse(
  sql(`select json_agg(json_build_object('id', b.id, 'name', sp.display_name) order by sp.display_name)
       from public.barbers b join public.staff_profiles sp on sp.id=b.staff_profile_id where b.organization_id='${ORG_ID}'`),
)
const services = JSON.parse(
  sql(`select json_agg(json_build_object('id', id, 'name', name) order by name) from public.services where organization_id='${ORG_ID}' and is_active`),
)

// Un catalogue réaliste : une catégorie, un brouillon sans prix, un archivé.
const categoryId = sql(`with created as (
  insert into public.service_categories (organization_id, name, display_order)
  values ('${ORG_ID}', 'QA OS2 Soins', 0) returning id) select id from created`)
sql(`update public.services set category_id='${categoryId}' where organization_id='${ORG_ID}' and name='${services[0].name}'`)
sql(`insert into public.services (organization_id, name, duration_minutes, price_cents, is_active, price_pending)
  values ('${ORG_ID}', 'QA OS2 Rasage traditionnel', 25, 0, false, true)`)
sql(`insert into public.services (organization_id, name, duration_minutes, price_cents, is_active, archived_at)
  values ('${ORG_ID}', 'QA OS2 Coloration', 60, 4500, false, now())`)
sql(`insert into public.barber_services (organization_id, barber_id, service_id)
     select '${ORG_ID}', b.id, s.id from public.barbers b cross join public.services s
     where b.organization_id='${ORG_ID}' and s.organization_id='${ORG_ID}' and s.is_active on conflict do nothing`)

// Des durées RÉELLEMENT observées sur le premier service : 27 min sur 34 mesures.
for (let i = 0; i < 34; i += 1) {
  sql(`insert into public.service_duration_samples
        (organization_id, location_id, barber_id, service_id, source, source_entry_id, started_at, ended_at)
       values ('${ORG_ID}','${locationId}','${barbers[0].id}','${services[0].id}','queue', gen_random_uuid(),
               now() - interval '${i + 1} days', now() - interval '${i + 1} days' + interval '27 minutes')`)
}

// Des clients : un régulier en retard, un régulier à l'heure, un nouveau.
function seedCustomer(name, count, daysSinceLast, interval) {
  const id = sql(`with created as (insert into public.customers (organization_id, name, phone)
    values ('${ORG_ID}', 'QA OS2 ${name}', null) returning id) select id from created`)
  for (let i = 0; i < count; i += 1) {
    const offset = daysSinceLast + i * interval
    sql(`insert into public.appointments
          (organization_id, location_id, barber_id, service_id, customer_name, customer_id, starts_at, ends_at, status, completed_at, notes)
         values ('${ORG_ID}','${locationId}','${barbers[0].id}','${services[0].id}','QA OS2 ${name}','${id}',
                 now() - interval '${offset} days', now() - interval '${offset} days' + interval '30 minutes',
                 'completed', now() - interval '${offset} days' + interval '30 minutes', 'qa-os2-cap')`)
  }
  return id
}
seedCustomer('Mehdi A.', 5, 104, 26)
seedCustomer('Nadia R.', 4, 12, 28)
seedCustomer('Tom G.', 1, 3, 0)
seedCustomer('Rayan B.', 6, 21, 21)

const browser = await chromium.launch()
async function session(email, viewport) {
  const context = await browser.newContext({ viewport, locale: 'fr-FR' })
  const page = await context.newPage()
  await page.goto(`${BASE}/auth/login`)
  await page.getByLabel(/e-?mail/i).first().fill(email)
  await page.getByLabel(/mot de passe|password/i).first().fill(PASSWORD)
  await page.getByRole('button', { name: /se connecter|sign in/i }).click()
  await page.waitForURL((u) => !u.pathname.startsWith('/auth'), { timeout: 60_000 })
  return { context, page }
}
const shot = (page, name, opts = {}) => page.screenshot({ path: `${OUT}/${name}.png`, ...opts })

for (const [label, viewport] of [
  ['1440', { width: 1440, height: 900 }],
  ['390', { width: 390, height: 844 }],
]) {
  const full = label === '390'
  const { context, page } = await session(OWNER, viewport)

  // 1. Le catalogue, avec un brouillon sans prix et une durée observée.
  await page.goto(`${BASE}/dashboard/catalog`)
  await page.getByTestId('pro-catalog-list').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(500)
  await shot(page, `catalog-${label}`, { fullPage: full })

  // 2. La feuille d'un service : l'effet de la durée sur l'estimation, ET
  //    le champ prix. À 390 px le prix est sous la ligne de flottaison :
  //    sans ce défilement, la capture « avec prix » et la capture « sans
  //    prix » seraient octet pour octet identiques et ne prouveraient rien.
  await page.getByTestId('pro-catalog-list').getByText(services[0].name, { exact: false }).first().click()
  await page.getByTestId('pro-catalog-estimate').waitFor({ timeout: 20_000 })
  await page.waitForTimeout(400)
  await shot(page, `catalog-sheet-${label}`)
  await page.getByTestId('pro-catalog-field-price').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await shot(page, `catalog-sheet-price-${label}`)
  await page.keyboard.press('Escape')

  // 3. Les archives.
  await page.getByTestId('pro-catalog-show-archived').click()
  await page.waitForTimeout(400)
  await shot(page, `catalog-archived-${label}`, { fullPage: full })

  // 4. Les clients, segment « non revenus » en évidence.
  await page.goto(`${BASE}/dashboard/clients`)
  await page.getByTestId('pro-clients-list').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(500)
  await shot(page, `clients-${label}`, { fullPage: full })

  // 5. La fiche client, avec une note privée réelle.
  await page.getByTestId('pro-clients-list').getByText('QA OS2 Mehdi A.').first().click()
  await page.getByTestId('pro-client-detail').waitFor({ timeout: 30_000 })
  const noteField = page.getByTestId('pro-client-note-input')
  await noteField.fill('Dégradé court, tondeuse 1 sur les côtés. Vient toujours le samedi.')
  await page.getByTestId('pro-client-note-submit').click()
  await page.waitForTimeout(1200)
  await shot(page, `client-detail-${label}`, { fullPage: full })

  // 6. L'équipe.
  await page.goto(`${BASE}/dashboard/team`)
  await page.getByTestId('pro-team-members').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(400)
  await shot(page, `team-${label}`, { fullPage: full })

  // 7. Le dialogue de retrait : l'avertissement d'identité. Les actions
  //    d'une rangée vivent derrière un popover (régime dense) : il faut
  //    l'ouvrir pour que « Retirer » existe dans le DOM.
  {
    const rows = page.getByTestId('pro-team-member')
    const count = await rows.count()
    let opened = false
    for (let i = 0; i < count && !opened; i += 1) {
      const trigger = rows.nth(i).getByRole('button').first()
      if (!(await trigger.isVisible())) continue
      await trigger.click()
      await page.waitForTimeout(250)
      if (await page.getByTestId('pro-team-remove').isVisible().catch(() => false)) {
        opened = true
        break
      }
      await page.keyboard.press('Escape')
    }
    if (!opened) throw new Error('team-remove : aucun membre retirable — capture impossible, on ne la fabrique pas')
    await page.getByTestId('pro-team-remove').click()
    await page.getByTestId('pro-team-remove-dialog').waitFor({ timeout: 15_000 })
    await page.waitForTimeout(400)
    await shot(page, `team-remove-${label}`)
    await page.keyboard.press('Escape')
  }

  // 8. La feuille d'invitation.
  await page.getByTestId('pro-team-invite').click()
  await page.getByTestId('pro-team-invite-sheet').waitFor({ timeout: 15_000 })
  await page.waitForTimeout(400)
  await shot(page, `team-invite-${label}`)
  await page.keyboard.press('Escape')

  // 9. Les réglages de la file : les seuils lus en base.
  await page.goto(`${BASE}/dashboard/queue/settings`)
  await page.getByTestId('pro-queue-settings-thresholds').waitFor({ timeout: 60_000 })
  await page.waitForTimeout(400)
  await shot(page, `queue-settings-${label}`, { fullPage: full })

  await context.close()

  // 10. Le barber : aucun champ de prix dans le catalogue.
  const b = await session(BARBER, viewport)
  await b.page.goto(`${BASE}/dashboard/catalog`)
  await b.page.getByTestId('pro-catalog-list').waitFor({ timeout: 60_000 })
  await b.page.getByTestId('pro-catalog-list').getByText(services[0].name, { exact: false }).first().click()
  await b.page.getByTestId('pro-catalog-price-reserved').waitFor({ timeout: 20_000 })
  await b.page.getByTestId('pro-catalog-price-reserved').scrollIntoViewIfNeeded()
  await b.page.waitForTimeout(400)
  await shot(b.page, `catalog-barber-no-price-${label}`)
  await b.context.close()
}

// 11. La preuve /platform : la console interne, intacte, servie par CE build.
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' })
  const p = await context.newPage()
  await p.goto(`${BASE}/platform/login`)
  await p.waitForLoadState('networkidle')
  await p.screenshot({ path: `${OUT}/platform-login-1440.png` })
  await context.close()
}

await browser.close()
neutralize()
console.log('captures →', OUT)
