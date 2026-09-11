/**
 * PERF — la mesure du GRAPHE D'ENTRÉE, pas du chunk d'entrée.
 *
 * Le défaut historique (D1 §11) : le budget de 180 Ko mesurait le seul chunk
 * d'entrée (93 Ko, « dans le budget ») pendant que le navigateur transférait
 * ~674 Ko au premier chargement — l'entrée importait EN STATIQUE les chunks
 * platform (218 Ko gz), maplibre (246), marketing (62) et pro (37), et
 * personne ne le voyait parce que la mesure regardait le mauvais chiffre.
 *
 * Ce script mesure ce que le navigateur transfère réellement avant le premier
 * écran : l'entrée + tous ses imports statiques transitifs, c'est-à-dire
 * exactement les <script src>, <link rel="modulepreload"> et
 * <link rel="stylesheet"> que Vite écrit dans dist/index.html. Deux gardes,
 * chacune FAIT ÉCHOUER le build :
 *
 *  1. QUALITATIVE — aucun module des familles interdites (surfaces pro,
 *     platform, marketing, maplibre, jsQR, zod) ne doit apparaître dans un
 *     chunk du graphe d'entrée. C'est la garde contre la CLASSE du défaut :
 *     elle casse dès la première aspiration, quel que soit son poids.
 *     Vérifiée via la composition réelle des chunks (dist/stats.html,
 *     rollup-plugin-visualizer).
 *
 *  2. QUANTITATIVE — le poids gzip cumulé JS+CSS du graphe d'entrée reste
 *     sous ENTRY_GRAPH_BUDGET_KB. Le budget est posé à 240 Ko : le plancher
 *     mesuré du graphe honnête est ~230 Ko (react-dom 59 + supabase-js 53 +
 *     routeur/app 50 + CSS 15 + i18next 15 + tanstack 10 + radix 11 +
 *     tailwind-merge 9…), tous nécessaires au premier écran UTILE (le
 *     contenu vient des RPC supabase). L'objectif de 180 Ko du prompt PERF
 *     n'est pas atteignable sans différer du code dont le premier écran a
 *     réellement besoin — voir docs/reports/PERF_RAPPORT.md §2/§10.
 *
 * Les polices préchargées (Poppins ~23 Ko) sont rapportées à titre indicatif,
 * hors budget JS+CSS (elles ne bloquent pas le rendu : font-display swap).
 */
import { readFileSync, existsSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ENTRY_GRAPH_BUDGET_KB = 240

/** Familles de modules qui n'ont RIEN à faire dans le graphe d'entrée consumer. */
const FORBIDDEN = [
  { label: 'platform (console interne)', pattern: /\/(pages|routes)\/platform-|\/app\/shells\/PlatformShell/ },
  { label: 'pro (OS professionnel)', pattern: /\/app\/shells\/ProShell|\/features\/pro\/|\/features\/pro-/ },
  { label: 'marketing', pattern: /\/features\/marketing|\/app\/shells\/MarketingShell/ },
  { label: 'maplibre', pattern: /node_modules\/maplibre-gl\// },
  { label: 'jsQR (lecteur de QR)', pattern: /node_modules\/jsqr\// },
  { label: 'zod (validation, surfaces paresseuses seulement)', pattern: /node_modules\/zod\// },
]

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const fail = (msg) => {
  console.error(`\n✖ check-entry-graph: ${msg}`)
  process.exit(1)
}

if (!existsSync(join(dist, 'index.html'))) fail('dist/index.html introuvable — lancer après `vite build`.')
const html = readFileSync(join(dist, 'index.html'), 'utf8')

/* 1 — le graphe d'entrée tel que le navigateur le voit. */
const assets = [
  ...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+)"/g),
  ...html.matchAll(/<link rel="modulepreload"[^>]+href="(\/assets\/[^"]+)"/g),
  ...html.matchAll(/<link rel="stylesheet"[^>]+href="(\/assets\/[^"]+)"/g),
].map((m) => m[1])
if (assets.length === 0) fail('aucun asset détecté dans dist/index.html — le format a changé ?')

const fonts = [...html.matchAll(/<link rel="preload"[^>]+href="(\/fonts\/[^"]+)"/g)].map((m) => m[1])

let total = 0
const rows = []
for (const asset of assets) {
  const file = join(dist, asset)
  if (!existsSync(file)) fail(`${asset} référencé par index.html mais absent de dist/.`)
  const size = gzipSync(readFileSync(file), { level: 9 }).length
  total += size
  rows.push({ asset, size })
}

/* 2 — garde qualitative : composition réelle des chunks du graphe. */
const statsPath = join(dist, 'stats.html')
if (!existsSync(statsPath))
  fail('dist/stats.html introuvable — rollup-plugin-visualizer est requis par cette garde, ne pas le retirer.')
const stats = readFileSync(statsPath, 'utf8')
const dataMatch = stats.match(/const data = (\{.*?\});\n/s)
if (!dataMatch) fail('impossible de lire les données du visualiseur dans dist/stats.html.')
const { nodeMetas } = JSON.parse(dataMatch[1])

const entryChunks = new Set(assets.filter((a) => a.endsWith('.js')).map((a) => a.replace(/^\//, '')))
const offenders = []
for (const meta of Object.values(nodeMetas)) {
  for (const chunk of Object.keys(meta.moduleParts ?? {})) {
    if (!entryChunks.has(chunk)) continue
    for (const family of FORBIDDEN) {
      if (family.pattern.test(meta.id)) offenders.push({ family: family.label, module: meta.id, chunk })
    }
  }
}

/* Rapport. */
rows.sort((a, b) => b.size - a.size)
console.log('\n— graphe d’entrée (gzip −9) —')
for (const { asset, size } of rows) console.log(`  ${(size / 1024).toFixed(1).padStart(7)} Ko  ${asset}`)
console.log(`  ————————\n  ${(total / 1024).toFixed(1).padStart(7)} Ko  TOTAL JS+CSS (budget ${ENTRY_GRAPH_BUDGET_KB} Ko)`)
if (fonts.length) {
  const fontTotal = fonts.reduce((s, f) => s + (existsSync(join(dist, f)) ? readFileSync(join(dist, f)).length : 0), 0)
  console.log(`  (${(fontTotal / 1024).toFixed(1)} Ko de polices préchargées, hors budget : ${fonts.join(', ')})`)
}

if (offenders.length > 0) {
  console.error('\n✖ modules INTERDITS dans le graphe d’entrée :')
  for (const o of offenders) console.error(`   [${o.family}] ${o.module} → ${o.chunk}`)
  fail('le graphe d’entrée aspire des familles interdites (voir ci-dessus).')
}

if (total > ENTRY_GRAPH_BUDGET_KB * 1024) {
  fail(
    `graphe d'entrée à ${(total / 1024).toFixed(1)} Ko gzip > budget ${ENTRY_GRAPH_BUDGET_KB} Ko.` +
      ' Regarder dist/stats.html : quel chunk a grossi, et qui l’importe en statique ?',
  )
}

console.log(`\n✓ check-entry-graph: ${(total / 1024).toFixed(1)} Ko ≤ ${ENTRY_GRAPH_BUDGET_KB} Ko, aucune famille interdite.`)
