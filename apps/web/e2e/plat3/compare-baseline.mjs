/**
 * PLAT-3 — comparaison des deux empreintes de `/platform`.
 *
 * L'écart ADMIS et UNIQUE de ce lot dans la barre de navigation, ce sont les
 * QUATRE liens neufs : ils changent `navLinks`, `textLength` et
 * `bodyTextHead` sur toutes les routes gardées, et c'est exactement ce que le
 * lot devait faire. Le script les neutralise puis exige l'identité sur TOUT le
 * reste.
 *
 * Les libellés ne sont pas écrits en dur ici : ils sont LUS dans la
 * localisation anglaise, celle que le relevé emploie. Une faute de frappe dans
 * un libellé ne doit pas se transformer en « écart inexpliqué ».
 *
 * Usage : node e2e/plat3/compare-baseline.mjs <avant.json> <apres.json>
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const NEW_LINKS = ['/platform/promotions', '/platform/funnel', '/platform/worker', '/platform/settings']
const NAV_KEYS = ['promotions', 'funnel', 'worker', 'settings']
const FIELDS = ['title', 'htmlTheme', 'bodyTheme', 'bodyFont', 'headings', 'tabLinks', 'tables', 'buttons', 'inputs', 'hasSupportBanner']

const en = JSON.parse(readFileSync(join(HERE, '..', '..', 'src', 'locales', 'en', 'platform.json'), 'utf8'))
const labels = NAV_KEYS.map((k) => {
  const value = en?.nav?.[k]
  if (!value) throw new Error(`libellé de navigation manquant : platform:nav.${k}`)
  return value
})
/* La barre rend les liens dans l'ordre de la mise en page. */
const NAV_TEXT = `${labels.join(' ')} `

const before = JSON.parse(readFileSync(process.argv[2] ?? 'docs/reports/plat3/avant/avant.json', 'utf8'))
const after = JSON.parse(readFileSync(process.argv[3] ?? 'docs/reports/plat3/apres/apres.json', 'utf8'))

if (before.map((r) => r.path).join('|') !== after.map((r) => r.path).join('|')) {
  console.error('ÉCHEC — la liste des routes a changé : une route a été supprimée, renommée ou déplacée.')
  process.exit(1)
}

let identical = 0
let navOnly = 0
const diffs = []
for (const [x, y] of before.map((r, i) => [r, after[i]])) {
  const d = {}
  for (const key of ['status', 'finalUrl', 'consoleErrors', 'httpFailures']) {
    if (JSON.stringify(x[key]) !== JSON.stringify(y[key])) d[key] = [x[key], y[key]]
  }
  for (const key of FIELDS) {
    if (JSON.stringify(x.dom[key]) !== JSON.stringify(y.dom[key])) d[`dom.${key}`] = [x.dom[key], y.dom[key]]
  }
  const navWithoutNew = y.dom.navLinks.filter((href) => !NEW_LINKS.includes(href))
  if (JSON.stringify(navWithoutNew) !== JSON.stringify(x.dom.navLinks)) {
    d['dom.navLinks (hors 4 liens neufs)'] = [x.dom.navLinks, navWithoutNew]
  }
  const headWithoutNav = y.dom.bodyTextHead.replace(NAV_TEXT, '')
  if (headWithoutNav.slice(0, 150) !== x.dom.bodyTextHead.slice(0, 150)) {
    d['dom.bodyTextHead (hors nav)'] = [x.dom.bodyTextHead.slice(0, 150), headWithoutNav.slice(0, 150)]
  }
  const delta = y.dom.textLength - x.dom.textLength
  /* Le débordement à 390 px n'est PAS neutralisé : il doit s'améliorer ou
     rester identique, jamais empirer. */
  if (y.overflow390 && !x.overflow390) d.overflow390 = ['ok', 'DÉBORDE — RÉGRESSION']
  if (Object.keys(d).length > 0) {
    diffs.push([x.path, d, delta])
  } else if (delta === 0 || delta === NAV_TEXT.length) {
    identical += 1
    if (delta !== 0) navOnly += 1
  } else {
    diffs.push([x.path, { 'dom.textLength': [x.dom.textLength, y.dom.textLength] }, delta])
  }
}

const fixed = before.filter((r, i) => r.overflow390 && !after[i].overflow390).map((r) => r.path)
const broken = before.filter((r, i) => !r.overflow390 && after[i].overflow390).map((r) => r.path)
console.log(`libellés neutralisés : ${labels.join(' | ')}`)
console.log(`routes comparées : ${before.length}`)
console.log(`empreintes identiques (les 4 liens neufs neutralisés) : ${identical}`)
console.log(`   dont ${navOnly} qui ne diffèrent QUE par la barre de navigation`)
console.log(`   et ${identical - navOnly} strictement identiques champ à champ`)
console.log(`routes dont l'empreinte diffère AUTREMENT : ${diffs.length}`)
console.log(`erreurs console avant / après : ${before.reduce((n, r) => n + r.consoleErrors.length, 0)} / ${after.reduce((n, r) => n + r.consoleErrors.length, 0)}`)
console.log(`réponses >= 400 avant / après : ${before.reduce((n, r) => n + r.httpFailures.length, 0)} / ${after.reduce((n, r) => n + r.httpFailures.length, 0)}`)
console.log(`routes qui débordaient à 390 px, avant : ${before.filter((r) => r.overflow390).length} — après : ${after.filter((r) => r.overflow390).length}`)
if (fixed.length) console.log(`   CORRIGÉES par ce lot : ${fixed.join(', ')}`)
if (broken.length) console.log(`   RÉGRESSÉES par ce lot : ${broken.join(', ')}`)
for (const [path, d, delta] of diffs) {
  console.log(`\n--- ${path}   (delta de texte : ${delta})`)
  for (const [key, value] of Object.entries(d)) console.log(`    ${key} : ${JSON.stringify(value).slice(0, 300)}`)
}
